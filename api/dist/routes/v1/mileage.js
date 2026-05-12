import { Type } from '@sinclair/typebox';
import { pool } from '../../db/client.js';
import { withTenantContext } from '../../db/tenant-context.js';
const MileageBody = Type.Object({
    vehicleId: Type.String({ format: 'uuid' }),
    mileageKm: Type.Integer({ minimum: 0 }),
    recordedAt: Type.Optional(Type.String({ format: 'date-time' })),
    note: Type.Optional(Type.String()),
});
const MileageQuerySchema = Type.Object({
    vehicleId: Type.String({ format: 'uuid' }),
    cursor: Type.Optional(Type.String()),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
});
export const mileageRoutes = async (fastify) => {
    fastify.get('/', {
        schema: { querystring: MileageQuerySchema },
        preHandler: [fastify.authenticate, fastify.requireTenantContext],
    }, async (req, reply) => {
        const { vehicleId, limit = 20, cursor } = req.query;
        let decoded = null;
        if (cursor) {
            try {
                decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString());
            }
            catch {
                return reply.code(400).send({ error: 'Invalid cursor' });
            }
        }
        const rows = await withTenantContext(pool, req.tenantId, async (c) => {
            const conds = [`vehicle_id = $1`];
            const vals = [vehicleId];
            let p = 2;
            if (decoded) {
                conds.push(`(recorded_at, id) < ($${p++}, $${p++})`);
                vals.push(decoded.recordedAt, decoded.id);
            }
            vals.push(limit + 1);
            const { rows } = await c.query(`SELECT m.*, u.email AS recorded_by_email
         FROM mileage_history m LEFT JOIN users u ON u.id = m.recorded_by
         WHERE ${conds.join(' AND ')}
         ORDER BY m.recorded_at DESC, m.id DESC LIMIT $${p}`, vals);
            return rows;
        });
        const hasNextPage = rows.length > limit;
        const items = hasNextPage ? rows.slice(0, limit) : rows;
        const nextCursor = hasNextPage
            ? Buffer.from(JSON.stringify({ id: items.at(-1).id, recordedAt: items.at(-1).recorded_at })).toString('base64url')
            : null;
        return reply.send({ items, nextCursor, hasNextPage });
    });
    fastify.post('/', {
        schema: { body: MileageBody },
        preHandler: [fastify.authenticate, fastify.requireTenantContext],
    }, async (req, reply) => {
        const { vehicleId, mileageKm, recordedAt, note } = req.body;
        const recordedBy = req.jwtPayload.sub;
        const rows = await withTenantContext(pool, req.tenantId, async (c) => {
            // Verify vehicle belongs to tenant (RLS enforces this)
            const { rows: vRows } = await c.query(`SELECT id, current_mileage_km FROM vehicles WHERE id=$1 AND deleted_at IS NULL`, [vehicleId]);
            if (!vRows.length)
                throw Object.assign(new Error('Vehicle not found'), { statusCode: 404 });
            const { rows } = await c.query(`INSERT INTO mileage_history (tenant_id, vehicle_id, mileage_km, recorded_at, recorded_by, note)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [req.tenantId, vehicleId, mileageKm,
                recordedAt ?? new Date().toISOString(), recordedBy, note ?? null]);
            // Keep vehicles.current_mileage_km as the highest recorded value
            await c.query(`UPDATE vehicles SET current_mileage_km = $2
         WHERE id=$1 AND (current_mileage_km IS NULL OR current_mileage_km < $2)`, [vehicleId, mileageKm]);
            return rows;
        });
        return reply.code(201).send(rows[0]);
    });
};
