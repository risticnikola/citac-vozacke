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
    ajv: { customOptions: { removeAdditional: true, coerceTypes: 'array' } },
  });

  const allowedOrigin = process.env.CORS_ORIGIN ?? '*';
  app.addHook('onRequest', async (req, reply) => {
    const origin = req.headers.origin ?? '*';
    reply.header('Access-Control-Allow-Origin', allowedOrigin === '*' ? origin : allowedOrigin);
    reply.header('Access-Control-Allow-Credentials', 'true');
    reply.header('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return reply.code(204).send();
  });

  await app.register(sensible);
  await app.register(authPlugin);
  await app.register(tenantPlugin);
  await app.register(healthRoutes);

  const { cardReadsRoutes } = await import('./routes/v1/card-reads.js');
  await app.register(cardReadsRoutes, { prefix: '/v1/card-reads' });

  const { vehiclesRoutes } = await import('./routes/v1/vehicles.js');
  await app.register(vehiclesRoutes, { prefix: '/v1/vehicles' });

  const { authRoutes } = await import('./routes/v1/auth.js');
  await app.register(authRoutes, { prefix: '/v1/auth' });

  const { adminDevicesRoutes } = await import('./routes/v1/admin/devices.js');
  await app.register(adminDevicesRoutes, { prefix: '/v1/admin/devices' });

  const { devicesRoutes } = await import('./routes/v1/devices.js');
  await app.register(devicesRoutes, { prefix: '/v1/devices' });

  const { reportsRoutes } = await import('./routes/v1/reports.js');
  await app.register(reportsRoutes, { prefix: '/v1/reports' });

  const { jobsRoutes } = await import('./routes/v1/jobs.js');
  await app.register(jobsRoutes, { prefix: '/v1/jobs' });

  const { mileageRoutes } = await import('./routes/v1/mileage.js');
  await app.register(mileageRoutes, { prefix: '/v1/mileage' });

  const { serviceRemindersRoutes } = await import('./routes/v1/service-reminders.js');
  await app.register(serviceRemindersRoutes, { prefix: '/v1/service-reminders' });

  return app;
}
