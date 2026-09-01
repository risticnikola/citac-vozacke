import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { buildTestApp, makeUserToken } from '../helpers.js';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;
let dbPool: Pool;
const tenantId = randomUUID();
const token = makeUserToken(tenantId);

const inject = (method: string, url: string, body?: unknown) =>
  app.inject({
    method: method as any,
    url,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

beforeAll(async () => {
  app = await buildTestApp();
  await app.ready();
  dbPool = new Pool({ connectionString: process.env.DATABASE_URL });
  await dbPool.query(
    `INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [tenantId, 'Plate Test Tenant', `plate-test-${tenantId.slice(0, 8)}`],
  );
});

afterAll(async () => {
  await dbPool.query(`DELETE FROM vehicles WHERE tenant_id = $1`, [tenantId]);
  await dbPool.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  await dbPool.end();
  await app.close();
});

describe('plate normalization on write', () => {
  it('normalizes a messy standard plate on create', async () => {
    const res = await inject('POST', '/v1/vehicles', { plate: 'kv 138-nc' });
    expect(res.statusCode).toBe(201);
    expect(res.json().plate).toBe('KV138-NC');
  });

  it('stores a custom plate verbatim (trimmed) on create', async () => {
    const res = await inject('POST', '/v1/vehicles', { plate: '  BG-ZMAJ  ' });
    expect(res.statusCode).toBe(201);
    expect(res.json().plate).toBe('BG-ZMAJ');
  });

  it('normalizes a messy standard plate on update', async () => {
    const created = await inject('POST', '/v1/vehicles', { plate: 'NS001AA' });
    const { id } = created.json();

    const patched = await inject('PATCH', `/v1/vehicles/${id}`, { plate: 'ns 002 bb' });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().plate).toBe('NS002-BB');
  });
});
