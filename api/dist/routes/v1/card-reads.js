import { Type } from '@sinclair/typebox';
import { cardReadService } from '../../services/card-read.service.js';
import { cardReadLatency, cardReadTotal, failedReadsTotal } from '../../metrics.js';
import { checkRateLimit } from '../../cache/redis.js';
const CardReadBodySchema = Type.Object({
    deviceId: Type.String({ format: 'uuid' }),
    rawDump: Type.String({ minLength: 1 }),
    cardSerial: Type.String({ maxLength: 64 }),
    cardType: Type.Union([
        Type.Literal('vehicle_registration'),
        Type.Literal('id_card'),
        Type.Literal('other'),
    ]),
    parsedData: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});
const CardReadHeadersSchema = Type.Object({ 'idempotency-key': Type.String({ minLength: 32, maxLength: 128 }) });
const CardReadQuerySchema = Type.Object({
    cursor: Type.Optional(Type.String()),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
    vehicleId: Type.Optional(Type.String({ format: 'uuid' })),
});
export const cardReadsRoutes = async (fastify) => {
    fastify.post('/', {
        schema: {
            body: CardReadBodySchema,
            headers: CardReadHeadersSchema,
        },
        preHandler: [
            fastify.authenticate,
            fastify.requireTenantContext,
            async (req, reply) => {
                const allowed = await checkRateLimit(`rl:cardread:${req.tenantId}`, 60_000, 60);
                if (!allowed)
                    return reply.code(429).send({ error: 'Rate limit exceeded' });
            },
        ],
    }, async (req, reply) => {
        const tenantId = req.tenantId;
        const stop = cardReadLatency.startTimer({ tenant_id: tenantId });
        try {
            const result = await cardReadService.process({
                tenantId, deviceId: req.body.deviceId,
                rawDump: Buffer.from(req.body.rawDump, 'base64'),
                cardSerial: req.body.cardSerial, cardType: req.body.cardType,
                idempotencyKey: req.headers['idempotency-key'],
                parsedData: req.body.parsedData ?? {},
            });
            cardReadTotal.inc({ tenant_id: tenantId, status: 'success' });
            stop({ status: 'success' });
            return reply.code(201).send(result);
        }
        catch (err) {
            failedReadsTotal.inc({ tenant_id: tenantId, error_type: err.statusCode === 422 ? 'validation' : 'internal' });
            stop({ status: 'error' });
            throw err;
        }
    });
    fastify.get('/', {
        schema: {
            querystring: CardReadQuerySchema,
        },
        preHandler: [fastify.authenticate, fastify.requireTenantContext],
    }, async (req, reply) => {
        const { cursor, limit = 20, vehicleId } = req.query;
        return reply.send(await cardReadService.list({ tenantId: req.tenantId, cursor, limit, vehicleId }));
    });
};
