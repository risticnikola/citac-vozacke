import { FastifyPluginAsync } from 'fastify';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import path from 'path';

export const downloadsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/bridge', async (req, reply) => {
    const filePath = process.env.BRIDGE_INSTALLER_PATH;
    if (!filePath) return reply.code(404).send({ error: 'Not configured' });

    try {
      const resolved = path.resolve(filePath);
      const stats = await stat(resolved);
      const filename = path.basename(resolved);

      reply.header('Content-Type', 'application/octet-stream');
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      reply.header('Content-Length', stats.size);

      return reply.send(createReadStream(resolved));
    } catch {
      return reply.code(404).send({ error: 'File not found' });
    }
  });
};
