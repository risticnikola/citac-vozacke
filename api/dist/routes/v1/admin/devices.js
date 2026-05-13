import { Type } from '@sinclair/typebox';
import { randomUUID, randomBytes } from 'crypto';
import { pool } from '../../../db/client.js';
import { withTenantContext } from '../../../db/tenant-context.js';
function generateActivationToken() {
    // 4 groups of 4 uppercase alphanumeric chars, e.g. A4F2-X9K1-7RPQ-M2NW
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I to avoid confusion
    const bytes = randomBytes(16);
    const groups = [];
    for (let g = 0; g < 4; g++) {
        let group = '';
        for (let i = 0; i < 4; i++)
            group += chars[bytes[g * 4 + i] % chars.length];
        groups.push(group);
    }
    return groups.join('-');
}
const GenerateTokenBody = Type.Object({
    label: Type.Optional(Type.String({ maxLength: 128 })),
    expiresInHours: Type.Optional(Type.Number({ minimum: 1, maximum: 168 })),
});
const DeviceBody = Type.Object({
    serial: Type.String({ maxLength: 128 }),
    name: Type.Optional(Type.String({ maxLength: 128 })),
    platform: Type.Optional(Type.Union([
        Type.Literal('windows'), Type.Literal('linux'), Type.Literal('macos'),
    ])),
    bridgeVersion: Type.Optional(Type.String({ maxLength: 64 })),
    publicKeyPem: Type.String({ minLength: 1 }),
});
export const adminDevicesRoutes = async (fastify) => {
    fastify.get('/', {
        preHandler: [fastify.authenticate, fastify.requireTenantContext],
    }, async (req, reply) => {
        const jwt = req.jwtPayload;
        if (jwt.type !== 'user' || !['garage_admin', 'saas_admin'].includes(jwt.role))
            return reply.code(403).send({ error: 'Forbidden' });
        const { rows } = await pool.query(`SELECT id, name, platform, bridge_version, last_seen_at, created_at, revoked_at
       FROM devices
       WHERE tenant_id = $1
       ORDER BY created_at DESC`, [req.tenantId]);
        return reply.send(rows);
    });
    fastify.delete('/:id', {
        preHandler: [fastify.authenticate, fastify.requireTenantContext],
    }, async (req, reply) => {
        const jwt = req.jwtPayload;
        if (jwt.type !== 'user' || !['garage_admin', 'saas_admin'].includes(jwt.role))
            return reply.code(403).send({ error: 'Forbidden' });
        const { rowCount } = await pool.query(`UPDATE devices SET revoked_at = now()
       WHERE id = $1 AND tenant_id = $2 AND revoked_at IS NULL`, [req.params.id, req.tenantId]);
        if (!rowCount)
            return reply.code(404).send({ error: 'Device not found' });
        return reply.code(204).send();
    });
    fastify.post('/generate-token', {
        schema: { body: GenerateTokenBody },
        preHandler: [fastify.authenticate, fastify.requireTenantContext],
    }, async (req, reply) => {
        const jwt = req.jwtPayload;
        if (jwt.type !== 'user' || !['garage_admin', 'saas_admin'].includes(jwt.role))
            return reply.code(403).send({ error: 'Forbidden' });
        const token = generateActivationToken();
        const hours = req.body.expiresInHours ?? 48;
        const expiresAt = new Date(Date.now() + hours * 3_600_000);
        await pool.query(`INSERT INTO device_activation_tokens (tenant_id, token, label, expires_at)
       VALUES ($1, $2, $3, $4)`, [req.tenantId, token, req.body.label ?? null, expiresAt]);
        return reply.code(201).send({ token, expiresAt, label: req.body.label ?? null });
    });
    fastify.post('/', {
        schema: { body: DeviceBody },
        preHandler: [fastify.authenticate, fastify.requireTenantContext],
    }, async (req, reply) => {
        const jwt = req.jwtPayload;
        if (jwt.type !== 'user' || !['garage_admin', 'saas_admin'].includes(jwt.role))
            return reply.code(403).send({ error: 'Forbidden' });
        const { serial, name, platform, bridgeVersion, publicKeyPem } = req.body;
        const keyId = randomUUID();
        // tenants table has no RLS — query outside tenant context
        const { rows: limitRows } = await pool.query(`SELECT max_devices FROM tenants WHERE id=$1`, [req.tenantId]);
        const maxDevices = limitRows[0]?.max_devices ?? 5;
        const rows = await withTenantContext(pool, req.tenantId, async (c) => {
            const { rows: countRows } = await c.query(`SELECT COUNT(*) AS cnt FROM devices WHERE tenant_id=$1 AND revoked_at IS NULL`, [req.tenantId]);
            if (parseInt(countRows[0].cnt, 10) >= maxDevices)
                throw Object.assign(new Error('Device limit reached for this tenant'), { statusCode: 422 });
            const { rows } = await c.query(`INSERT INTO devices (tenant_id, serial, name, platform, bridge_version, public_key_pem, key_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [req.tenantId, serial, name ?? null, platform ?? null,
                bridgeVersion ?? null, publicKeyPem, keyId]);
            return rows;
        });
        return reply.code(201).send(rows[0]);
    });
};
