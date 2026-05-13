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
