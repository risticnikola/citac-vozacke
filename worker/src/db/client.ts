// worker/src/db/client.ts
import pg from 'pg';

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30_000,
  statement_timeout: 30_000,
});

pool.on('error', (err) => {
  console.error({ err }, 'pg pool error');
});
