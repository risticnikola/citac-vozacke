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

function userToken(tenantId = TENANT_ID) {
  return sign(
    { sub: 'user-1', tenantId, role: 'mechanic' },
    JWT_SECRET,
    { expiresIn: '1h' },
  );
}

it('POST /v1/scan returns 400 when deviceId is missing', async () => {
  const res = await app.inject({
    method:  'POST',
    url:     '/v1/scan',
    headers: { Authorization: `Bearer ${userToken()}`, 'Content-Type': 'application/json' },
    payload: {},
  });
  expect(res.statusCode).toBe(400);
  expect(JSON.parse(res.body).error).toMatch(/deviceId/i);
});

it('POST /v1/scan returns 503 when deviceId is not connected', async () => {
  const res = await app.inject({
    method:  'POST',
    url:     '/v1/scan',
    headers: { Authorization: `Bearer ${userToken()}`, 'Content-Type': 'application/json' },
    payload: { deviceId: 'device-that-does-not-exist' },
  });
  expect(res.statusCode).toBe(503);
  expect(JSON.parse(res.body).error).toMatch(/not connected/i);
});

it('POST /v1/scan returns 401 when not authenticated', async () => {
  const res = await app.inject({
    method:  'POST',
    url:     '/v1/scan',
    payload: { deviceId: 'any-device' },
  });
  expect(res.statusCode).toBe(401);
});
