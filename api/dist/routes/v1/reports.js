import { Type } from '@sinclair/typebox';
import { pool } from '../../db/client.js';
import { withTenantContext } from '../../db/tenant-context.js';
import { emitEvent } from '../../services/event-emitter.js';
const ReportBody = Type.Object({
    cardReadId: Type.String({ format: 'uuid' }),
});
export const reportsRoutes = async (fastify) => {
    fastify.post('/', {
        schema: { body: ReportBody },
        preHandler: [fastify.authenticate, fastify.requireTenantContext],
    }, async (req, reply) => {
        const { cardReadId } = req.body;
        const rows = await withTenantContext(pool, req.tenantId, async (c) => {
            // card_reads has RLS — query will only match tenant's own records
            const { rows: crRows } = await c.query(`SELECT id FROM card_reads WHERE id=$1`, [cardReadId]);
            if (!crRows.length)
                throw Object.assign(new Error('Card read not found'), { statusCode: 404 });
            const { rows } = await c.query(`INSERT INTO reports (tenant_id, card_read_id) VALUES ($1,$2) RETURNING *`, [req.tenantId, cardReadId]);
            return rows;
        });
        const report = rows[0];
        await emitEvent('report.requested', {
            tenantId: req.tenantId,
            reportId: report.id,
            cardReadId,
        });
        return reply.code(201).send(report);
    });
};
