// bridge/src/bridge/queue.ts
// SQLite-backed offline queue with WAL mode and exponential backoff
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import type { QueuedRead } from '../types.js';

const MAX_RETRY = 10;
const BASE_BACKOFF_MS = 1_000;

let db: Database.Database;

export function initQueue(dbPath: string): void {
  db = new Database(dbPath);
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

export function enqueue(item: Omit<QueuedRead, 'id' | 'retryCount' | 'createdAt'>): void {
  const idempotencyKey = item.idempotencyKey || randomUUID();
  db.prepare(
    `INSERT OR IGNORE INTO offline_queue
       (device_id, card_serial, card_type, raw_dump, idempotency_key, next_retry_at, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?)`,
  ).run(item.deviceId, item.cardSerial, item.cardType, item.rawDump,
        idempotencyKey, Date.now());
}

export function dequeueReady(limit = 10): QueuedRead[] {
  const now = Date.now();
  return db.prepare(
    `SELECT id, device_id, card_serial, card_type, raw_dump, idempotency_key,
            retry_count, created_at
     FROM offline_queue
     WHERE next_retry_at <= ? AND retry_count < ?
     ORDER BY created_at ASC
     LIMIT ?`,
  ).all(now, MAX_RETRY, limit) as QueuedRead[];
}

export function markSuccess(id: number): void {
  db.prepare('DELETE FROM offline_queue WHERE id=?').run(id);
}

export function markFailed(id: number): void {
  const row = db.prepare('SELECT retry_count FROM offline_queue WHERE id=?')
    .get(id) as { retry_count: number } | undefined;
  if (!row) return;

  const newCount = row.retry_count + 1;
  if (newCount >= MAX_RETRY) {
    db.prepare('DELETE FROM offline_queue WHERE id=?').run(id);
    return;
  }

  const backoffMs = Math.min(BASE_BACKOFF_MS * 2 ** newCount, 300_000);
  db.prepare(
    `UPDATE offline_queue SET retry_count=?, next_retry_at=? WHERE id=?`,
  ).run(newCount, Date.now() + backoffMs, id);
}

export function queueDepth(): number {
  const row = db.prepare('SELECT COUNT(*) AS cnt FROM offline_queue').get() as { cnt: number };
  return row.cnt;
}
