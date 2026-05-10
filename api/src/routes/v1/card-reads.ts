// api/src/routes/v1/card-reads.ts
import { FastifyPluginAsync } from 'fastify';
import { Type, Static } from '@sinclair/typebox';
import { cardReadService } from '../../services/card-read.service.js';
import { cardReadLatency, cardReadTotal, failedReadsTotal } from '../../metrics.js';

const CardReadBodySchema = Type.Object({
  deviceId:   Type.String({ format: 'uuid' }),
  rawDump:    Type.String({ minLength: 1 }),
  cardSerial: Type.String({ maxLength: 64 }),
  cardType:   Type.Union([
    Type.Literal('vehicle_registration'),
    Type.Literal('id_card'),
    Type.Literal('other'),
  ]),
  parsedData: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});
type CardReadBody = Static<typeof CardReadBodySchema>;

const CardReadHeadersSchema = Type.Object({ 'idempotency-key': Type.String({ minLength: 32, maxLength: 128 }) });
type CardReadHeaders = Static<typeof CardReadHeadersSchema>;

const CardReadQuerySchema = Type.Object({
  cursor:    Type.Optional(Type.String()),
  limit:     Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
  vehicleId: Type.Optional(Type.String({ format: 'uuid' })),
});
type CardReadQuery = Static<typeof CardReadQuerySchema>;

export const cardReadsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Body: CardReadBody; Headers: CardReadHeaders }>('/', {
    schema: {
      body: CardReadBodySchema,
      headers: CardReadHeadersSchema,
    },
    preHandler: [fastify.authenticate, fastify.requireTenantContext],
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
    } catch (err: any) {
      failedReadsTotal.inc({ tenant_id: tenantId, error_type: err.statusCode === 422 ? 'validation' : 'internal' });
      stop({ status: 'error' });
      throw err;
    }
  });

  fastify.get<{ Querystring: CardReadQuery }>('/', {
    schema: {
      querystring: CardReadQuerySchema,
    },
    preHandler: [fastify.authenticate, fastify.requireTenantContext],
  }, async (req, reply) => {
    const { cursor, limit = 20, vehicleId } = req.query;
    return reply.send(await cardReadService.list({ tenantId: req.tenantId, cursor, limit, vehicleId }));
  });
};
