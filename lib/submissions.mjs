import { DatabaseSync } from "node:sqlite";
import { createHmac, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";

const PROCESS_HASH_SECRET = randomBytes(32);

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 0;

CREATE TABLE IF NOT EXISTS feedback_submissions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id    TEXT NOT NULL UNIQUE,
  created_at   TEXT NOT NULL,
  topic        TEXT NOT NULL,
  subject      TEXT,
  details      TEXT,
  context_url  TEXT,
  contact      TEXT,
  client_hash  TEXT,
  content_hash TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'new'
);

CREATE INDEX IF NOT EXISTS idx_feedback_queue
  ON feedback_submissions (status, created_at);
CREATE INDEX IF NOT EXISTS idx_feedback_dedupe
  ON feedback_submissions (content_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_feedback_client
  ON feedback_submissions (client_hash, created_at);

CREATE TABLE IF NOT EXISTS cooperation_submissions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id    TEXT NOT NULL UNIQUE,
  created_at   TEXT NOT NULL,
  topic        TEXT NOT NULL,
  subject      TEXT NOT NULL,
  product_area TEXT NOT NULL,
  scale        TEXT NOT NULL,
  assurance    TEXT NOT NULL,
  settlement   TEXT NOT NULL,
  source_url   TEXT,
  details      TEXT NOT NULL,
  contact      TEXT NOT NULL,
  consent_at   TEXT NOT NULL,
  client_hash  TEXT,
  content_hash TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'new'
);

CREATE INDEX IF NOT EXISTS idx_cooperation_queue
  ON cooperation_submissions (status, created_at);
