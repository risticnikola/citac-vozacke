// api/src/routes/v1/auth.ts
import { FastifyPluginAsync } from 'fastify';
import { Type, Static } from '@sinclair/typebox';
import { pool } from '../../db/client.js';
import bcrypt from 'bcryptjs';

const LoginBody = Type.Object({
  email:    Type.String({ format: 'email' }),
  password: Type.String({ minLength: 1 }),
});
type LoginBodyType = Static<typeof LoginBody>;

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Body: LoginBodyType }>('/login', {
    schema: { body: LoginBody },
  }, async (req, reply) => {
    const { email, password } = req.body;

    const { rows } = await pool.query(
      `SELECT id, tenant_id, role, password_hash, auth_provider, deleted_at
       FROM users WHERE email = $1 LIMIT 1`,
      [email],
    );
    const user = rows[0];
    if (!user || user.deleted_at || user.auth_provider !== 'local' || !user.password_hash)
      return reply.code(401).send({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return reply.code(401).send({ error: 'Invalid credentials' });

    const token = fastify.jwt.sign(
      { sub: user.id, tenantId: user.tenant_id, role: user.role, type: 'user' },
      { expiresIn: '8h' },
    );
    return reply.send({ token, expiresIn: 28800 });
  });
};
