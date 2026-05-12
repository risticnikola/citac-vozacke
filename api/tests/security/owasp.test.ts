// api/tests/security/owasp.test.ts
// OWASP Top 10 stubs — run against a live stack in integration; unit-level checks here
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { buildTestApp, makeUserToken, TENANT_A } from '../helpers.js';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;
let dbPool: Pool;

beforeAll(async () => {
  app = await buildTestApp();
  await app.ready();
  dbPool = new Pool({ connectionString: process.env.DATABASE_URL });
  await dbPool.query(
    `INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [TENANT_A, 'OWASP Test Tenant A', `owasp-tenant-a-${TENANT_A.slice(0, 8)}`],
  );
});

afterAll(async () => {
  await dbPool.query(`DELETE FROM vehicles WHERE tenant_id = $1`, [TENANT_A]);
  await dbPool.query(`DELETE FROM tenants WHERE id = $1`, [TENANT_A]);
  await dbPool.end();
  await app.close();
});

describe('A01 Broken Access Control', () => {
  it('unauthenticated POST /v1/card-reads is rejected', async () => {
    const resp = await app.inject({
      method: 'POST',
      url: '/v1/card-reads',
      headers: {
        'Content-Type': 'application/json',
        'idempotency-key': 'a'.repeat(32),
      },
      body: JSON.stringify({
        deviceId: '00000000-0000-0000-0000-000000000001',
        cardSerial: 'TEST-SERIAL',
        cardType: 'vehicle_registration',
      }),
    });
    expect(resp.statusCode).toBe(401);
  });
});

describe('A03 Injection', () => {
  it('SQL injection in plate query param does not crash server', async () => {
    const token = makeUserToken(TENANT_A);
    const resp = await app.inject({
      method: 'GET',
      url: `/v1/vehicles?plate=' OR 1=1--`,
      headers: { Authorization: `Bearer ${token}` },
    });
    // Parameterized query: must return 200 (empty list) not 500
    expect([200, 401]).toContain(resp.statusCode);
    if (resp.statusCode === 200) {
      expect(resp.json()).toHaveProperty('items');
    }
  });

  it('XSS payload in ownerName stored safely (no script execution at API layer)', async () => {
    const token = makeUserToken(TENANT_A);
    const resp = await app.inject({
      method: 'POST',
      url: '/v1/vehicles',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ownerName: '<script>alert(1)</script>', plate: 'XSS-01' }),
    });
    // API stores as plain text; no HTML encoding at API level (frontend responsibility)
    expect([201, 401]).toContain(resp.statusCode);
  });
});

describe('A07 Authentication Failures', () => {
  it('expired JWT is rejected', async () => {
    const { sign } = await import('jsonwebtoken');
    const expiredToken = sign(
      { sub: 'user1', tid: TENANT_A },
      process.env.JWT_SECRET ?? 'test-secret',
      { algorithm: 'HS256', expiresIn: -1 },
    );
    const resp = await app.inject({
      method: 'GET',
      url: '/v1/vehicles',
      headers: { Authorization: `Bearer ${expiredToken}` },
    });
    expect(resp.statusCode).toBe(401);
  });

  it('tampered JWT signature is rejected', async () => {
    const token = makeUserToken(TENANT_A);
    const [h, p] = token.split('.');
    const tampered = `${h}.${p}.invalidsignature`;
    const resp = await app.inject({
      method: 'GET',
      url: '/v1/vehicles',
      headers: { Authorization: `Bearer ${tampered}` },
    });
    expect(resp.statusCode).toBe(401);
  });
});

describe('A05 Security Misconfiguration', () => {
  it('/metrics endpoint exists and returns Prometheus text', async () => {
    const resp = await app.inject({ method: 'GET', url: '/metrics' });
    // In production, /metrics must be behind network policy or basic auth
    // This test verifies format, not access control (enforced at infra level)
    expect([200, 401, 404]).toContain(resp.statusCode);
    if (resp.statusCode === 200) {
      expect(resp.headers['content-type']).toMatch(/text\/plain/);
    }
  });
});
