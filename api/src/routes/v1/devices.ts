// api/src/routes/v1/devices.ts
// Public endpoint — no JWT required.  The activation token IS the credential.
import { FastifyPluginAsync } from 'fastify';
import { Type, Static } from '@sinclair/typebox';
import { randomUUID, generateKeyPairSync } from 'crypto';
import { pool } from '../../db/client.js';
import { withTenantContext } from '../../db/tenant-context.js';

const ActivateBody = Type.Object({
  token:         Type.String({ minLength: 1 }),
  label:         Type.Optional(Type.String({ maxLength: 128 })),
  platform:      Type.Optional(Type.Union([
    Type.Literal('windows'), Type.Literal('linux'), Type.Literal('macos'),
  ])),
  bridgeVersion: Type.Optional(Type.String({ maxLength: 64 })),
  serial:        Type.Optional(Type.String({ maxLength: 128 })),
});
type ActivateBodyType = Static<typeof ActivateBody>;

export const devicesRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/heartbeat', {
    preHandler: [fastify.authenticate],
  }, async (req, reply) => {
    const jwt = req.jwtPayload as any;
    if (jwt.type !== 'device') return reply.code(403).send({ error: 'Forbidden' });

    await withTenantContext(pool, jwt.tenantId, async (client) => {
      await client.query(
        `UPDATE devices SET last_seen_at = now() WHERE id = $1`,
        [jwt.sub],
      );
    });
    return reply.send({ ok: true });
  });

  fastify.post<{ Body: ActivateBodyType }>('/activate', {
    schema: { body: ActivateBody },
  }, async (req, reply) => {
    const { token, label, platform, bridgeVersion, serial } = req.body;

    // Validate token — single DB round-trip
    const { rows } = await pool.query(
      `SELECT id, tenant_id, label
       FROM device_activation_tokens
       WHERE token = $1
         AND used_at IS NULL
         AND expires_at > now()
       LIMIT 1`,
      [token],
    );
    if (!rows.length) return reply.code(422).send({ error: 'Invalid or expired activation token' });

    const { id: tokenId, tenant_id: tenantId, label: tokenLabel } = rows[0];

    // Generate RSA-2048 keypair — private key returned to bridge, public key stored
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength:    2048,
      publicKeyEncoding:  { type: 'spki',  format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    const keyId   = randomUUID();
    const deviceSerial = serial ?? randomUUID();
    const deviceLabel  = label ?? tokenLabel ?? null;

    // tenants has no RLS — safe to query outside tenant context
    const { rows: limitRows } = await pool.query(
      `SELECT max_devices FROM tenants WHERE id = $1`,
      [tenantId],
    );
    const maxDevices: number = limitRows[0]?.max_devices ?? 5;

    // devices has RLS — count + insert + token stamp all inside one tenant context transaction
    const deviceId = await withTenantContext(pool, tenantId, async (client) => {
      const { rows: countRows } = await client.query(
        `SELECT COUNT(*) AS cnt FROM devices WHERE tenant_id = $1 AND revoked_at IS NULL`,
        [tenantId],
      );
      if (parseInt(countRows[0].cnt, 10) >= maxDevices) return null;

      const { rows: devRows } = await client.query(
        `INSERT INTO devices (tenant_id, serial, name, platform, bridge_version, public_key_pem, key_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [tenantId, deviceSerial, deviceLabel, platform ?? null, bridgeVersion ?? null, publicKey, keyId],
      );

      await client.query(
        `UPDATE device_activation_tokens SET used_at = now() WHERE id = $1`,
        [tokenId],
      );

      return devRows[0].id as string;
    });

    if (!deviceId) return reply.code(422).send({ error: 'Device limit reached for this tenant' });

    // Return everything the bridge needs to build its config.json
    return reply.code(201).send({
      deviceId,
      devicePrivateKey: privateKey,
      tenantId,
    });
  });
};
