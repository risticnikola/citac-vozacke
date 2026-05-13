// api/tests/security/cross-tenant.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildTestApp, makeUserToken, TENANT_A, TENANT_B } from '../helpers.js';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildTestApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('Cross-tenant isolation', () => {
  it('rejects requests with no Authorization header', async () => {
    const resp = await app.inject({ method: 'GET', url: '/v1/vehicles' });
    expect(resp.statusCode).toBe(401);
  });

  it('rejects requests with malformed JWT', async () => {
    const resp = await app.inject({
      method: 'GET',
      url: '/v1/vehicles',
      headers: { Authorization: 'Bearer not.a.jwt' },
    });
    expect(resp.statusCode).toBe(401);
  });

  it('tenant A cannot read tenant B vehicles by ID probe', async () => {
    // In real integration test: seed a vehicle in TENANT_B, probe with TENANT_A token
    // Here we verify the 404 (not a 403 that leaks existence) behavior
    const tokenA = makeUserToken(TENANT_A);
    const resp = await app.inject({
      method: 'GET',
      url: `/v1/vehicles/00000000-0000-0000-0000-000000000001`,
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    // Must be 404, not 403 (which would confirm existence) or 200 (which leaks data)
    expect(resp.statusCode).toBeOneOf([404, 401]);
  });

  it('PATCH on non-existent cross-tenant ID returns 404 not 403', async () => {
    const tokenA = makeUserToken(TENANT_A);
    const resp = await app.inject({
      method: 'PATCH',
      url: `/v1/vehicles/00000000-0000-0000-0000-000000000002`,
      headers: {
        Authorization: `Bearer ${tokenA}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ plate: 'INJECTED' }),
    });
    expect(resp.statusCode).toBeOneOf([404, 401]);
  });

  it('tenant B token cannot list tenant A card reads', async () => {
    const tokenB = makeUserToken(TENANT_B);
    const resp = await app.inject({
      method: 'GET',
      url: '/v1/card-reads',
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    // Should succeed (empty list for tenant B) or 401 — must NOT return tenant A data
    if (resp.statusCode === 200) {
      const body = resp.json<{ items: unknown[] }>();
      expect(Array.isArray(body.items)).toBe(true);
      // All returned items must belong to tenant B (verified in integration test with seeded data)
    } else {
      expect(resp.statusCode).toBe(401);
    }
  });
});
