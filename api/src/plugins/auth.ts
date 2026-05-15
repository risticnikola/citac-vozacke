// api/src/plugins/auth.ts
import fp from 'fastify-plugin';
import jwtPlugin from '@fastify/jwt';
import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import * as crypto from 'crypto';
import { bypassPool } from '../db/client.js';
import { safeGet, safeSet } from '../cache/redis.js';
import type { JwtPayload } from '../types/index.js';

const DEVICE_KEY_TTL = 300;

export const authPlugin: FastifyPluginAsync = fp(async (fastify) => {
  await fastify.register(jwtPlugin, { secret: process.env.JWT_SECRET! });

  fastify.decorate('authenticate', async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) return reply.code(401).send({ error: 'Missing token' });
    const token = auth.slice(7);

    let alg: string;
    try {
      alg = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString()).alg;
    } catch { return reply.code(401).send({ error: 'Malformed token' }); }

    if (alg === 'RS256') return verifyDeviceToken(req, reply, token);

    try {
      req.jwtPayload = await req.jwtVerify<JwtPayload>();
    } catch { return reply.code(401).send({ error: 'Invalid or expired token' }); }
  });
});

async function verifyDeviceToken(req: FastifyRequest, reply: FastifyReply, token: string) {
  let payload: any;
  try { payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()); }
  catch { return reply.code(401).send({ error: 'Malformed device token' }); }

  const { sub: deviceId, kid, tenantId } = payload;
  if (!deviceId || !tenantId) return reply.code(401).send({ error: 'Device token incomplete' });

  const cacheKey = `dev-pubkey:${deviceId}`;
  let pem = await safeGet(cacheKey);

  if (!pem) {
    const { rows } = await bypassPool.query(
      kid
        ? `SELECT public_key_pem, key_id, revoked_at FROM devices WHERE id=$1 AND key_id=$2`
        : `SELECT public_key_pem, key_id, revoked_at FROM devices WHERE id=$1`,
      kid ? [deviceId, kid] : [deviceId],
    );
    if (!rows.length) return reply.code(401).send({ error: 'Unknown device' });
    if (rows[0].revoked_at) return reply.code(401).send({ error: 'Device revoked' });
    pem = rows[0].public_key_pem as string;
    await safeSet(cacheKey, pem, DEVICE_KEY_TTL);
  }

  try {
    const [h, b, s] = token.split('.');
    const valid = crypto.verify(
      'sha256',
      Buffer.from(`${h}.${b}`),
      crypto.createPublicKey(pem!),
      Buffer.from(s, 'base64url'),
    );
    if (!valid || payload.exp * 1000 < Date.now()) throw new Error();
  } catch { return reply.code(401).send({ error: 'Invalid device token' }); }

  req.jwtPayload = { sub: deviceId, tenantId, keyId: kid ?? null, type: 'device', iat: payload.iat, exp: payload.exp };
}
