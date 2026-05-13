// api/src/plugins/tenant.ts
import fp from 'fastify-plugin';
import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';

export const tenantPlugin: FastifyPluginAsync = fp(async (fastify) => {
  fastify.decorate('requireTenantContext', async (req: FastifyRequest, reply: FastifyReply) => {
    const tenantId = req.jwtPayload?.tenantId;
    if (!tenantId) return reply.code(401).send({ error: 'Missing tenant context' });
    req.tenantId = tenantId;
  });
});
