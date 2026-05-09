// api/src/routes/v1/card-reads.ts
import { FastifyPluginAsync } from 'fastify';
import { Type } from '@sinclair/typebox';
import { cardReadService } from '../../services/card-read.service.js';
import { cardReadLatency, cardReadTotal, failedReadsTotal } from '../../metrics.js';

export const cardReadsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/', {
    schema: {
      body: Type.Object({
        deviceId:   Type.String({ format: 'uuid' }),
        rawDump:    Type.String({ minLength: 1 }),
        cardSerial: Type.String({ maxLength: 64 }),
        cardType:   Type.Union([
          Type.Literal('driver'), Type.Literal('vehicle'),
          Type.Literal('workshop'), Type.Literal('control'),
        ]),
      }),
      headers: Type.Object({ 'idempotency-key': Type.String({ minLength: 32, maxLength: 128 }) }),
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

  fastify.get('/', {
    schema: {
      querystring: Type.Object({
        cursor:    Type.Optional(Type.String()),
        limit:     Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
        vehicleId: Type.Optional(Type.String({ format: 'uuid' })),
      }),
    },
    preHandler: [fastify.authenticate, fastify.requireTenantContext],
  }, async (req, reply) => {
    const { cursor, limit = 20, vehicleId } = req.query;
    return reply.send(await cardReadService.list({ tenantId: req.tenantId, cursor, limit, vehicleId }));
  });
};
