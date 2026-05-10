"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initQueue = initQueue;
exports.enqueue = enqueue;
exports.dequeueReady = dequeueReady;
exports.markSuccess = markSuccess;
exports.markFailed = markFailed;
exports.queueDepth = queueDepth;
// bridge/src/bridge/queue.ts
// SQLite-backed offline queue with WAL mode and exponential backoff
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const crypto_1 = require("crypto");
const MAX_RETRY = 10;
const BASE_BACKOFF_MS = 1_000;
let db;
function initQueue(dbPath) {
    db = new better_sqlite3_1.default(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.exec(`
    CREATE TABLE IF NOT EXISTS offline_queue (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id       TEXT NOT NULL,
      card_serial     TEXT NOT NULL,
      card_type       TEXT NOT NULL,
      raw_dump        BLOB NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      retry_count     INTEGER NOT NULL DEFAULT 0,
      next_retry_at   INTEGER NOT NULL DEFAULT 0,
      created_at      INTEGER NOT NULL
    )
  `);
}
function enqueue(item) {
    const idempotencyKey = item.idempotencyKey || (0, crypto_1.randomUUID)();
    db.prepare(`INSERT OR IGNORE INTO offline_queue
       (device_id, card_serial, card_type, raw_dump, idempotency_key, next_retry_at, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?)`).run(item.deviceId, item.cardSerial, item.cardType, item.rawDump, idempotencyKey, Date.now());
}
function dequeueReady(limit = 10) {
    const now = Date.now();
    return db.prepare(`SELECT id,
            device_id       AS deviceId,
            card_serial     AS cardSerial,
            card_type       AS cardType,
            raw_dump        AS rawDump,
            idempotency_key AS idempotencyKey,
            retry_count     AS retryCount,
            created_at      AS createdAt
     FROM offline_queue
     WHERE next_retry_at <= ? AND retry_count < ?
     ORDER BY created_at ASC
     LIMIT ?`).all(now, MAX_RETRY, limit);
}
function markSuccess(id) {
    db.prepare('DELETE FROM offline_queue WHERE id=?').run(id);
}
function markFailed(id) {
    const row = db.prepare('SELECT retry_count FROM offline_queue WHERE id=?')
        .get(id);
    if (!row)
        return;
    const newCount = row.retry_count + 1;
    if (newCount >= MAX_RETRY) {
        db.prepare('DELETE FROM offline_queue WHERE id=?').run(id);
        return;
    }
    const backoffMs = Math.min(BASE_BACKOFF_MS * 2 ** newCount, 300_000);
    db.prepare(`UPDATE offline_queue SET retry_count=?, next_retry_at=? WHERE id=?`).run(newCount, Date.now() + backoffMs, id);
}
function queueDepth() {
    const row = db.prepare('SELECT COUNT(*) AS cnt FROM offline_queue').get();
    return row.cnt;
}
//# sourceMappingURL=queue.js.map