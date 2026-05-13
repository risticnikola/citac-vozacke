import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import 'dotenv/config';
import { buildApp } from '../../src/app.js';
import { attachBridgeHub } from '../../src/hub/bridge-hub.js';
import WebSocket from 'ws';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;
let baseUrl: string;

beforeAll(async () => {
  process.env.JWT_SECRET ??= 'test-secret';
  app = await buildApp();
  attachBridgeHub(app.server);
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address() as { port: number };
  baseUrl = `ws://127.0.0.1:${addr.port}`;
});

afterAll(async () => { await app.close(); });

it('rejects bridge WS connection without Authorization header', async () => {
  const ws = new WebSocket(`${baseUrl}/v1/devices/ws`);
  await new Promise<void>((resolve) => {
    ws.on('close', (code) => {
      expect(code).toBe(4001);
      resolve();
    });
  });
});

it('rejects bridge WS connection with invalid JWT', async () => {
  const ws = new WebSocket(`${baseUrl}/v1/devices/ws`, {
    headers: { Authorization: 'Bearer not.a.valid.jwt' },
  });
  await new Promise<void>((resolve) => {
    ws.on('close', (code) => {
      expect(code).toBe(4001);
      resolve();
    });
  });
});
