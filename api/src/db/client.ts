// api/src/db/client.ts
import { Pool } from 'pg';

// PgBouncer transaction mode: no session-level SET (use SET LOCAL inside
// transactions), no LISTEN, no advisory locks, no prepared statements.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 30_000,
});

pool.on('error', (err) => { console.error({ err }, 'pg pool error'); });

// Separate pool with BYPASSRLS role — used only for operations that must
// run before tenant context is known (e.g. login user lookup).
export const bypassPool = new Pool({
  connectionString: process.env.DATABASE_URL_BYPASS ?? process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 30_000,
});

bypassPool.on('error', (err) => { console.error({ err }, 'pg bypass pool error'); });
