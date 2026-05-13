// api/src/routes/v1/vehicles.ts
import { FastifyPluginAsync } from 'fastify';
import { Type, Static } from '@sinclair/typebox';
import { pool } from '../../db/client.js';
import { withTenantContext } from '../../db/tenant-context.js';

const VehicleBody = Type.Object({
  vin:        Type.Optional(Type.String({ maxLength: 17 })),
  plate:      Type.Optional(Type.String({ maxLength: 20 })),
  make:       Type.Optional(Type.String({ maxLength: 64 })),
  model:      Type.Optional(Type.String({ maxLength: 64 })),
  year:       Type.Optional(Type.Integer({ minimum: 1900, maximum: 2100 })),
  ownerName:  Type.Optional(Type.String({ maxLength: 128 })),
  ownerPhone: Type.Optional(Type.String({ maxLength: 32 })),
});
type VehicleBodyType = Static<typeof VehicleBody>;

const VehicleQuerySchema = Type.Object({
  cursor: Type.Optional(Type.String()),
  limit:  Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
  plate:  Type.Optional(Type.String()),
  vin:    Type.Optional(Type.String()),
});
type VehicleQuery = Static<typeof VehicleQuerySchema>;

export const vehiclesRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Querystring: VehicleQuery }>('/', {
    schema: {
      querystring: VehicleQuerySchema,
    },
    preHandler: [fastify.authenticate, fastify.requireTenantContext],
  }, async (req, reply) => {
    const { cursor, limit = 20, plate, vin } = req.query;
    let decoded: { id: string; createdAt: string } | null = null;
    if (cursor) {
      try { decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString()); }
      catch { return reply.code(400).send({ error: 'Invalid cursor' }); }
    }

    const rows = await withTenantContext(pool, req.tenantId, async (c) => {
      const conds = ['deleted_at IS NULL']; const vals: unknown[] = []; let p = 1;
      if (plate) { conds.push(`plate ILIKE $${p++}`); vals.push(`%${plate}%`); }
      if (vin)   { conds.push(`vin = $${p++}`); vals.push(vin); }
      if (decoded) {
        conds.push(`(created_at, id) < ($${p++}, $${p++})`);
        vals.push(decoded.createdAt, decoded.id);
      }
      vals.push(limit + 1);
      const { rows } = await c.query(
        `SELECT id,tenant_id,vin,plate,make,model,year,owner_name,owner_phone,created_at
         FROM vehicles WHERE ${conds.join(' AND ')}
         ORDER BY created_at DESC, id DESC LIMIT $${p}`, vals,
      );
      return rows;
    });

    const hasNextPage = rows.length > limit;
    const items = hasNextPage ? rows.slice(0, limit) : rows;
    const nextCursor = hasNextPage
      ? Buffer.from(JSON.stringify({ id: items.at(-1)!.id, createdAt: items.at(-1)!.created_at })).toString('base64url')
      : null;
    return reply.send({ items, nextCursor, hasNextPage });
  });

  fastify.get('/:id', {
    preHandler: [fastify.authenticate, fastify.requireTenantContext],
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const rows = await withTenantContext(pool, req.tenantId, async (c) => {
      const { rows } = await c.query(
        `SELECT * FROM vehicles WHERE id=$1 AND deleted_at IS NULL`, [id],
      );
      return rows;
    });
    if (!rows.length) return reply.code(404).send({ error: 'Not found' });
    return reply.send(rows[0]);
  });

  fastify.post<{ Body: VehicleBodyType }>('/', {
    schema: { body: VehicleBody },
    preHandler: [fastify.authenticate, fastify.requireTenantContext],
  }, async (req, reply) => {
    const b = req.body;
    const rows = await withTenantContext(pool, req.tenantId, async (c) => {
      const { rows } = await c.query(
        `INSERT INTO vehicles (tenant_id,vin,plate,make,model,year,owner_name,owner_phone)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [req.tenantId, b.vin, b.plate, b.make, b.model, b.year, b.ownerName, b.ownerPhone],
      );
      return rows;
    });
    return reply.code(201).send(rows[0]);
  });

  fastify.patch<{ Body: VehicleBodyType }>('/:id', {
    schema: { body: VehicleBody },
    preHandler: [fastify.authenticate, fastify.requireTenantContext],
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = req.body;
    const rows = await withTenantContext(pool, req.tenantId, async (c) => {
      const { rows } = await c.query(
        `UPDATE vehicles SET vin=$2,plate=$3,make=$4,model=$5,year=$6,
           owner_name=$7,owner_phone=$8,updated_at=NOW()
         WHERE id=$1 AND deleted_at IS NULL RETURNING *`,
        [id, b.vin, b.plate, b.make, b.model, b.year, b.ownerName, b.ownerPhone],
      );
      return rows;
    });
    if (!rows.length) return reply.code(404).send({ error: 'Not found' });
    return reply.send(rows[0]);
  });
};
