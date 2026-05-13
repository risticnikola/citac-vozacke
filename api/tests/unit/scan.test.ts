import { it, expect, beforeAll, afterAll } from 'vitest';
import 'dotenv/config';
import { buildApp } from '../../src/app.js';
import { attachBridgeHub } from '../../src/hub/bridge-hub.js';
import { attachWebHub } from '../../src/hub/web-hub.js';
import { sign } from 'jsonwebtoken';
import type { FastifyInstance } from 'fastify';

const JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret';
const TENANT_ID = 'test-tenant-scan';

let app: FastifyInstance;

beforeAll(async () => {
  process.env.JWT_SECRET ??= 'test-secret';
  app = await buildApp();
  attachBridgeHub(app.server);
  attachWebHub(app.server);
  await app.listen({ port: 0, host: '127.0.0.1' });
});

afterAll(async () => { await app.close(); });

it('POST /v1/scan returns 503 when no bridge connected for tenant', async () => {
  const token = sign(
    { sub: 'user-1', tenantId: TENANT_ID, role: 'mechanic' },
    JWT_SECRET,
    { expiresIn: '1h' },
  );
  const res = await app.inject({
    method: 'POST',
    url: '/v1/scan',
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.statusCode).toBe(503);
  const body = JSON.parse(res.body);
  expect(body.error).toMatch(/no.*bridge/i);
});
