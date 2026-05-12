// api/tests/helpers.ts
import 'dotenv/config';
import { buildApp } from '../src/app.js';
import type { FastifyInstance } from 'fastify';
import { sign } from 'jsonwebtoken';
import { randomUUID } from 'crypto';

export const TEST_JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret';

export async function buildTestApp(): Promise<FastifyInstance> {
  return buildApp();
}

export function makeUserToken(tenantId: string, userId?: string): string {
  return sign(
    { sub: userId ?? randomUUID(), tenantId, role: 'user' },
    TEST_JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '1h' },
  );
}

export const TENANT_A = randomUUID();
export const TENANT_B = randomUUID();