CREATE INDEX IF NOT EXISTS idx_cooperation_dedupe
  ON cooperation_submissions (content_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_cooperation_client
  ON cooperation_submissions (client_hash, created_at);

CREATE TABLE IF NOT EXISTS submission_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  actor TEXT NOT NULL,
  previous_status TEXT NOT NULL,
  status TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_submission_actions ON submission_actions(public_id, id);
`;

const FEEDBACK_TOPICS = new Set([
  "price_wrong", "sold_out", "warranty_wrong", "category_wrong", "dead_link",
  "missing_item", "page_problem", "suggestion", "other",
]);
const COOPERATION_TOPICS = new Set(["supply", "demand"]);
const PRODUCT_AREAS = new Set(["chatgpt", "claude", "gemini", "grok_x", "api_relay", "mail_verify", "other"]);
const SCALES = new Set(["trial", "small", "monthly", "large", "negotiable"]);
const ASSURANCES = new Set(["full_warranty", "subscription_cover", "activation_only", "conditional", "none", "negotiable"]);
const SETTLEMENTS = new Set(["cny", "usdt", "both", "negotiable"]);
const STATUSES = new Set(["new", "reviewing", "resolved", "contacted", "accepted", "closed", "rejected"]);

export class SubmissionError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "SubmissionError";
    this.status = status;
  }
}

// DatabaseSync must never sleep on the HTTP event loop. Callers may retry later.
export function isSubmissionBusy(error) {
  return [5, 6].includes(Number(error?.errcode) & 255)
    || /^(SQLITE_BUSY|SQLITE_LOCKED)(_|$)/.test(error?.code || '');
}

export function openSubmissionsDb(dbPath, { now = new Date() } = {}) {
  if (dbPath !== ":memory:") mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(SCHEMA);
    purgeExpiredClientHashes(db, now);
  } catch (error) { db.close(); throw error; }
  return db;
}

function text(value, { field, min = 0, max, required = false }) {
  if (value == null || value === "") {
    if (required) throw new SubmissionError(422, `请填写${field}`);
    return null;
  }
  if (typeof value !== "string") throw new SubmissionError(422, `${field}格式不正确`);
  const result = value.replace(/\r\n?/g, "\n").trim();
  if (/\u0000|[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(result)) {
    throw new SubmissionError(422, `${field}包含不可用字符`);
  }
  if (required && result.length < min) throw new SubmissionError(422, `${field}至少需要 ${min} 个字`);
  if (result.length > max) throw new SubmissionError(422, `${field}不能超过 ${max} 个字`);
  return result || null;
}

function oneOf(value, choices, field) {
  if (typeof value !== "string" || !choices.has(value)) {
    throw new SubmissionError(422, `请检查${field}选项`);
  }
  return value;
}

function safeContextUrl(value, { httpsOnly = false } = {}) {
  const input = text(value, { field: "链接", max: 500 });
  if (!input) return null;
  if (!httpsOnly && input.startsWith("/") && !input.startsWith("//")) return input;
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new SubmissionError(422, "链接格式不正确");
  }
  const protocols = httpsOnly ? new Set(["https:"]) : new Set(["http:", "https:"]);
  if (!protocols.has(url.protocol) || url.username || url.password) {
    throw new SubmissionError(422, httpsOnly ? "证明链接必须使用 HTTPS" : "链接格式不正确");
  }
  return url.href;
}

function rejectSecrets(values) {
  const content = values.filter(Boolean).join("\n");
  const patterns = [
    /\bsk-[A-Za-z0-9_-]{16,}\b/i,
    /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/i,
    /\bxox[baprs]-[A-Za-z0-9-]{12,}\b/i,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
    /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/i,
  ];
  if (patterns.some((pattern) => pattern.test(content))) {
    throw new SubmissionError(422, "请删除密码、API Key 或私钥等敏感凭据后再提交");
  }
}

function normalizedHashSecret(value) {
  const secret = value || PROCESS_HASH_SECRET;
  if ((typeof secret === "string" || Buffer.isBuffer(secret)) && secret.length >= 32) return secret;
  throw new Error("SUBMISSION_HASH_SECRET 必须至少包含 32 个字符");
}

function clientHash(secret, address) {
  return createHmac("sha256", secret).update(String(address || "unknown")).digest("hex");
}

function contentHash(secret, payload) {
  return createHmac("sha256", secret).update(JSON.stringify(payload)).digest("hex");
}

function publicId(kind, date) {
  const prefix = kind === "feedback" ? "FB" : "CO";
  // 对外编号跟站点展示时区一致，避免北京时间凌晨仍出现“昨天”的编号。
  const day = new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10).replaceAll("-", "");
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  let suffix = "";
  for (const byte of bytes) suffix += alphabet[byte % alphabet.length];
  return `${prefix}-${day}-${suffix}`;
}

function recentCount(db, client, since) {
  const feedback = db.prepare(
    "SELECT COUNT(*) count FROM feedback_submissions WHERE client_hash = ? AND created_at >= ?"
  ).get(client, since).count;
  const cooperation = db.prepare(
    "SELECT COUNT(*) count FROM cooperation_submissions WHERE client_hash = ? AND created_at >= ?"
  ).get(client, since).count;
  return Number(feedback) + Number(cooperation);
}

function enforceRateLimit(db, kind, client, now) {
  const hour = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const day = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const table = kind === "feedback" ? "feedback_submissions" : "cooperation_submissions";
  const hourlyLimit = kind === "feedback" ? 6 : 3;
  const dailyLimit = kind === "feedback" ? 20 : 5;
  const hourly = Number(db.prepare(`SELECT COUNT(*) count FROM ${table} WHERE client_hash = ? AND created_at >= ?`).get(client, hour).count);
  const daily = Number(db.prepare(`SELECT COUNT(*) count FROM ${table} WHERE client_hash = ? AND created_at >= ?`).get(client, day).count);
  if (hourly >= hourlyLimit || daily >= dailyLimit || recentCount(db, client, hour) >= 12) {
    throw new SubmissionError(429, "提交过于频繁，请稍后再试");
  }
}

export function purgeExpiredClientHashes(db, now = new Date()) {
  const cutoff = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();
  const feedback = db.prepare("UPDATE feedback_submissions SET client_hash = NULL WHERE client_hash IS NOT NULL AND created_at < ?").run(cutoff);
  const cooperation = db.prepare("UPDATE cooperation_submissions SET client_hash = NULL WHERE client_hash IS NOT NULL AND created_at < ?").run(cutoff);
  return Number(feedback.changes) + Number(cooperation.changes);
}

function feedbackPayload(payload) {
  const topic = oneOf(payload.topic, FEEDBACK_TOPICS, "问题类型");
  const subject = text(payload.subject, { field: "相关产品或页面", max: 120 });
  const details = text(payload.details, { field: "补充说明", max: 1500 });
  const contextUrl = safeContextUrl(payload.contextUrl);
  const contact = text(payload.contact, { field: "联系方式", max: 128 });
  if (!details && !subject && !contextUrl) {
    throw new SubmissionError(422, "请填写相关产品、页面链接或补充说明中的至少一项");
  }
  rejectSecrets([subject, details, contextUrl, contact]);
  return { topic, subject, details, contextUrl, contact };
}

function cooperationPayload(payload) {
  const topic = oneOf(payload.topic, COOPERATION_TOPICS, "合作身份");
  const subject = text(payload.subject, { field: "提交标题", min: 4, max: 120, required: true });
  const details = text(payload.details, { field: "合作说明", min: 10, max: 1500, required: true });
  const contact = text(payload.contact, { field: "联系方式", min: 3, max: 128, required: true });
  const sourceUrl = safeContextUrl(payload.contextUrl, { httpsOnly: true });
  const metadata = payload.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new SubmissionError(422, "请补全合作信息");
  }
  const productArea = oneOf(metadata.productArea, PRODUCT_AREAS, "产品方向");
  const scale = oneOf(metadata.scale, SCALES, "合作规模");
  const assurance = oneOf(metadata.assurance, ASSURANCES, "保障方式");
  const settlement = oneOf(metadata.settlement, SETTLEMENTS, "结算方式");
  if (payload.consent !== true) throw new SubmissionError(422, "请确认提交内容不含敏感凭据");
  rejectSecrets([subject, details, contact, sourceUrl]);
  return { topic, subject, details, contact, sourceUrl, productArea, scale, assurance, settlement };
}

export function createSubmission(db, payload, {
  clientAddress = "unknown",
  now = new Date(),
  hashSecret = process.env.SUBMISSION_HASH_SECRET || PROCESS_HASH_SECRET,
} = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new SubmissionError(422, "提交内容格式不正确");
  }
  const kind = oneOf(payload.kind, new Set(["feedback", "cooperation"]), "提交类型");
  if (payload.website) return { id: publicId(kind, now), inserted: false, honeypot: true };

  const secret = normalizedHashSecret(hashSecret);
  const normalized = kind === "feedback" ? feedbackPayload(payload) : cooperationPayload(payload);
  const hash = contentHash(secret, { kind, ...normalized });
  const table = kind === "feedback" ? "feedback_submissions" : "cooperation_submissions";
  const duplicate = db.prepare(
    `SELECT public_id FROM ${table} WHERE content_hash = ? AND created_at >= ? ORDER BY id DESC LIMIT 1`
  ).get(hash, new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString());
  if (duplicate) throw new SubmissionError(409, "这条内容已经提交过，我们会按原记录处理");

  purgeExpiredClientHashes(db, now);
  const client = clientHash(secret, clientAddress);
  enforceRateLimit(db, kind, client, now);
  const createdAt = now.toISOString();

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const id = publicId(kind, now);
    try {
      if (kind === "feedback") {
        db.prepare(
          `INSERT INTO feedback_submissions
             (public_id, created_at, topic, subject, details, context_url, contact, client_hash, content_hash)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(id, createdAt, normalized.topic, normalized.subject, normalized.details, normalized.contextUrl, normalized.contact, client, hash);
      } else {
        db.prepare(
          `INSERT INTO cooperation_submissions
             (public_id, created_at, topic, subject, product_area, scale, assurance, settlement,
              source_url, details, contact, consent_at, client_hash, content_hash)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          id, createdAt, normalized.topic, normalized.subject, normalized.productArea, normalized.scale,
          normalized.assurance, normalized.settlement, normalized.sourceUrl, normalized.details,
          normalized.contact, createdAt, client, hash
        );
      }
      return { id, inserted: true };
    } catch (error) {
      if (!/UNIQUE constraint failed: .*\.public_id/i.test(String(error.message)) || attempt === 3) throw error;
    }
  }
  throw new Error("无法生成唯一提交编号");
}

export function listSubmissions(db, { kind = "feedback", status = null, limit = 50 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  if (status && !STATUSES.has(status)) throw new SubmissionError(422, "处理状态不正确");
  if (kind === "feedback") {
    const filter = status ? " WHERE status = ?" : "";
    const rows = status
      ? db.prepare(`SELECT * FROM feedback_submissions${filter} ORDER BY id DESC LIMIT ?`).all(status, safeLimit)
      : db.prepare("SELECT * FROM feedback_submissions ORDER BY id DESC LIMIT ?").all(safeLimit);
    return rows.map((row) => ({ ...row, kind: "feedback", metadata: null }));
  }
  if (kind !== "cooperation") throw new SubmissionError(422, "提交类型不正确");
  const rows = status
    ? db.prepare("SELECT * FROM cooperation_submissions WHERE status = ? ORDER BY id DESC LIMIT ?").all(status, safeLimit)
    : db.prepare("SELECT * FROM cooperation_submissions ORDER BY id DESC LIMIT ?").all(safeLimit);
  return rows.map((row) => ({
    ...row,
    kind: "cooperation",
    context_url: row.source_url,
    metadata: JSON.stringify({
      productArea: row.product_area,
      scale: row.scale,
      assurance: row.assurance,
      settlement: row.settlement,
    }),
  }));
}

export function updateSubmissionStatus(db, publicIdValue, status, { actor = "ssh-cli", note = "", now = new Date() } = {}) {
  if (!STATUSES.has(status)) throw new SubmissionError(422, "处理状态不正确");
  const id = text(publicIdValue, { field: "提交编号", max: 40, required: true });
  const table = id.startsWith("FB-") ? "feedback_submissions" : id.startsWith("CO-") ? "cooperation_submissions" : null;
  if (!table) throw new SubmissionError(422, "提交编号格式不正确");
  const safeNote = text(note, { field: "内部备注", max: 2000 }) || "";
  const safeActor = text(actor, { field: "操作者", max: 100, required: true });
  db.exec("BEGIN IMMEDIATE");
  try {
    const old = db.prepare(`SELECT status FROM ${table} WHERE public_id = ?`).get(id);
    if (!old) { db.exec("ROLLBACK"); return false; }
    db.prepare(`UPDATE ${table} SET status = ? WHERE public_id = ?`).run(status, id);
    db.prepare("INSERT INTO submission_actions(public_id,created_at,actor,previous_status,status,note) VALUES(?,?,?,?,?,?)")
      .run(id, now.toISOString(), safeActor, old.status, status, safeNote);
    db.exec("COMMIT"); return true;
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}
