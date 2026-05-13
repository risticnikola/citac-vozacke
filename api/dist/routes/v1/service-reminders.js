import { Type } from '@sinclair/typebox';
import { pool } from '../../db/client.js';
import { withTenantContext } from '../../db/tenant-context.js';
const SERVICE_TYPES = [
    'oil_change', 'tire_rotation', 'small_service', 'big_service',
    'technical_inspection', 'registration_renewal', 'brake_check', 'other',
];
const ReminderBody = Type.Object({
    vehicleId: Type.String({ format: 'uuid' }),
    serviceType: Type.Union(SERVICE_TYPES.map((t) => Type.Literal(t))),
    dueDate: Type.Optional(Type.String({ format: 'date' })),
    dueMileageKm: Type.Optional(Type.Integer({ minimum: 1 })),
    notes: Type.Optional(Type.String()),
    intervalKm: Type.Optional(Type.Integer({ minimum: 1 })),
    intervalDays: Type.Optional(Type.Integer({ minimum: 1 })),
});
const ReminderPatchBody = Type.Object({
    serviceType: Type.Optional(Type.Union(SERVICE_TYPES.map((t) => Type.Literal(t)))),
    dueDate: Type.Optional(Type.String({ format: 'date' })),
    dueMileageKm: Type.Optional(Type.Integer({ minimum: 1 })),
    notes: Type.Optional(Type.String()),
    completed: Type.Optional(Type.Boolean()),
    skipRenewal: Type.Optional(Type.Boolean()),
});
const ReminderQuerySchema = Type.Object({
    vehicleId: Type.Optional(Type.String({ format: 'uuid' })),
    serviceType: Type.Optional(Type.String()),
    status: Type.Optional(Type.Union([Type.Literal('open'), Type.Literal('completed')])),
    dueBefore: Type.Optional(Type.String({ format: 'date' })), // YYYY-MM-DD
    overdue: Type.Optional(Type.Boolean()), // date OR mileage overdue
    dueSoon: Type.Optional(Type.Boolean()),
    cursor: Type.Optional(Type.String()),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
});
export const serviceRemindersRoutes = async (fastify) => {
    fastify.get('/', {
        schema: { querystring: ReminderQuerySchema },
        preHandler: [fastify.authenticate, fastify.requireTenantContext],
    }, async (req, reply) => {
        const { vehicleId, serviceType, status, dueBefore, overdue, dueSoon, limit = 20, cursor } = req.query;
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
                conds.push(`sr.vehicle_id = $${p++}`);
                vals.push(vehicleId);
            }
            if (serviceType) {
                conds.push(`sr.service_type = $${p++}`);
                vals.push(serviceType);
            }
            if (status === 'open')
                conds.push(`sr.completed_at IS NULL`);
            if (status === 'completed')
                conds.push(`sr.completed_at IS NOT NULL`);
            if (dueBefore) {
                conds.push(`sr.due_date IS NOT NULL AND sr.due_date <= $${p++}::date`);
                vals.push(dueBefore);
            }
            // overdue = past due_date OR vehicle mileage has exceeded due_mileage_km
            if (overdue) {
                conds.push(`sr.completed_at IS NULL AND (
          (sr.due_date IS NOT NULL AND sr.due_date < CURRENT_DATE)
          OR
          (sr.due_mileage_km IS NOT NULL AND v.current_mileage_km IS NOT NULL
           AND v.current_mileage_km >= sr.due_mileage_km)
        )`);
            }
            if (dueSoon) {
                conds.push(`sr.completed_at IS NULL AND (
          (sr.due_date IS NOT NULL AND (sr.due_date - CURRENT_DATE) BETWEEN 0 AND 30)
          OR
          (sr.due_mileage_km IS NOT NULL AND v.current_mileage_km IS NOT NULL
           AND (sr.due_mileage_km - v.current_mileage_km) BETWEEN 0 AND 1000)
        )`);
            }
            if (decoded) {
                conds.push(`(sr.due_date, sr.id) > ($${p++}::date, $${p++})`);
                vals.push(decoded.dueDate, decoded.id);
            }
            vals.push(limit + 1);
            const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
            const { rows } = await c.query(`SELECT sr.*,
                v.plate, v.vin, v.make, v.model, v.year, v.current_mileage_km,
                u.email AS completed_by_email,
                CASE
                  WHEN sr.completed_at IS NOT NULL THEN false
                  WHEN sr.due_date IS NOT NULL AND sr.due_date < CURRENT_DATE THEN true
                  WHEN sr.due_mileage_km IS NOT NULL AND v.current_mileage_km IS NOT NULL
                       AND v.current_mileage_km >= sr.due_mileage_km THEN true
                  ELSE false
                END AS is_overdue,
                CASE
                  WHEN sr.due_mileage_km IS NOT NULL AND v.current_mileage_km IS NOT NULL
                  THEN sr.due_mileage_km - v.current_mileage_km
                  ELSE NULL
                END AS km_remaining,
                CASE
                  WHEN sr.due_date IS NOT NULL
                  THEN (sr.due_date - CURRENT_DATE)::int
                  ELSE NULL
                END AS days_remaining,
                CASE
                  WHEN sr.completed_at IS NOT NULL THEN 'ok'
                  WHEN (sr.due_date IS NOT NULL AND sr.due_date < CURRENT_DATE)
                    OR (sr.due_mileage_km IS NOT NULL AND v.current_mileage_km IS NOT NULL
                        AND v.current_mileage_km >= sr.due_mileage_km)
                  THEN 'overdue'
                  -- due_soon uses <= rather than BETWEEN because overdue (km_remaining <= 0)
                  -- is already caught by the branch above; order matters here
                  WHEN (sr.due_mileage_km IS NOT NULL AND v.current_mileage_km IS NOT NULL
                        AND (sr.due_mileage_km - v.current_mileage_km) <= 1000)
                    OR (sr.due_date IS NOT NULL AND (sr.due_date - CURRENT_DATE) <= 30)
                  THEN 'due_soon'
                  ELSE 'ok'
                END AS urgency
         FROM service_reminders sr
         JOIN vehicles v ON v.id = sr.vehicle_id
         LEFT JOIN users u ON u.id = sr.completed_by
         ${where}
         ORDER BY sr.due_date ASC NULLS LAST, sr.id ASC
         LIMIT $${p}`, vals);
            return rows;
        });
        const hasNextPage = rows.length > limit;
        const items = hasNextPage ? rows.slice(0, limit) : rows;
        const nextCursor = hasNextPage
            ? Buffer.from(JSON.stringify({ id: items.at(-1).id, dueDate: items.at(-1).due_date })).toString('base64url')
            : null;
        return reply.send({ items, nextCursor, hasNextPage });
    });
    fastify.post('/', {
        schema: { body: ReminderBody },
        preHandler: [fastify.authenticate, fastify.requireTenantContext],
    }, async (req, reply) => {
        const { vehicleId, serviceType, dueDate, dueMileageKm, notes, intervalKm, intervalDays } = req.body;
        if (!dueDate && !dueMileageKm)
            return reply.code(400).send({ error: 'At least one of dueDate or dueMileageKm is required' });
        const rows = await withTenantContext(pool, req.tenantId, async (c) => {
            const { rows: vRows } = await c.query(`SELECT id FROM vehicles WHERE id=$1 AND deleted_at IS NULL`, [vehicleId]);
            if (!vRows.length)
                throw Object.assign(new Error('Vehicle not found'), { statusCode: 404 });
            const { rows } = await c.query(`INSERT INTO service_reminders
           (tenant_id, vehicle_id, service_type, due_date, due_mileage_km, notes, interval_km, interval_days)
         VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8) RETURNING *`, [req.tenantId, vehicleId, serviceType, dueDate ?? null, dueMileageKm ?? null,
                notes ?? null, intervalKm ?? null, intervalDays ?? null]);
            return rows;
        });
        return reply.code(201).send(rows[0]);
    });
    fastify.patch('/:id', {
        schema: { body: ReminderPatchBody },
        preHandler: [fastify.authenticate, fastify.requireTenantContext],
    }, async (req, reply) => {
        const { id } = req.params;
        const { serviceType, dueDate, dueMileageKm, notes, completed, skipRenewal } = req.body;
        const completedBy = completed ? req.jwtPayload.sub : null;
        const rows = await withTenantContext(pool, req.tenantId, async (c) => {
            // Read current state so renewal only fires on transition from open → complete
            const { rows: existing } = await c.query(`SELECT completed_at FROM service_reminders WHERE id=$1`, [id]);
            const wasAlreadyCompleted = (existing[0]?.completed_at ?? null) != null;
            const { rows } = await c.query(`UPDATE service_reminders SET
           service_type   = COALESCE($2, service_type),
           due_date       = COALESCE($3::date, due_date),
           due_mileage_km = COALESCE($4, due_mileage_km),
           notes          = COALESCE($5, notes),
           completed_at   = CASE
                              WHEN $6 = true  THEN COALESCE(completed_at, NOW())
                              WHEN $6 = false THEN NULL
                              ELSE completed_at
                            END,
           completed_by   = CASE
                              WHEN $6 = true  THEN COALESCE(completed_by, $7::uuid)
                              WHEN $6 = false THEN NULL
                              ELSE completed_by
                            END,
           updated_at     = NOW()
         WHERE id=$1 RETURNING *`, [id, serviceType ?? null, dueDate ?? null, dueMileageKm ?? null,
                notes ?? null, completed ?? null, completedBy]);
            // Auto-renewal: fires only on transition from open → complete, not on repeat calls
            if (rows.length && completed === true && !skipRenewal && !wasAlreadyCompleted) {
                const r = rows[0];
                if (r.interval_km != null || r.interval_days != null) {
                    const { rows: vRows } = await c.query(`SELECT current_mileage_km FROM vehicles WHERE id=$1`, [r.vehicle_id]);
                    const currentMileage = vRows[0]?.current_mileage_km ?? null;
                    const nextMileage = r.interval_km != null && currentMileage != null
                        ? currentMileage + r.interval_km
                        : null;
                    if (nextMileage != null || r.interval_days != null) {
                        await c.query(`INSERT INTO service_reminders
                 (tenant_id, vehicle_id, service_type, due_date, due_mileage_km, notes, interval_km, interval_days)
               VALUES ($1,$2,$3,
                 CASE WHEN $4::int IS NOT NULL THEN CURRENT_DATE + ($4::int || ' days')::INTERVAL ELSE NULL END,
                 $5,$6,$7,$8)`, [r.tenant_id, r.vehicle_id, r.service_type,
                            r.interval_days ?? null,
                            nextMileage ?? null,
                            r.notes ?? null,
                            r.interval_km ?? null,
                            r.interval_days ?? null]);
                    }
                }
            }
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
            const { rows } = await c.query(`DELETE FROM service_reminders WHERE id=$1 RETURNING id`, [id]);
            return rows;
        });
        if (!rows.length)
            return reply.code(404).send({ error: 'Not found' });
        return reply.code(204).send();
    });
};
