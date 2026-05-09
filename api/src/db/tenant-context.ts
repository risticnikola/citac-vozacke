// api/src/db/tenant-context.ts
import { Pool, PoolClient } from 'pg';

// ALL queries touching tenant-scoped tables must use this wrapper.
// SET LOCAL scopes the config variable to this transaction only.
// PgBouncer releases the connection after COMMIT, preventing the setting
// from bleeding into another tenant's request on the same pooled connection.
export async function withTenantContext<T>(
  pool: Pool,
  tenantId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT set_config('app.current_tenant_id', $1, true)",
      [tenantId],
    );
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
