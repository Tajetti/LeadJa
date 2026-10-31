import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabase } from "./src/db.js";
import { buildMessage, normalizePhone } from "./src/scoring.js";
import { parseCsv, csvToLead } from "./src/csv.js";
import { createScraper } from "./src/scraper.js";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)));
const publicDir = join(root, "public");

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

export async function startServer(options = {}) {
  const dataDir = resolve(options.dataDir || join(root, ".leadja"));
  const database = createDatabase(join(dataDir, "leadja.sqlite"), options.databaseOptions);
  const scraper = createScraper({ dataDir, database, executablePath: options.scraperExecutable });
  const requestedPort = Number(options.port ?? process.env.PORT ?? 4173);

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
      if (url.pathname.startsWith("/api/")) return await handleApi(request, response, url, { database, scraper });
      return await serveStatic(response, url.pathname);
    } catch (error) {
      console.error(error);
      json(response, 500, { error: "Não foi possível concluir esta operação.", detail: error.message });
    }
  });

  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(requestedPort, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : requestedPort;
  const url = `http://127.0.0.1:${port}`;
  console.log(`LeadJá local em ${url}`);
  return { server, url, database };
}

async function handleApi(request, response, url, { database, scraper }) {
  if (request.method === "GET" && url.pathname === "/api/health") return json(response, 200, { ok: true });
  if (request.method === "GET" && url.pathname === "/api/dashboard") {
    const settings = database.settings();
    const leads = database.listLeads({
      stage: url.searchParams.get("stage") || "",
      search: url.searchParams.get("search") || "",
      minScore: url.searchParams.get("minScore") || 0,
    }).map((lead) => enrichLead(lead, settings));
    return json(response, 200, { leads, stats: database.stats(), searches: database.listSearches(), settings });
  }
  if (request.method === "GET" && /^\/api\/leads\/\d+$/.test(url.pathname)) {
    const settings = database.settings();
    const lead = database.getLead(url.pathname.split("/").at(-1));
    return lead ? json(response, 200, enrichLead(lead, settings)) : json(response, 404, { error: "Lead não encontrado." });
  }
  if (request.method === "PATCH" && /^\/api\/leads\/\d+$/.test(url.pathname)) {
    const lead = database.updateLead(url.pathname.split("/").at(-1), await body(request));
    return lead ? json(response, 200, enrichLead(lead, database.settings())) : json(response, 404, { error: "Lead não encontrado." });
  }
  if (request.method === "DELETE" && /^\/api\/leads\/\d+$/.test(url.pathname)) {
    const deleted = database.deleteLead(url.pathname.split("/").at(-1));
    return deleted ? json(response, 200, { deleted: true }) : json(response, 404, { error: "Lead não encontrado." });
  }
  if (request.method === "POST" && url.pathname === "/api/leads/import") {
    const input = await body(request, 5_000_000);
    const records = parseCsv(String(input.csv || ""));
    let imported = 0;
    for (const record of records) {
      const lead = csvToLead(record);
      if (!lead.name) continue;
      database.upsertLead(lead, "csv");
      imported += 1;
    }
    return json(response, 200, { imported });
  }
  if (request.method === "POST" && url.pathname === "/api/searches") {
    const input = await body(request);
    if (!String(input.query || "").trim() || !String(input.city || "").trim()) return json(response, 400, { error: "Informe o nicho e a cidade." });
    return json(response, 202, scraper.start(input));
  }
  if (request.method === "GET" && url.pathname.startsWith("/api/searches/")) {
    const job = scraper.get(url.pathname.split("/").at(-1));
    return job ? json(response, 200, job) : json(response, 404, { error: "Busca não encontrada." });
  }
  if (request.method === "PUT" && url.pathname === "/api/settings") return json(response, 200, database.saveSettings(await body(request)));
  return json(response, 404, { error: "Rota não encontrada." });
}

function enrichLead(lead, settings) {
  const phone = normalizePhone(lead.phone, settings.countryCode);
  const message = buildMessage(lead, settings);
  const mapsQuery = [lead.name, lead.address, lead.city].filter(Boolean).join(", ");
  const googleMapsUrl = lead.mapsUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQuery)}`;
  return { ...lead, googleMapsUrl, message, whatsappUrl: phone ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}` : "" };
}

async function serveStatic(response, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const file = resolve(publicDir, `.${requested}`);
  if (!file.startsWith(publicDir)) return text(response, 403, "Acesso negado.");
  try {
    const content = await readFile(file);
    response.writeHead(200, { "content-type": mime[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
    response.end(content);
  } catch {
    const index = await readFile(join(publicDir, "index.html"));
    response.writeHead(200, { "content-type": mime[".html"], "cache-control": "no-store" });
    response.end(index);
  }
}

function body(request, maxBytes = 1_000_000) {
  return new Promise((resolvePromise, reject) => {
    let raw = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > maxBytes) request.destroy(new Error("Conteúdo grande demais."));
    });
    request.on("end", () => {
      try { resolvePromise(raw ? JSON.parse(raw) : {}); } catch { reject(new Error("JSON inválido.")); }
    });
    request.on("error", reject);
  });
}

function json(response, status, value) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}

function text(response, status, value) {
  response.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  response.end(value);
}

const isCommandLine = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCommandLine) {
  startServer().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

