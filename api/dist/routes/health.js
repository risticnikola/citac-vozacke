import { pool } from '../db/client.js';
import { isRedisHealthy } from '../cache/redis.js';
export const healthRoutes = async (fastify) => {
    fastify.get('/health', async (_req, reply) => reply.send({ status: 'ok' }));
    fastify.get('/ready', async (_req, reply) => {
        const checks = {};
        try {
            await pool.query('SELECT 1');
            checks.postgres = 'ok';
        }
        catch {
            checks.postgres = 'fail';
        }
        checks.redis = isRedisHealthy() ? 'ok' : 'fail';
        const allOk = Object.values(checks).every((v) => v === 'ok');
        return reply.code(allOk ? 200 : 503).send({ status: allOk ? 'ready' : 'not_ready', checks });
    });
    fastify.get('/metrics', async (_req, reply) => {
        const { registry } = await import('../metrics.js');
        reply.header('Content-Type', registry.contentType);
        return reply.send(await registry.metrics());
    });
};
