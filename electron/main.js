import { app, BrowserWindow, dialog, ipcMain, nativeImage, safeStorage, ShareMenu, shell, WebContentsView } from "electron";
import { access, stat, unlink, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "../server.js";
import { createSocialService } from "../src/social.js";
import { isAllowedWhatsAppUrl, toWhatsAppWebUrl } from "./whatsapp.js";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
let mainWindow;
let localServer;
let whatsappView;
let whatsappLoaded = false;
let whatsappViewReady;
let socialService;

const whatsappChromeMajor = String(Math.min(Number.parseInt(process.versions.chrome, 10) || 140, 140));
const whatsappChromeVersion = `${whatsappChromeMajor}.0.0.0`;
const whatsappUserAgent = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${whatsappChromeVersion} Safari/537.36`;

app.setName("LeadJá");
app.commandLine.appendSwitch("lang", "pt-BR");
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) app.quit();
else {
  app.on("second-instance", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

async function createWindow() {
  if (!localServer) {
    const scraperExecutable = await findScraperExecutable();
    localServer = await startServer({
      port: 0,
      dataDir: join(app.getPath("userData"), "data"),
      scraperExecutable,
      databaseOptions: { protect: protectLocalSecret, reveal: revealLocalSecret },
    });
    socialService = createSocialService({ database: localServer.database });
  }

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 390,
    minHeight: 640,
    title: "LeadJá",
    backgroundColor: "#edf5f1",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(projectRoot, "electron", "preload.cjs"),
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => {
    destroyWhatsAppView();
    mainWindow = null;
  });
  await mainWindow.loadURL(localServer.url);
}

async function createWhatsAppView() {
  if (whatsappView && !whatsappView.webContents.isDestroyed()) {
    await whatsappViewReady;
    return whatsappView;
  }

  whatsappView = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition: "persist:leadja-whatsapp",
      sandbox: true,
      spellcheck: true,
    },
  });
  whatsappView.setBackgroundColor("#ffffff");

  const { webContents } = whatsappView;
  webContents.setUserAgent(whatsappUserAgent);
  webContents.setZoomFactor(0.85);
  const whatsappSession = webContents.session;
  const permissionAllowed = (permission, origin) => {
    const isWhatsApp = origin === "https://web.whatsapp.com" || origin.startsWith("https://web.whatsapp.com/");
    return isWhatsApp && ["media", "notifications", "clipboard-sanitized-write"].includes(permission);
  };
  whatsappSession.setPermissionCheckHandler((_contents, permission, origin) => permissionAllowed(permission, origin));
  whatsappSession.setPermissionRequestHandler((_contents, permission, callback, details) => {
    callback(permissionAllowed(permission, details.requestingUrl || details.requestingOrigin || ""));
  });

  webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedWhatsAppUrl(url)) webContents.loadURL(url).catch(handleWhatsAppLoadError);
    else if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  webContents.on("will-navigate", (event, url) => {
    if (isAllowedWhatsAppUrl(url)) return;
    event.preventDefault();
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
  });
  webContents.on("did-start-loading", () => sendWhatsAppStatus("loading", "Carregando WhatsApp Web…"));
  webContents.on("did-finish-load", () => {
    if (webContents.getURL() === "about:blank") return;
    if (/4xx|error/i.test(webContents.getTitle())) reportWhatsAppError(new Error(webContents.getTitle()));
    else sendWhatsAppStatus("ready", "WhatsApp Web pronto");
  });
  webContents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return;
    reportWhatsAppError(new Error(`${description} (${code}) ao abrir ${url}`));
  });

  mainWindow.contentView.addChildView(whatsappView);
  whatsappView.setVisible(false);
  whatsappViewReady = configureWhatsAppBrowserIdentity(webContents).catch((error) => {
    console.error("WhatsApp browser identity:", error);
  });
  await whatsappViewReady;
  return whatsappView;
}

async function configureWhatsAppBrowserIdentity(webContents) {
  await webContents.loadURL("about:blank");
  webContents.debugger.attach("1.3");
  await webContents.debugger.sendCommand("Network.enable");
  await webContents.debugger.sendCommand("Network.setUserAgentOverride", {
    userAgent: whatsappUserAgent,
    acceptLanguage: "pt-BR,pt;q=0.9,en;q=0.8",
    platform: "MacIntel",
    userAgentMetadata: {
      brands: [
        { brand: "Not_A Brand", version: "99" },
        { brand: "Chromium", version: whatsappChromeMajor },
        { brand: "Google Chrome", version: whatsappChromeMajor },
      ],
      fullVersionList: [
        { brand: "Not_A Brand", version: "99.0.0.0" },
        { brand: "Chromium", version: whatsappChromeVersion },
        { brand: "Google Chrome", version: whatsappChromeVersion },
      ],
      platform: "macOS",
      platformVersion: "15.0.0",
      architecture: process.arch === "arm64" ? "arm" : "x86",
      model: "",
      mobile: false,
      bitness: "64",
      wow64: false,
    },
  });
}

function sendWhatsAppStatus(status, message) {
  if (!mainWindow?.isDestroyed()) mainWindow.webContents.send("whatsapp:status", { status, message });
}

function reportWhatsAppError(error) {
  console.error("WhatsApp Web:", error);
  sendWhatsAppStatus("error", "Não foi possível carregar o WhatsApp Web.");
}

function handleWhatsAppLoadError(error) {
  if (error?.code === "ERR_ABORTED" || error?.errno === -3) return;
  reportWhatsAppError(error);
}

function destroyWhatsAppView() {
  if (whatsappView && !whatsappView.webContents.isDestroyed()) {
    if (whatsappView.webContents.debugger.isAttached()) whatsappView.webContents.debugger.detach();
    whatsappView.webContents.close();
  }
  whatsappView = null;
  whatsappLoaded = false;
  whatsappViewReady = null;
}

function safeViewBounds(value) {
  const [width, height] = mainWindow.getContentSize();
  const x = Math.max(0, Math.min(Math.round(Number(value?.x) || 0), width));
  const y = Math.max(0, Math.min(Math.round(Number(value?.y) || 0), height));
  const availableWidth = Math.max(1, width - x);
  const availableHeight = Math.max(1, height - y);
  return {
    x,
    y,
    width: Math.max(1, Math.min(Math.round(Number(value?.width) || 1), availableWidth)),
    height: Math.max(1, Math.min(Math.round(Number(value?.height) || 1), availableHeight)),
  };
}

ipcMain.handle("whatsapp:show", async (_event, { bounds, chatUrl } = {}) => {
  if (!mainWindow || mainWindow.isDestroyed()) return { ok: false };
  const view = await createWhatsAppView();
  view.setBounds(safeViewBounds(bounds));
  view.setVisible(true);

  const target = chatUrl ? toWhatsAppWebUrl(chatUrl) : "https://web.whatsapp.com/";
  if (chatUrl || !whatsappLoaded) {
    whatsappLoaded = true;
    await view.webContents.loadURL(target).catch(handleWhatsAppLoadError);
  }
  return { ok: true };
});

ipcMain.handle("whatsapp:bounds", (_event, bounds) => {
  if (!whatsappView || whatsappView.webContents.isDestroyed() || !mainWindow) return { ok: false };
  whatsappView.setBounds(safeViewBounds(bounds));
  return { ok: true };
});

ipcMain.handle("whatsapp:hide", () => {
  whatsappView?.setVisible(false);
  return { ok: true };
});

ipcMain.handle("whatsapp:reload", async () => {
  if (!whatsappView || whatsappView.webContents.isDestroyed()) return { ok: false };
  whatsappView.webContents.reload();
  return { ok: true };
});

ipcMain.handle("lead:share", (_event, value = {}) => {
  if (!mainWindow || mainWindow.isDestroyed()) return { ok: false };
  const text = String(value.text || "").trim().slice(0, 10_000);
  const url = String(value.url || "");
  if (!text) return { ok: false };
  const sharingItem = { texts: [text] };
  if (/^https:\/\//.test(url)) sharingItem.urls = [url];
  const menu = new ShareMenu(sharingItem);
  menu.popup({ window: mainWindow });
  return { ok: true };
});

ipcMain.handle("social:state", () => {
  ensureSocialService();
  return socialService.state(localServer.url);
});

ipcMain.handle("social:save-config", (_event, { provider, value } = {}) => {
  ensureSocialService();
  return socialService.saveConfig(provider, value || {});
});

ipcMain.handle("social:connect", async (_event, provider) => {
  ensureSocialService();
  const request = socialService.startOAuth(String(provider || ""), localServer.url);
  const callbackUrl = await openOAuthWindow(request);
  const result = await socialService.completeOAuth(request.provider, callbackUrl);
  sendSocialUpdate({ type: "accounts", state: socialService.state(localServer.url) });
  return result;
});

ipcMain.handle("social:disconnect", async (_event, accountId) => {
  ensureSocialService();
  const result = await socialService.disconnect(String(accountId || ""));
  sendSocialUpdate({ type: "accounts", state: socialService.state(localServer.url) });
  return result;
});

ipcMain.handle("social:choose-video", async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Escolha o vídeo para publicar",
    properties: ["openFile"],
    filters: [{ name: "Vídeos", extensions: ["mp4", "mov", "m4v", "webm"] }],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const path = result.filePaths[0];
  const info = await stat(path);
  return { path, name: path.split("/").at(-1), size: info.size };
});

ipcMain.handle("social:choose-cover", async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Escolha uma capa para o Kwai",
    properties: ["openFile"],
    filters: [{ name: "Imagem JPG", extensions: ["jpg", "jpeg"] }],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const path = result.filePaths[0];
  return { path, name: path.split("/").at(-1) };
});

ipcMain.handle("social:publish", async (_event, input = {}) => {
  ensureSocialService();
  let generatedCover = "";
  try {
    const hasKwai = (input.accountIds || []).some((id) => localServer.database.getSocialAccount(id)?.provider === "kwai");
    if (hasKwai && !input.coverPath) {
      generatedCover = await createVideoCover(input.videoPath).catch(() => "");
      if (generatedCover) input.coverPath = generatedCover;
    }
    return await socialService.publish(input, (post) => sendSocialUpdate({ type: "post", post }));
  } finally {
    if (generatedCover) await unlink(generatedCover).catch(() => null);
  }
});

function ensureSocialService() {
  if (!socialService || !localServer) throw new Error("O publicador ainda está iniciando.");
}

function sendSocialUpdate(value) {
  if (!mainWindow?.isDestroyed()) mainWindow.webContents.send("social:updated", value);
}

function openOAuthWindow(request) {
  return new Promise((resolvePromise, reject) => {
    const authWindow = new BrowserWindow({
      parent: mainWindow,
      modal: true,
      width: 560,
      height: 760,
      minWidth: 420,
      minHeight: 620,
      title: "Conectar conta",
      backgroundColor: "#ffffff",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition: "persist:leadja-social-auth",
      },
    });
    let settled = false;
    const finish = (url) => {
      if (settled || !isOAuthCallback(url, request.redirectUri)) return false;
      settled = true;
      resolvePromise(url);
      authWindow.destroy();
      return true;
    };
    const inspectNavigation = (event, url) => {
      if (finish(url)) event.preventDefault();
    };
    authWindow.webContents.on("will-redirect", inspectNavigation);
    authWindow.webContents.on("will-navigate", inspectNavigation);
    authWindow.webContents.on("did-navigate", (_event, url) => finish(url));
    authWindow.webContents.setWindowOpenHandler(({ url }) => {
      authWindow.loadURL(url).catch(() => null);
      return { action: "deny" };
    });
    authWindow.on("closed", () => {
      if (!settled) reject(new Error("A conexão foi cancelada."));
    });
    authWindow.loadURL(request.authUrl).catch((error) => {
      if (!settled) {
        settled = true;
        reject(new Error(`Não foi possível abrir a conexão: ${error.message}`));
      }
      if (!authWindow.isDestroyed()) authWindow.destroy();
    });
  });
}

function isOAuthCallback(value, expected) {
  try {
    const url = new URL(value);
    const callback = new URL(expected);
    return url.origin === callback.origin && url.pathname.replace(/\/$/, "") === callback.pathname.replace(/\/$/, "");
  } catch {
    return false;
  }
}

async function createVideoCover(videoPath) {
  const thumbnail = await nativeImage.createThumbnailFromPath(String(videoPath), { width: 1080, height: 1920 });
  if (thumbnail.isEmpty()) throw new Error("Não foi possível criar a capa automaticamente.");
  const path = join(app.getPath("temp"), `leadja-cover-${randomUUID()}.jpg`);
  await writeFile(path, thumbnail.toJPEG(90));
  return path;
}

function protectLocalSecret(value) {
  const serialized = JSON.stringify(value || {});
  if (safeStorage.isEncryptionAvailable()) return `safe:v1:${safeStorage.encryptString(serialized).toString("base64")}`;
  return `plain:v1:${Buffer.from(serialized).toString("base64")}`;
}

function revealLocalSecret(value) {
  const serialized = String(value || "");
  if (serialized.startsWith("safe:v1:")) return JSON.parse(safeStorage.decryptString(Buffer.from(serialized.slice(8), "base64")));
  if (serialized.startsWith("plain:v1:")) return JSON.parse(Buffer.from(serialized.slice(9), "base64").toString("utf8"));
  return JSON.parse(serialized || "{}");
}

async function findScraperExecutable() {
  const candidates = [
    process.env.LEADJA_SCRAPER_PATH,
    app.isPackaged ? join(process.resourcesPath, "bin", "google-maps-scraper") : "",
    join(projectRoot, "resources", "bin", "google-maps-scraper"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue until an executable candidate is found.
    }
  }
  return null;
}

if (hasSingleInstanceLock) {
  app.whenReady().then(createWindow).catch((error) => {
    console.error(error);
    app.quit();
  });
}

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow().catch(console.error);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  destroyWhatsAppView();
  localServer?.server.close();
});
