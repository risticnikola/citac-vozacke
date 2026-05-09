// api/src/app.ts
import Fastify, { FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';
import { healthRoutes } from './routes/health.js';
import { authPlugin } from './plugins/auth.js';
import { tenantPlugin } from './plugins/tenant.js';

export async function buildApp(opts: { logger?: boolean | object } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? { level: process.env.LOG_LEVEL ?? 'info' },
    trustProxy: true,
    ajv: { customOptions: { removeAdditional: true, coerceTypes: false } },
  });

  await app.register(sensible);
  await app.register(authPlugin);
  await app.register(tenantPlugin);
  await app.register(healthRoutes);

  const { cardReadsRoutes } = await import('./routes/v1/card-reads.js');
  await app.register(cardReadsRoutes, { prefix: '/v1/card-reads' });

  const { vehiclesRoutes } = await import('./routes/v1/vehicles.js');
  await app.register(vehiclesRoutes, { prefix: '/v1/vehicles' });

  return app;
}
