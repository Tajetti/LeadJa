import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import { basename, extname } from "node:path";

const META_VERSION = "v26.0";
const supportedProviders = new Set(["facebook", "instagram", "tiktok", "kwai"]);
const configKeys = {
  meta: { public: ["appId", "redirectUri"], protected: ["appSecret"] },
  tiktok: { public: ["clientKey"], protected: ["clientSecret"] },
  kwai: { public: ["appId", "redirectUri"], protected: ["appSecret"] },
  instagramStorage: { public: ["projectUrl", "bucket"], protected: ["apiKey"] },
};

export function createSocialService(options) {
  const database = options.database;
  const fetchImpl = options.fetchImpl || fetch;
  const sleep = options.sleep || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const pendingOAuth = new Map();

  function state(callbackBaseUrl = "") {
    const value = database.socialState();
    return {
      ...value,
      callbackUrls: {
        tiktok: callbackBaseUrl ? `${callbackBaseUrl}/oauth/tiktok` : "http://127.0.0.1:*/oauth/tiktok",
      },
    };
  }

  function saveConfig(provider, input = {}) {
    if (!configKeys[provider]) throw new Error("Configuração de rede desconhecida.");
    const schema = configKeys[provider];
    const publicConfig = pickStrings(input, schema.public, true);
    const protectedConfig = pickStrings(input, schema.protected, false);
    database.saveSocialProviderConfig(provider, publicConfig, protectedConfig);
    return state(input.callbackBaseUrl || "");
  }

  function startOAuth(provider, callbackBaseUrl) {
    const authProvider = ["facebook", "instagram"].includes(provider) ? "meta" : provider;
    if (!configKeys[authProvider] || authProvider === "instagramStorage") throw new Error("Esta rede não aceita conexão OAuth.");
    const config = mergedConfig(database, authProvider);
    const oauthState = randomBytes(24).toString("hex");
    let redirectUri;
    let authUrl;
    let verifier = "";

    if (authProvider === "meta") {
      requireFields(config, ["appId", "appSecret", "redirectUri"], "Meta");
      redirectUri = config.redirectUri;
      authUrl = new URL(`https://www.facebook.com/${META_VERSION}/dialog/oauth`);
      authUrl.search = new URLSearchParams({
        client_id: config.appId,
        redirect_uri: redirectUri,
        response_type: "code",
        state: oauthState,
        scope: "pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish",
      }).toString();
    } else if (authProvider === "tiktok") {
      requireFields(config, ["clientKey", "clientSecret"], "TikTok");
      if (!callbackBaseUrl) throw new Error("O endereço local do LeadJá não está disponível.");
      redirectUri = `${callbackBaseUrl}/oauth/tiktok`;
      verifier = randomVerifier();
      const challenge = createHash("sha256").update(verifier).digest("hex");
      authUrl = new URL("https://www.tiktok.com/v2/auth/authorize/");
      authUrl.search = new URLSearchParams({
        client_key: config.clientKey,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "user.info.basic,video.publish",
        state: oauthState,
        code_challenge: challenge,
        code_challenge_method: "S256",
      }).toString();
    } else {
      requireFields(config, ["appId", "appSecret", "redirectUri"], "Kwai");
      redirectUri = config.redirectUri;
      authUrl = new URL("https://open.kuaishou.com/oauth2/authorize");
      authUrl.search = new URLSearchParams({
        app_id: config.appId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "user_info,user_video_publish",
        state: oauthState,
        ua: "pc",
      }).toString();
    }

    pendingOAuth.set(authProvider, { state: oauthState, redirectUri, verifier, createdAt: Date.now() });
    return { provider: authProvider, authUrl: authUrl.toString(), redirectUri };
  }

  async function completeOAuth(provider, callbackUrl) {
    const authProvider = ["facebook", "instagram"].includes(provider) ? "meta" : provider;
    const pending = pendingOAuth.get(authProvider);
    if (!pending || Date.now() - pending.createdAt > 10 * 60_000) throw new Error("A conexão expirou. Tente conectar novamente.");
    const callback = new URL(callbackUrl);
    if (callback.searchParams.get("state") !== pending.state) throw new Error("A resposta de conexão não pôde ser validada.");
    const providerError = callback.searchParams.get("error_description") || callback.searchParams.get("error_msg") || callback.searchParams.get("error");
    if (providerError) throw new Error(`A rede recusou a conexão: ${providerError}`);
    const code = callback.searchParams.get("code");
    if (!code) throw new Error("A rede não retornou o código de conexão.");
    pendingOAuth.delete(authProvider);

    if (authProvider === "meta") await connectMeta(code, pending.redirectUri);
    if (authProvider === "tiktok") await connectTikTok(code, pending);
    if (authProvider === "kwai") await connectKwai(code);
    return state();
  }

  async function connectMeta(code, redirectUri) {
    const config = mergedConfig(database, "meta");
    const tokenUrl = new URL(`https://graph.facebook.com/${META_VERSION}/oauth/access_token`);
    tokenUrl.search = new URLSearchParams({ client_id: config.appId, client_secret: config.appSecret, redirect_uri: redirectUri, code }).toString();
    const token = await requestJson(fetchImpl, tokenUrl, {}, "Meta");
    if (!token.access_token) throw new Error(metaError(token, "A Meta não retornou um token de acesso."));
    const longLivedUrl = new URL(`https://graph.facebook.com/${META_VERSION}/oauth/access_token`);
    longLivedUrl.search = new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: config.appId,
      client_secret: config.appSecret,
      fb_exchange_token: token.access_token,
    }).toString();
    const longLived = await requestJson(fetchImpl, longLivedUrl, {}, "Meta").catch(() => token);
    const userAccessToken = longLived.access_token || token.access_token;

    const pagesUrl = new URL(`https://graph.facebook.com/${META_VERSION}/me/accounts`);
    pagesUrl.search = new URLSearchParams({
      fields: "id,name,access_token,picture{url},instagram_business_account{id,username,name,profile_picture_url}",
      limit: "100",
      access_token: userAccessToken,
    }).toString();
    const pages = await requestJson(fetchImpl, pagesUrl, {}, "Meta");
    if (!Array.isArray(pages.data) || pages.data.length === 0) throw new Error("Nenhuma Página do Facebook administrada por esta conta foi encontrada.");

    for (const page of pages.data) {
      database.upsertSocialAccount({
        id: `facebook:${page.id}`,
        provider: "facebook",
        externalId: page.id,
        label: page.name || "Página do Facebook",
        avatarUrl: page.picture?.data?.url || "",
        tokens: { accessToken: page.access_token },
        metadata: { pageId: page.id },
      });
      const instagram = page.instagram_business_account;
      if (instagram?.id) {
        database.upsertSocialAccount({
          id: `instagram:${instagram.id}`,
          provider: "instagram",
          externalId: instagram.id,
          label: instagram.name || instagram.username || `${page.name} no Instagram`,
          username: instagram.username || "",
          avatarUrl: instagram.profile_picture_url || "",
          tokens: { accessToken: page.access_token },
          metadata: { pageId: page.id, pageName: page.name || "" },
        });
      }
    }
  }

  async function connectTikTok(code, pending) {
    const config = mergedConfig(database, "tiktok");
    const token = await requestJson(fetchImpl, "https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: config.clientKey,
        client_secret: config.clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: pending.redirectUri,
        code_verifier: pending.verifier,
      }),
    }, "TikTok");
    if (!token.access_token) throw new Error(token.error_description || token.error || "O TikTok não retornou um token de acesso.");
    const profile = await requestJson(fetchImpl, "https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name", {
      headers: { Authorization: `Bearer ${token.access_token}` },
    }, "TikTok");
    const creator = await creatorInfo(fetchImpl, token.access_token).catch(() => ({}));
    const user = profile.data?.user || {};
    const externalId = token.open_id || user.open_id;
    if (!externalId) throw new Error("O TikTok conectou, mas não informou qual conta foi autorizada.");
    database.upsertSocialAccount({
      id: `tiktok:${externalId}`,
      provider: "tiktok",
      externalId,
      label: user.display_name || creator.creator_nickname || "Conta do TikTok",
      username: creator.creator_username || "",
      avatarUrl: user.avatar_url || "",
      tokens: token,
      expiresAt: expiresAt(token.expires_in),
      metadata: { creatorInfo: creator },
    });
  }

  async function connectKwai(code) {
    const config = mergedConfig(database, "kwai");
    const tokenUrl = new URL("https://open.kuaishou.com/oauth2/access_token");
    tokenUrl.search = new URLSearchParams({
      app_id: config.appId,
      app_secret: config.appSecret,
      code,
      grant_type: "authorization_code",
    }).toString();
    const token = await requestJson(fetchImpl, tokenUrl, {}, "Kwai");
    if (Number(token.result) !== 1 || !token.access_token) throw new Error(token.error_msg || "O Kwai não retornou um token de acesso.");
    const profileUrl = new URL("https://open.kuaishou.com/openapi/user_info");
    profileUrl.search = new URLSearchParams({ app_id: config.appId, access_token: token.access_token }).toString();
    const profile = await requestJson(fetchImpl, profileUrl, {}, "Kwai");
    const user = profile.user_info || {};
    const externalId = token.open_id || createHash("sha256").update(`${config.appId}:${user.name || token.access_token}`).digest("hex").slice(0, 24);
    database.upsertSocialAccount({
      id: `kwai:${externalId}`,
      provider: "kwai",
      externalId,
      label: user.name || "Conta do Kwai",
      avatarUrl: user.bigHead || user.head || "",
      tokens: token,
      expiresAt: expiresAt(token.expires_in),
      metadata: { city: user.city || "" },
    });
  }

  async function disconnect(accountId) {
    const account = database.getSocialAccount(accountId);
    if (!account) return state();
    if (account.provider === "tiktok") {
      const config = mergedConfig(database, "tiktok");
      await fetchImpl("https://open.tiktokapis.com/v2/oauth/revoke/", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_key: config.clientKey || "", client_secret: config.clientSecret || "", token: account.tokens.access_token || "" }),
      }).catch(() => null);
    }
    database.deleteSocialAccount(accountId);
    return state();
  }

  async function publish(input, onUpdate = () => {}) {
    const videoPath = String(input.videoPath || "");
    const caption = String(input.caption || "").trim();
    const accountIds = [...new Set((input.accountIds || []).map(String))];
    if (!videoPath || accountIds.length === 0) throw new Error("Escolha um vídeo e ao menos uma conta.");
    const file = await stat(videoPath).catch(() => null);
    if (!file?.isFile()) throw new Error("O vídeo escolhido não está mais disponível.");
    if (!new Set([".mp4", ".mov", ".m4v", ".webm"]).has(extname(videoPath).toLowerCase())) throw new Error("Escolha um vídeo MP4, MOV, M4V ou WebM.");
    const accounts = accountIds.map((id) => database.getSocialAccount(id));
    if (accounts.some((account) => !account || !supportedProviders.has(account.provider))) throw new Error("Uma das contas selecionadas não está mais conectada.");

    const postId = randomUUID();
    database.createSocialPost({ id: postId, videoName: basename(videoPath), videoPath, caption }, accountIds);
    database.updateSocialPostStatus(postId, "running");
    onUpdate(database.getSocialPost(postId));

    await Promise.all(accounts.map(async (account) => {
      updateTarget(postId, account.id, { status: "uploading", progress: 4 }, onUpdate);
      try {
        const freshAccount = await refreshAccountIfNeeded(account);
        let result;
        if (freshAccount.provider === "facebook") result = await publishFacebook(freshAccount, videoPath, caption, file.size, postId, onUpdate);
        if (freshAccount.provider === "instagram") result = await publishInstagram(freshAccount, videoPath, caption, input, postId, onUpdate);
        if (freshAccount.provider === "tiktok") result = await publishTikTok(freshAccount, videoPath, caption, file.size, input, postId, onUpdate);
        if (freshAccount.provider === "kwai") result = await publishKwai(freshAccount, videoPath, caption, file.size, input.coverPath, postId, onUpdate);
        updateTarget(postId, account.id, { status: "done", progress: 100, remoteId: result?.remoteId || "", remoteUrl: result?.remoteUrl || "" }, onUpdate);
      } catch (error) {
        updateTarget(postId, account.id, { status: "error", progress: 100, error: cleanError(error) }, onUpdate);
      }
    }));

    const finished = database.getSocialPost(postId);
    const successful = finished.targets.filter((target) => target.status === "done").length;
    database.updateSocialPostStatus(postId, successful === finished.targets.length ? "done" : successful ? "partial" : "error");
    const result = database.getSocialPost(postId);
    onUpdate(result);
    return result;
  }

  async function refreshAccountIfNeeded(account) {
    if (!account.expiresAt || new Date(account.expiresAt).getTime() > Date.now() + 5 * 60_000) return account;
    if (account.provider === "tiktok" && account.tokens.refresh_token) {
      const config = mergedConfig(database, "tiktok");
      const token = await requestJson(fetchImpl, "https://open.tiktokapis.com/v2/oauth/token/", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_key: config.clientKey, client_secret: config.clientSecret, grant_type: "refresh_token", refresh_token: account.tokens.refresh_token }),
      }, "TikTok");
      if (!token.access_token) throw new Error(token.error_description || "Não foi possível renovar a conexão do TikTok.");
      return database.upsertSocialAccount({ ...account, tokens: token, expiresAt: expiresAt(token.expires_in) });
    }
    if (account.provider === "kwai" && account.tokens.refresh_token) {
      const config = mergedConfig(database, "kwai");
      const url = new URL("https://open.kuaishou.com/oauth2/refresh_token");
      url.search = new URLSearchParams({ app_id: config.appId, app_secret: config.appSecret, refresh_token: account.tokens.refresh_token, grant_type: "refresh_token" }).toString();
      const token = await requestJson(fetchImpl, url, {}, "Kwai");
      if (Number(token.result) !== 1 || !token.access_token) throw new Error(token.error_msg || "Não foi possível renovar a conexão do Kwai.");
      return database.upsertSocialAccount({ ...account, tokens: token, expiresAt: expiresAt(token.expires_in) });
    }
    return account;
  }

  async function publishFacebook(account, videoPath, caption, fileSize, postId, onUpdate) {
    const token = account.tokens.accessToken;
    const startUrl = new URL(`https://graph.facebook.com/${META_VERSION}/me/video_reels`);
    startUrl.search = new URLSearchParams({ access_token: token, upload_phase: "start" }).toString();
    const session = await requestJson(fetchImpl, startUrl, { method: "POST" }, "Facebook");
    if (!session.video_id || !session.upload_url) throw new Error(metaError(session, "O Facebook não iniciou o envio do Reel."));
    updateTarget(postId, account.id, { status: "uploading", progress: 20, remoteId: session.video_id }, onUpdate);
    const upload = await fetchImpl(session.upload_url, {
      method: "POST",
      headers: { Authorization: `OAuth ${token}`, offset: "0", file_size: String(fileSize), "content-type": "application/octet-stream" },
      body: createReadStream(videoPath),
      duplex: "half",
    });
    if (!upload.ok) throw new Error(`O Facebook recusou o vídeo (${upload.status}).`);
    const uploadBody = await upload.json().catch(() => ({}));
    if (uploadBody.success === false) throw new Error(metaError(uploadBody, "O envio do Reel ao Facebook falhou."));
    updateTarget(postId, account.id, { status: "publishing", progress: 78 }, onUpdate);
    const finishUrl = new URL(`https://graph.facebook.com/${META_VERSION}/me/video_reels`);
    finishUrl.search = new URLSearchParams({
      access_token: token,
      video_id: session.video_id,
      upload_phase: "finish",
      video_state: "PUBLISHED",
      description: caption,
      title: caption.slice(0, 100),
    }).toString();
    const finish = await requestJson(fetchImpl, finishUrl, { method: "POST" }, "Facebook");
    if (finish.success !== true) throw new Error(metaError(finish, "O Facebook não publicou o Reel."));
    return { remoteId: session.video_id };
  }

  async function publishTikTok(account, videoPath, caption, fileSize, input, postId, onUpdate) {
    const accessToken = account.tokens.access_token;
    const creator = await creatorInfo(fetchImpl, accessToken);
    const allowed = creator.privacy_level_options || [];
    const requestedPrivacy = String(input.tiktokPrivacy || "SELF_ONLY");
    const privacy = allowed.includes(requestedPrivacy) ? requestedPrivacy : allowed.includes("SELF_ONLY") ? "SELF_ONLY" : allowed[0];
    if (!privacy) throw new Error("O TikTok não informou uma opção de privacidade válida para esta conta.");
    const preferredChunkSize = 10 * 1024 * 1024;
    const chunkSize = fileSize <= 64 * 1024 * 1024 ? fileSize : preferredChunkSize;
    const totalChunkCount = Math.max(1, Math.floor(fileSize / chunkSize));
    const init = await requestJson(fetchImpl, "https://open.tiktokapis.com/v2/post/publish/video/init/", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json; charset=UTF-8" },
      body: JSON.stringify({
        post_info: {
          title: caption.slice(0, 2200),
          privacy_level: privacy,
          disable_duet: Boolean(input.disableDuet),
          disable_comment: Boolean(input.disableComment),
          disable_stitch: Boolean(input.disableStitch),
          video_cover_timestamp_ms: 1000,
          brand_content_toggle: false,
          brand_organic_toggle: Boolean(input.promotesOwnBusiness),
          is_aigc: Boolean(input.aiGenerated),
        },
        source_info: { source: "FILE_UPLOAD", video_size: fileSize, chunk_size: chunkSize, total_chunk_count: totalChunkCount },
      }),
    }, "TikTok");
    if (init.error?.code && init.error.code !== "ok") throw new Error(init.error.message || init.error.code);
    if (!init.data?.upload_url) throw new Error("O TikTok não iniciou o envio do vídeo.");
    updateTarget(postId, account.id, { status: "uploading", progress: 22, remoteId: init.data.publish_id || "" }, onUpdate);
    if (totalChunkCount === 1) {
      const upload = await fetchImpl(init.data.upload_url, {
        method: "PUT",
        headers: {
          "content-type": mimeType(videoPath),
          "content-length": String(fileSize),
          "content-range": `bytes 0-${fileSize - 1}/${fileSize}`,
        },
        body: createReadStream(videoPath),
        duplex: "half",
      });
      if (!upload.ok) throw new Error(`O TikTok recusou o arquivo (${upload.status}).`);
    } else {
      const handle = await open(videoPath, "r");
      try {
        for (let index = 0; index < totalChunkCount; index += 1) {
          const firstByte = index * chunkSize;
          const length = index === totalChunkCount - 1 ? fileSize - firstByte : chunkSize;
          const chunk = Buffer.allocUnsafe(length);
          await handle.read(chunk, 0, length, firstByte);
          const upload = await fetchImpl(init.data.upload_url, {
            method: "PUT",
            headers: {
              "content-type": mimeType(videoPath),
              "content-length": String(length),
              "content-range": `bytes ${firstByte}-${firstByte + length - 1}/${fileSize}`,
            },
            body: chunk,
          });
          if (!upload.ok) throw new Error(`O TikTok recusou a parte ${index + 1} do arquivo (${upload.status}).`);
          updateTarget(postId, account.id, { status: "uploading", progress: Math.round(22 + ((index + 1) / totalChunkCount) * 62), remoteId: init.data.publish_id || "" }, onUpdate);
        }
      } finally {
        await handle.close();
      }
    }
    updateTarget(postId, account.id, { status: "processing", progress: 88 }, onUpdate);
    return { remoteId: init.data.publish_id || "" };
  }

  async function publishInstagram(account, videoPath, caption, input, postId, onUpdate) {
    const staged = await stageForInstagram(videoPath);
    try {
      updateTarget(postId, account.id, { status: "publishing", progress: 35 }, onUpdate);
      const createUrl = new URL(`https://graph.facebook.com/${META_VERSION}/${account.externalId}/media`);
      createUrl.search = new URLSearchParams({
        media_type: "REELS",
        video_url: staged.publicUrl,
        caption,
        share_to_feed: input.shareToFeed === false ? "false" : "true",
        access_token: account.tokens.accessToken,
      }).toString();
      const container = await requestJson(fetchImpl, createUrl, { method: "POST" }, "Instagram");
      if (!container.id) throw new Error(metaError(container, "O Instagram não criou o Reel."));
      updateTarget(postId, account.id, { status: "processing", progress: 52, remoteId: container.id }, onUpdate);
      let status = "IN_PROGRESS";
      for (let attempt = 0; attempt < 30 && status !== "FINISHED"; attempt += 1) {
        if (attempt) await sleep(4_000);
        const statusUrl = new URL(`https://graph.facebook.com/${META_VERSION}/${container.id}`);
        statusUrl.search = new URLSearchParams({ fields: "status_code,status", access_token: account.tokens.accessToken }).toString();
        const value = await requestJson(fetchImpl, statusUrl, {}, "Instagram");
        status = value.status_code;
        if (["ERROR", "EXPIRED"].includes(status)) throw new Error(value.status || "O Instagram não conseguiu processar o vídeo.");
        updateTarget(postId, account.id, { status: "processing", progress: Math.min(88, 52 + attempt * 2), remoteId: container.id }, onUpdate);
      }
      if (status !== "FINISHED") throw new Error("O Instagram demorou mais de dois minutos para processar o vídeo. Verifique o formato e tente novamente.");
      const publishUrl = new URL(`https://graph.facebook.com/${META_VERSION}/${account.externalId}/media_publish`);
      publishUrl.search = new URLSearchParams({ creation_id: container.id, access_token: account.tokens.accessToken }).toString();
      const published = await requestJson(fetchImpl, publishUrl, { method: "POST" }, "Instagram");
      if (!published.id) throw new Error(metaError(published, "O Instagram não publicou o Reel."));
      return { remoteId: published.id };
    } finally {
      await staged.cleanup().catch(() => null);
    }
  }

  async function stageForInstagram(videoPath) {
    const config = mergedConfig(database, "instagramStorage");
    requireFields(config, ["projectUrl", "bucket", "apiKey"], "ponte temporária do Instagram");
    const projectUrl = config.projectUrl.replace(/\/$/, "");
    const objectPath = `leadja/${Date.now()}-${randomBytes(6).toString("hex")}${extname(videoPath).toLowerCase()}`;
    const objectUrl = `${projectUrl}/storage/v1/object/${encodeURIComponent(config.bucket)}/${objectPath.split("/").map(encodeURIComponent).join("/")}`;
    const response = await fetchImpl(objectUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}`, apikey: config.apiKey, "content-type": mimeType(videoPath), "x-upsert": "true" },
      body: createReadStream(videoPath),
      duplex: "half",
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`A ponte temporária do Instagram recusou o vídeo (${response.status})${detail ? `: ${detail.slice(0, 180)}` : "."}`);
    }
    const publicUrl = `${projectUrl}/storage/v1/object/public/${encodeURIComponent(config.bucket)}/${objectPath.split("/").map(encodeURIComponent).join("/")}`;
    return {
      publicUrl,
      cleanup: () => fetchImpl(objectUrl, { method: "DELETE", headers: { Authorization: `Bearer ${config.apiKey}`, apikey: config.apiKey } }),
    };
  }

  async function publishKwai(account, videoPath, caption, fileSize, coverPath, postId, onUpdate) {
    if (!coverPath) throw new Error("O Kwai exige uma capa JPG. Escolha uma capa antes de publicar.");
    const config = mergedConfig(database, "kwai");
    const startUrl = new URL("https://open.kuaishou.com/openapi/photo/start_upload");
    startUrl.search = new URLSearchParams({ access_token: account.tokens.access_token, app_id: config.appId }).toString();
    const started = await requestJson(fetchImpl, startUrl, { method: "POST" }, "Kwai");
    if (Number(started.result) !== 1 || !started.upload_token || !started.endpoint) throw new Error(started.error_msg || "O Kwai não iniciou o envio do vídeo.");
    const endpoint = /^https?:\/\//.test(started.endpoint) ? started.endpoint.replace(/\/$/, "") : `http://${started.endpoint}`;
    const chunkSize = 8 * 1024 * 1024;
    if (fileSize < 10 * 1024 * 1024) {
      const uploadUrl = new URL(`${endpoint}/api/upload`);
      uploadUrl.searchParams.set("upload_token", started.upload_token);
      const upload = await fetchImpl(uploadUrl, { method: "POST", headers: { "content-type": mimeType(videoPath) }, body: createReadStream(videoPath), duplex: "half" });
      if (!upload.ok || Number((await upload.json().catch(() => ({}))).result) !== 1) throw new Error("O Kwai recusou o arquivo de vídeo.");
    } else {
      const handle = await open(videoPath, "r");
      let fragmentCount = 0;
      try {
        for (let offset = 0; offset < fileSize; offset += chunkSize) {
          const length = Math.min(chunkSize, fileSize - offset);
          const chunk = Buffer.allocUnsafe(length);
          await handle.read(chunk, 0, length, offset);
          const uploadUrl = new URL(`${endpoint}/api/upload/fragment`);
          uploadUrl.search = new URLSearchParams({ upload_token: started.upload_token, fragment_id: String(fragmentCount) }).toString();
          const upload = await fetchImpl(uploadUrl, { method: "POST", headers: { "content-type": mimeType(videoPath) }, body: chunk });
          const value = await upload.json().catch(() => ({}));
          if (!upload.ok || Number(value.result) !== 1) throw new Error(`O Kwai recusou a parte ${fragmentCount + 1} do vídeo.`);
          fragmentCount += 1;
          updateTarget(postId, account.id, { status: "uploading", progress: Math.round(10 + (offset + length) / fileSize * 65) }, onUpdate);
        }
      } finally {
        await handle.close();
      }
      const completeUrl = new URL(`${endpoint}/api/upload/complete`);
      completeUrl.search = new URLSearchParams({ upload_token: started.upload_token, fragment_count: String(fragmentCount) }).toString();
      const complete = await requestJson(fetchImpl, completeUrl, { method: "POST" }, "Kwai");
      if (Number(complete.result) !== 1) throw new Error(complete.error_msg || "O Kwai não conseguiu juntar as partes do vídeo.");
    }
    updateTarget(postId, account.id, { status: "publishing", progress: 82 }, onUpdate);
    const publishUrl = new URL("https://open.kuaishou.com/openapi/photo/publish");
    publishUrl.search = new URLSearchParams({ access_token: account.tokens.access_token, app_id: config.appId, upload_token: started.upload_token }).toString();
    const form = new FormData();
    form.set("caption", caption || "Vídeo publicado pelo LeadJá");
    const coverBytes = await import("node:fs/promises").then(({ readFile }) => readFile(coverPath));
    form.set("cover", new Blob([coverBytes], { type: "image/jpeg" }), "leadja-cover.jpg");
    const published = await requestJson(fetchImpl, publishUrl, { method: "POST", body: form }, "Kwai");
    if (Number(published.result) !== 1) throw new Error(published.error_msg || "O Kwai não publicou o vídeo.");
    return { remoteId: published.video_info?.photo_id || "", remoteUrl: published.video_info?.play_url || "" };
  }

  function updateTarget(postId, accountId, patch, onUpdate) {
    database.updateSocialTarget(postId, accountId, patch);
    onUpdate(database.getSocialPost(postId));
  }

  async function creatorInfo(fetcher, accessToken) {
    const value = await requestJson(fetcher, "https://open.tiktokapis.com/v2/post/publish/creator_info/query/", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json; charset=UTF-8" },
      body: "{}",
    }, "TikTok");
    if (value.error?.code && value.error.code !== "ok") throw new Error(value.error.message || value.error.code);
    return value.data || {};
  }

  return { state, saveConfig, startOAuth, completeOAuth, disconnect, publish };
}

