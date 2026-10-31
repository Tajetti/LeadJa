import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { defaultScoring, scoreLead } from "./scoring.js";

const stages = new Set(["new", "contacted", "qualified", "negotiating", "won", "lost"]);
const defaultCrmStages = [
  { key: "new", label: "Novo", color: "#64748b" },
  { key: "contacted", label: "Contatado", color: "#2563eb" },
  { key: "qualified", label: "Qualificado", color: "#0e7490" },
  { key: "negotiating", label: "Negociação", color: "#d97706" },
  { key: "won", label: "Fechado", color: "#15803d" },
];

export function createDatabase(path, options = {}) {
  const protect = typeof options.protect === "function" ? options.protect : (value) => JSON.stringify(value ?? {});
  const reveal = typeof options.reveal === "function" ? options.reveal : (value) => JSON.parse(value || "{}");
  mkdirSync(dirname(path), { recursive: true });
  const databaseAlreadyExists = existsSync(path);
  const db = new DatabaseSync(path);
  if (databaseAlreadyExists) createStartupBackup(db, path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT DEFAULT '',
      address TEXT DEFAULT '',
      city TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      website TEXT DEFAULT '',
      rating REAL DEFAULT 0,
      review_count INTEGER DEFAULT 0,
      maps_url TEXT DEFAULT '',
      source_id TEXT DEFAULT '',
      source TEXT DEFAULT 'manual',
      stage TEXT DEFAULT 'new',
      note TEXT DEFAULT '',
      score INTEGER DEFAULT 0,
      score_reasons TEXT DEFAULT '[]',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(name, phone, address)
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS searches (
      id TEXT PRIMARY KEY,
      query TEXT NOT NULL,
      city TEXT NOT NULL,
      status TEXT NOT NULL,
      result_count INTEGER DEFAULT 0,
      error TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      finished_at TEXT
    );
    CREATE TABLE IF NOT EXISTS social_provider_configs (
      provider TEXT PRIMARY KEY,
      public_config TEXT NOT NULL DEFAULT '{}',
      protected_config TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS social_accounts (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      external_id TEXT NOT NULL,
      label TEXT NOT NULL,
      username TEXT DEFAULT '',
      avatar_url TEXT DEFAULT '',
      protected_tokens TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      expires_at TEXT,
      connected_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(provider, external_id)
    );
    CREATE TABLE IF NOT EXISTS social_posts (
      id TEXT PRIMARY KEY,
      video_name TEXT NOT NULL,
      video_path TEXT NOT NULL,
      caption TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      finished_at TEXT
    );
    CREATE TABLE IF NOT EXISTS social_post_targets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id TEXT NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
      account_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      progress INTEGER NOT NULL DEFAULT 0,
      remote_id TEXT DEFAULT '',
      remote_url TEXT DEFAULT '',
      error TEXT DEFAULT '',
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(post_id, account_id)
    );
    CREATE INDEX IF NOT EXISTS social_accounts_provider_idx ON social_accounts(provider);
    CREATE INDEX IF NOT EXISTS social_targets_post_idx ON social_post_targets(post_id);
  `);

  const defaults = {
    senderName: "",
    offer: "criação de sites e presença digital",
    countryCode: "55",
    scoring: defaultScoring,
    crmStages: defaultCrmStages,
  };
  const insertSetting = db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
  for (const [key, value] of Object.entries(defaults)) insertSetting.run(key, JSON.stringify(value));

  return {
    raw: db,
    settings() {
      return Object.fromEntries(db.prepare("SELECT key, value FROM settings").all().map((row) => {
        try { return [row.key, JSON.parse(row.value)]; } catch { return [row.key, row.value]; }
      }));
    },
    saveSettings(input) {
      const save = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
      for (const key of ["senderName", "offer", "countryCode", "scoring", "crmStages"]) {
        if (input[key] !== undefined) save.run(key, JSON.stringify(input[key]));
      }
      return this.settings();
    },
    listLeads(filters = {}) {
      const clauses = [];
      const values = [];
      if (filters.stage && stages.has(filters.stage)) { clauses.push("stage = ?"); values.push(filters.stage); }
      if (filters.search) {
        clauses.push("(name LIKE ? OR category LIKE ? OR address LIKE ?)");
        const needle = `%${filters.search}%`;
        values.push(needle, needle, needle);
      }
      if (Number(filters.minScore) > 0) { clauses.push("score >= ?"); values.push(Number(filters.minScore)); }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      return db.prepare(`SELECT * FROM leads ${where} ORDER BY score DESC, created_at DESC`).all(...values).map(mapLead);
    },
    getLead(id) {
      const row = db.prepare("SELECT * FROM leads WHERE id = ?").get(Number(id));
      return row ? mapLead(row) : null;
    },
    upsertLead(lead, source = "manual") {
      const settings = this.settings();
      const scored = scoreLead(lead, settings.scoring);
      const existingBySource = lead.sourceId
        ? db.prepare("SELECT id FROM leads WHERE source_id = ? LIMIT 1").get(String(lead.sourceId))
        : null;
      if (existingBySource) {
        db.prepare(`
          UPDATE leads SET name = ?, category = ?, address = ?, city = ?, phone = ?, website = ?,
            rating = ?, review_count = ?, maps_url = ?, source = ?, score = ?, score_reasons = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(
          String(lead.name || "Negócio sem nome").trim(), String(lead.category || ""), String(lead.address || ""),
          String(lead.city || ""), String(lead.phone || ""), String(lead.website || ""), Number(lead.rating || 0),
          Number(lead.reviewCount || 0), String(lead.mapsUrl || ""), source, scored.score,
          JSON.stringify(scored.reasons), existingBySource.id,
        );
        return this.getLead(existingBySource.id);
      }
      const result = db.prepare(`
        INSERT INTO leads (name, category, address, city, phone, website, rating, review_count, maps_url, source_id, source, score, score_reasons)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(name, phone, address) DO UPDATE SET
          category = excluded.category, city = excluded.city, website = excluded.website,
          rating = excluded.rating, review_count = excluded.review_count, maps_url = excluded.maps_url,
          source_id = excluded.source_id, score = excluded.score, score_reasons = excluded.score_reasons,
          updated_at = CURRENT_TIMESTAMP
        RETURNING id
      `).get(
        String(lead.name || "Negócio sem nome").trim(), String(lead.category || ""), String(lead.address || ""),
        String(lead.city || ""), String(lead.phone || ""), String(lead.website || ""), Number(lead.rating || 0),
        Number(lead.reviewCount || 0), String(lead.mapsUrl || ""), String(lead.sourceId || ""), source,
        scored.score, JSON.stringify(scored.reasons),
      );
      return this.getLead(result.id);
    },
    updateLead(id, patch) {
      const current = this.getLead(id);
      if (!current) return null;
      const stage = stages.has(patch.stage) ? patch.stage : current.stage;
      const note = patch.note !== undefined ? String(patch.note) : current.note;
      db.prepare("UPDATE leads SET stage = ?, note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(stage, note, Number(id));
      return this.getLead(id);
    },
    deleteLead(id) {
      return db.prepare("DELETE FROM leads WHERE id = ?").run(Number(id)).changes > 0;
    },
    stats() {
      const rows = db.prepare("SELECT stage, score, website, phone FROM leads").all();
      return {
        total: rows.length,
        hot: rows.filter((row) => row.score >= 70).length,
        noWebsite: rows.filter((row) => !row.website).length,
        contacted: rows.filter((row) => ["contacted", "negotiating", "won"].includes(row.stage)).length,
        stages: Object.fromEntries([...stages].map((stage) => [stage, rows.filter((row) => row.stage === stage).length])),
      };
    },
    createSearch(job) {
      db.prepare("INSERT INTO searches (id, query, city, status) VALUES (?, ?, ?, ?)").run(job.id, job.query, job.city, job.status);
    },
    updateSearch(id, patch) {
      db.prepare(`UPDATE searches SET status = ?, result_count = ?, error = ?, finished_at = CASE WHEN ? IN ('done','error') THEN CURRENT_TIMESTAMP ELSE finished_at END WHERE id = ?`)
        .run(patch.status, Number(patch.resultCount || 0), String(patch.error || ""), patch.status, id);
    },
    listSearches() {
      return db.prepare("SELECT * FROM searches ORDER BY created_at DESC LIMIT 20").all().map((row) => ({
        id: row.id, query: row.query, city: row.city, status: row.status, resultCount: row.result_count,
        error: row.error, createdAt: row.created_at, finishedAt: row.finished_at,
      }));
    },
    saveSocialProviderConfig(provider, publicConfig, protectedConfig) {
      const key = String(provider || "").trim();
      if (!key) throw new Error("Provedor social inválido.");
      const current = this.getSocialProviderConfig(key);
      const nextPublic = { ...current.publicConfig, ...(publicConfig || {}) };
      const nextProtected = { ...current.protectedConfig, ...(protectedConfig || {}) };
      db.prepare(`
        INSERT INTO social_provider_configs (provider, public_config, protected_config, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(provider) DO UPDATE SET
          public_config = excluded.public_config,
          protected_config = excluded.protected_config,
          updated_at = CURRENT_TIMESTAMP
      `).run(key, JSON.stringify(nextPublic), protect(nextProtected));
      return this.getSocialProviderConfig(key);
    },
    getSocialProviderConfig(provider) {
      const row = db.prepare("SELECT * FROM social_provider_configs WHERE provider = ?").get(String(provider));
      if (!row) return { provider: String(provider), publicConfig: {}, protectedConfig: {} };
      return {
        provider: row.provider,
        publicConfig: safeJson(row.public_config, {}),
        protectedConfig: safeReveal(reveal, row.protected_config),
        updatedAt: row.updated_at,
      };
    },
    listSocialProviderConfigs() {
      return db.prepare("SELECT provider, public_config, protected_config, updated_at FROM social_provider_configs ORDER BY provider").all().map((row) => {
        const publicConfig = safeJson(row.public_config, {});
        const protectedConfig = safeReveal(reveal, row.protected_config);
        return {
          provider: row.provider,
          publicConfig,
          configured: Object.values(publicConfig).some(Boolean) || Object.values(protectedConfig).some(Boolean),
          hasSecret: Object.values(protectedConfig).some(Boolean),
          updatedAt: row.updated_at,
        };
      });
    },
    upsertSocialAccount(account) {
      const id = String(account.id || `${account.provider}:${account.externalId}`);
      db.prepare(`
        INSERT INTO social_accounts (id, provider, external_id, label, username, avatar_url, protected_tokens, metadata, expires_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(provider, external_id) DO UPDATE SET
          id = excluded.id,
          label = excluded.label,
          username = excluded.username,
          avatar_url = excluded.avatar_url,
          protected_tokens = excluded.protected_tokens,
          metadata = excluded.metadata,
          expires_at = excluded.expires_at,
          updated_at = CURRENT_TIMESTAMP
      `).run(
        id, String(account.provider), String(account.externalId), String(account.label || account.username || account.provider),
        String(account.username || ""), String(account.avatarUrl || ""), protect(account.tokens || {}),
        JSON.stringify(account.metadata || {}), account.expiresAt || null,
      );
      return this.getSocialAccount(id) || this.getSocialAccountByExternal(account.provider, account.externalId);
    },
    getSocialAccount(id) {
      const row = db.prepare("SELECT * FROM social_accounts WHERE id = ?").get(String(id));
      return row ? mapSocialAccount(row, reveal, true) : null;
    },
    getSocialAccountByExternal(provider, externalId) {
      const row = db.prepare("SELECT * FROM social_accounts WHERE provider = ? AND external_id = ?").get(String(provider), String(externalId));
      return row ? mapSocialAccount(row, reveal, true) : null;
    },
    listSocialAccounts() {
      return db.prepare("SELECT * FROM social_accounts ORDER BY provider, label").all().map((row) => mapSocialAccount(row, reveal, false));
    },
    deleteSocialAccount(id) {
      return db.prepare("DELETE FROM social_accounts WHERE id = ?").run(String(id)).changes > 0;
    },
    createSocialPost(post, accountIds) {
      const insertPost = db.prepare("INSERT INTO social_posts (id, video_name, video_path, caption, status) VALUES (?, ?, ?, ?, 'queued')");
      const insertTarget = db.prepare("INSERT INTO social_post_targets (post_id, account_id, provider, status) VALUES (?, ?, ?, 'queued')");
      db.exec("BEGIN");
      try {
        insertPost.run(String(post.id), String(post.videoName), String(post.videoPath), String(post.caption || ""));
        for (const accountId of accountIds) {
          const account = this.getSocialAccount(accountId);
          if (!account) throw new Error(`Conta social não encontrada: ${accountId}`);
          insertTarget.run(String(post.id), String(accountId), account.provider);
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      return this.getSocialPost(post.id);
    },
    updateSocialPostStatus(id, status) {
      db.prepare("UPDATE social_posts SET status = ?, finished_at = CASE WHEN ? IN ('done','partial','error') THEN CURRENT_TIMESTAMP ELSE finished_at END WHERE id = ?")
        .run(String(status), String(status), String(id));
      return this.getSocialPost(id);
    },
    updateSocialTarget(postId, accountId, patch) {
      const current = db.prepare("SELECT * FROM social_post_targets WHERE post_id = ? AND account_id = ?").get(String(postId), String(accountId));
      if (!current) return null;
      db.prepare(`
        UPDATE social_post_targets SET status = ?, progress = ?, remote_id = ?, remote_url = ?, error = ?, updated_at = CURRENT_TIMESTAMP
        WHERE post_id = ? AND account_id = ?
      `).run(
        String(patch.status ?? current.status), Math.max(0, Math.min(100, Number(patch.progress ?? current.progress))),
        String(patch.remoteId ?? current.remote_id), String(patch.remoteUrl ?? current.remote_url),
        String(patch.error ?? current.error), String(postId), String(accountId),
      );
      return this.getSocialPost(postId)?.targets.find((target) => target.accountId === String(accountId)) || null;
    },
    getSocialPost(id) {
      const row = db.prepare("SELECT * FROM social_posts WHERE id = ?").get(String(id));
      return row ? mapSocialPost(row, db) : null;
    },
    listSocialPosts() {
      return db.prepare("SELECT * FROM social_posts ORDER BY created_at DESC LIMIT 30").all().map((row) => mapSocialPost(row, db));
    },
    socialState() {
      return { configs: this.listSocialProviderConfigs(), accounts: this.listSocialAccounts(), posts: this.listSocialPosts() };
    },
  };
}

function createStartupBackup(db, databasePath) {
  try {
    const backupDirectory = join(dirname(databasePath), "backups");
    mkdirSync(backupDirectory, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = join(backupDirectory, `leadja-startup-${timestamp}.sqlite`);
    db.exec(`VACUUM INTO '${backupPath.replaceAll("'", "''")}'`);
  } catch (error) {
    console.error("Não foi possível criar o backup automático do LeadJá:", error);
  }
}

function mapLead(row) {
  return {
    id: row.id, name: row.name, category: row.category, address: row.address, city: row.city,
    phone: row.phone, website: row.website, rating: row.rating, reviewCount: row.review_count,
    mapsUrl: row.maps_url, sourceId: row.source_id, source: row.source, stage: row.stage,
    note: row.note, score: row.score, scoreReasons: JSON.parse(row.score_reasons || "[]"),
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function mapSocialAccount(row, reveal, includeTokens) {
  return {
    id: row.id,
    provider: row.provider,
    externalId: row.external_id,
    label: row.label,
    username: row.username,
    avatarUrl: row.avatar_url,
    ...(includeTokens ? { tokens: safeReveal(reveal, row.protected_tokens) } : {}),
    metadata: safeJson(row.metadata, {}),
    expiresAt: row.expires_at,
    connectedAt: row.connected_at,
    updatedAt: row.updated_at,
  };
}

function mapSocialPost(row, db) {
  const targets = db.prepare("SELECT * FROM social_post_targets WHERE post_id = ? ORDER BY id").all(row.id).map((target) => ({
    id: target.id,
    accountId: target.account_id,
    provider: target.provider,
    status: target.status,
    progress: target.progress,
    remoteId: target.remote_id,
    remoteUrl: target.remote_url,
    error: target.error,
    updatedAt: target.updated_at,
  }));
  return {
    id: row.id,
    videoName: row.video_name,
    videoPath: row.video_path,
    caption: row.caption,
    status: row.status,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
    targets,
  };
}

function safeJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function safeReveal(reveal, value) {
  try { return reveal(value) || {}; } catch { return {}; }
}

