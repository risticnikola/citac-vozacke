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
    [tenantId, 'VIN Test Tenant', `vin-test-${tenantId.slice(0, 8)}`],
  );
});

afterAll(async () => {
  await dbPool.query(`DELETE FROM vehicles WHERE tenant_id = $1`, [tenantId]);
  await dbPool.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  await dbPool.end();
  await app.close();
});

describe('VIN uniqueness', () => {
  it('rejects a second vehicle with the same VIN in the same tenant', async () => {
    const vin = 'WBA' + randomUUID().replace(/-/g, '').slice(0, 14);

    const first = await inject('POST', '/v1/vehicles', { vin, plate: 'BG 001-AA' });
    expect(first.statusCode).toBe(201);

    const second = await inject('POST', '/v1/vehicles', { vin, plate: 'BG 002-BB' });
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toMatch(/VIN already exists/i);
  });

  it('allows the same VIN after the first vehicle is deleted', async () => {
    const vin = 'WBA' + randomUUID().replace(/-/g, '').slice(0, 14);

    const created = await inject('POST', '/v1/vehicles', { vin, plate: 'NS 100-CC' });
    expect(created.statusCode).toBe(201);
    const { id } = created.json();

    const del = await app.inject({
      method: 'DELETE',
      url: `/v1/vehicles/${id}`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(del.statusCode).toBe(204);

    const reuse = await inject('POST', '/v1/vehicles', { vin, plate: 'NS 200-DD' });
    expect(reuse.statusCode).toBe(201);
  });

  it('allows multiple vehicles without a VIN', async () => {
    const first  = await inject('POST', '/v1/vehicles', { plate: 'KG 001-EE' });
    const second = await inject('POST', '/v1/vehicles', { plate: 'KG 002-FF' });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
  });

  it('rejects PATCH that would create a VIN collision', async () => {
    const vin = 'WBA' + randomUUID().replace(/-/g, '').slice(0, 14);

    await inject('POST', '/v1/vehicles', { vin, plate: 'ZR 001-GG' });

    const other = await inject('POST', '/v1/vehicles', { plate: 'ZR 002-HH' });
    expect(other.statusCode).toBe(201);
    const { id: otherId } = other.json();

    const patch = await inject('PATCH', `/v1/vehicles/${otherId}`, { vin });
    expect(patch.statusCode).toBe(409);
    expect(patch.json().error).toMatch(/VIN already exists/i);
  });
});
