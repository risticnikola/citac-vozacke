// api/src/plugins/tenant.ts
import fp from 'fastify-plugin';
export const tenantPlugin = fp(async (fastify) => {
    fastify.decorate('requireTenantContext', async (req, reply) => {
        const tenantId = req.jwtPayload?.tenantId;
        if (!tenantId)
            return reply.code(401).send({ error: 'Missing tenant context' });
        req.tenantId = tenantId;
    });
});
