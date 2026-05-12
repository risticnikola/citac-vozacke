import { Type } from '@sinclair/typebox';
import { pool } from '../../db/client.js';
import { withTenantContext } from '../../db/tenant-context.js';
const JobBody = Type.Object({
    vehicleId: Type.String({ format: 'uuid' }),
    title: Type.String({ minLength: 1, maxLength: 255 }),
    description: Type.Optional(Type.String()),
    priceCents: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
    performedAt: Type.Optional(Type.String({ format: 'date' })),
});
const JobPatchBody = Type.Object({
    title: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
    description: Type.Optional(Type.String()),
    priceCents: Type.Optional(Type.Integer({ minimum: 0 })),
    performedAt: Type.Optional(Type.String({ format: 'date' })),
});
const JobQuerySchema = Type.Object({
    vehicleId: Type.Optional(Type.String({ format: 'uuid' })),
    cursor: Type.Optional(Type.String()),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
});
export const jobsRoutes = async (fastify) => {
    fastify.get('/', {
        schema: { querystring: JobQuerySchema },
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
            const conds = [];
            const vals = [];
            let p = 1;
            if (vehicleId) {
                conds.push(`vehicle_id = $${p++}`);
                vals.push(vehicleId);
            }
            if (decoded) {
                conds.push(`(performed_at, id) < ($${p++}::date, $${p++})`);
                vals.push(decoded.performedAt, decoded.id);
            }
            vals.push(limit + 1);
            const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
            const { rows } = await c.query(`SELECT j.*, u.email AS created_by_email
         FROM jobs j LEFT JOIN users u ON u.id = j.created_by
         ${where}
         ORDER BY j.performed_at DESC, j.id DESC LIMIT $${p}`, vals);
            return rows;
        });
        const hasNextPage = rows.length > limit;
        const items = hasNextPage ? rows.slice(0, limit) : rows;
        const nextCursor = hasNextPage
            ? Buffer.from(JSON.stringify({ id: items.at(-1).id, performedAt: items.at(-1).performed_at })).toString('base64url')
            : null;
        return reply.send({ items, nextCursor, hasNextPage });
    });
    fastify.post('/', {
        schema: { body: JobBody },
        preHandler: [fastify.authenticate, fastify.requireTenantContext],
    }, async (req, reply) => {
        const { vehicleId, title, description, priceCents = 0, performedAt } = req.body;
        const createdBy = req.jwtPayload.sub;
        const rows = await withTenantContext(pool, req.tenantId, async (c) => {
            // Verify vehicle belongs to tenant (RLS enforces this)
            const { rows: vRows } = await c.query(`SELECT id FROM vehicles WHERE id=$1 AND deleted_at IS NULL`, [vehicleId]);
            if (!vRows.length)
                throw Object.assign(new Error('Vehicle not found'), { statusCode: 404 });
            const { rows } = await c.query(`INSERT INTO jobs (tenant_id, vehicle_id, title, description, price_cents, performed_at, created_by)
         VALUES ($1,$2,$3,$4,$5,$6::date,$7) RETURNING *`, [req.tenantId, vehicleId, title, description ?? null,
                priceCents, performedAt ?? new Date().toISOString().slice(0, 10), createdBy]);
            return rows;
        });
        return reply.code(201).send(rows[0]);
    });
    fastify.patch('/:id', {
        schema: { body: JobPatchBody },
        preHandler: [fastify.authenticate, fastify.requireTenantContext],
    }, async (req, reply) => {
        const { id } = req.params;
        const { title, description, priceCents, performedAt } = req.body;
        const rows = await withTenantContext(pool, req.tenantId, async (c) => {
            const { rows } = await c.query(`UPDATE jobs SET
           title        = COALESCE($2, title),
           description  = COALESCE($3, description),
           price_cents  = COALESCE($4, price_cents),
           performed_at = COALESCE($5::date, performed_at),
           updated_at   = NOW()
         WHERE id=$1 RETURNING *`, [id, title ?? null, description ?? null, priceCents ?? null, performedAt ?? null]);
            return rows;
        });
        if (!rows.length)
            return reply.code(404).send({ error: 'Not found' });
        return reply.send(rows[0]);
    });
    fastify.delete('/:id', {
        preHandler: [fastify.authenticate, fastify.requireTenantContext],
    }, async (req, reply) => {
        const { id } = req.params;
        const rows = await withTenantContext(pool, req.tenantId, async (c) => {
            const { rows } = await c.query(`DELETE FROM jobs WHERE id=$1 RETURNING id`, [id]);
            return rows;
        });
        if (!rows.length)
            return reply.code(404).send({ error: 'Not found' });
        return reply.code(204).send();
    });
};