function mergedConfig(database, provider) {
  const config = database.getSocialProviderConfig(provider);
  return { ...config.publicConfig, ...config.protectedConfig };
}

function pickStrings(input, keys, includeEmpty) {
  return Object.fromEntries(keys.flatMap((key) => {
    if (input[key] === undefined) return [];
    const value = String(input[key] || "").trim();
    return includeEmpty || value ? [[key, value]] : [];
  }));
}

function requireFields(value, fields, label) {
  const missing = fields.filter((field) => !String(value[field] || "").trim());
  if (missing.length) throw new Error(`Configure ${label} antes de conectar ou publicar.`);
}

function randomVerifier() {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const bytes = randomBytes(64);
  return [...bytes].map((value) => alphabet[value % alphabet.length]).join("");
}

function expiresAt(seconds) {
  return seconds ? new Date(Date.now() + Number(seconds) * 1000).toISOString() : null;
}

async function requestJson(fetchImpl, url, options, label) {
  const response = await fetchImpl(url, options);
  const value = await response.json().catch(async () => ({ message: await response.text().catch(() => "") }));
  if (!response.ok) throw new Error(value.error?.message || value.error_description || value.error_msg || value.message || `${label} respondeu com erro ${response.status}.`);
  return value;
}

function metaError(value, fallback) {
  return value?.error?.message || value?.error?.error_user_msg || fallback;
}

function cleanError(error) {
  return String(error?.message || error || "Falha desconhecida.").replace(/access[_ ]?token=[^&\s]+/gi, "access_token=oculto").slice(0, 600);
}

function mimeType(path) {
  const extension = extname(path).toLowerCase();
  if ([".mov", ".m4v"].includes(extension)) return "video/quicktime";
  if (extension === ".webm") return "video/webm";
  return "video/mp4";
}

