import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase } from "../src/db.js";
import { createSocialService } from "../src/social.js";

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "leadja-social-"));
  const database = createDatabase(join(directory, "leadja.sqlite"), {
    protect: (value) => `protected:${Buffer.from(JSON.stringify(value)).toString("base64")}`,
    reveal: (value) => JSON.parse(Buffer.from(String(value).slice(10), "base64").toString("utf8")),
  });
  return { directory, database };
}

test("social state never exposes provider secrets or account tokens", async () => {
  const { directory, database } = await fixture();
  try {
    database.saveSocialProviderConfig("meta", { appId: "123", redirectUri: "https://example.com/oauth/meta" }, { appSecret: "top-secret" });
    database.upsertSocialAccount({
      id: "facebook:page-1",
      provider: "facebook",
      externalId: "page-1",
      label: "Minha página",
      tokens: { accessToken: "page-token" },
    });
    const state = database.socialState();
    assert.equal(state.configs[0].hasSecret, true);
    assert.equal(JSON.stringify(state).includes("top-secret"), false);
    assert.equal(JSON.stringify(state).includes("page-token"), false);
    assert.equal(database.getSocialAccount("facebook:page-1").tokens.accessToken, "page-token");
  } finally {
    database.raw.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("TikTok desktop OAuth uses PKCE and saves the connected creator", async () => {
  const { directory, database } = await fixture();
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("/v2/oauth/token/")) return Response.json({ access_token: "act-1", refresh_token: "rft-1", expires_in: 3600, open_id: "creator-1" });
    if (String(url).includes("/v2/user/info/")) return Response.json({ data: { user: { open_id: "creator-1", display_name: "Criador teste", avatar_url: "https://example.com/avatar.jpg" } } });
    if (String(url).includes("creator_info/query")) return Response.json({ data: { creator_username: "criador", privacy_level_options: ["SELF_ONLY"] }, error: { code: "ok" } });
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    database.saveSocialProviderConfig("tiktok", { clientKey: "client-key" }, { clientSecret: "client-secret" });
    const service = createSocialService({ database, fetchImpl });
    const request = service.startOAuth("tiktok", "http://127.0.0.1:43123");
    const authorization = new URL(request.authUrl);
    assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
    assert.match(authorization.searchParams.get("code_challenge"), /^[a-f0-9]{64}$/);
    assert.equal(request.redirectUri, "http://127.0.0.1:43123/oauth/tiktok");
    await service.completeOAuth("tiktok", `${request.redirectUri}?code=code-1&state=${authorization.searchParams.get("state")}`);
    assert.equal(database.listSocialAccounts()[0].label, "Criador teste");
    assert.equal(calls[0].options.body.get("code_verifier").length, 64);
  } finally {
    database.raw.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("Facebook publication records a successful target without touching leads", async () => {
  const { directory, database } = await fixture();
  const videoPath = join(directory, "video.mp4");
  await writeFile(videoPath, Buffer.alloc(1024, 7));
  let step = 0;
  const fetchImpl = async () => {
    step += 1;
    if (step === 1) return Response.json({ video_id: "video-123", upload_url: "https://upload.example/video" });
    if (step === 2) return Response.json({ success: true });
    if (step === 3) return Response.json({ success: true });
    throw new Error("Unexpected Facebook request");
  };
  try {
    database.upsertLead({ name: "Lead que deve permanecer", phone: "43999999999" });
    database.upsertSocialAccount({
      id: "facebook:page-1",
      provider: "facebook",
      externalId: "page-1",
      label: "Página teste",
      tokens: { accessToken: "page-token" },
    });
    const service = createSocialService({ database, fetchImpl });
    const post = await service.publish({ videoPath, caption: "Descrição teste", accountIds: ["facebook:page-1"] });
    assert.equal(post.status, "done");
    assert.equal(post.targets[0].status, "done");
    assert.equal(post.targets[0].remoteId, "video-123");
    assert.equal(database.listLeads().length, 1);
    assert.equal(database.listLeads()[0].name, "Lead que deve permanecer");
  } finally {
    database.raw.close();
    await rm(directory, { recursive: true, force: true });
  }
});

