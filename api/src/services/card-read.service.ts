// api/src/services/card-read.service.ts
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { pool } from '../db/client.js';
import { withTenantContext } from '../db/tenant-context.js';
import { safeGet, safeSet } from '../cache/redis.js';
import { emitEvent } from './event-emitter.js';
import type { CardRead, PaginatedResponse } from '../types/index.js';

const s3 = new S3Client({
  region: process.env.AWS_REGION ?? 'eu-west-1',
  endpoint: process.env.AWS_ENDPOINT_URL,
  forcePathStyle: !!process.env.AWS_ENDPOINT_URL,
});
const BUCKET = process.env.S3_RAW_DUMP_BUCKET!;
const IDEM_TTL = 86_400;

export interface ProcessInput {
  tenantId: string; deviceId: string; rawDump: Buffer;
  cardSerial: string; cardType: string; idempotencyKey: string;
  parsedData?: Record<string, unknown>;
}

export const cardReadService = {
  async process(input: ProcessInput): Promise<CardRead> {
    const cacheKey = `idem:${input.idempotencyKey}`;
    const cached = await safeGet(cacheKey);
    if (cached) return JSON.parse(cached);

    let s3Key: string | null = null;
    if (input.rawDump.length > 0) {
      s3Key = `${input.tenantId}/card-reads/${input.idempotencyKey}.bin`;
      await s3.send(new PutObjectCommand({
        Bucket: BUCKET, Key: s3Key, Body: input.rawDump,
        ContentType: 'application/octet-stream',
        Metadata: { tenantId: input.tenantId, cardType: input.cardType },
      }));
    }

    const record = await withTenantContext(pool, input.tenantId, async (client) => {
      // Global idempotency check (card_read_idempotency has no RLS — unpartitioned)
      const { rows: idemRows } = await client.query(
        `SELECT card_read_id FROM card_read_idempotency WHERE idempotency_key=$1`,
        [input.idempotencyKey],
      );
      if (idemRows.length) {
        const { rows: ex } = await client.query<CardRead>(
          'SELECT * FROM card_reads WHERE id=$1', [idemRows[0].card_read_id],
        );
        return ex[0];
      }

      const { rows } = await client.query<CardRead>(
        `INSERT INTO card_reads
           (tenant_id,device_id,card_serial,card_type,idempotency_key,raw_dump_s3_key,parsed_data)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
         RETURNING *`,
        [input.tenantId, input.deviceId, input.cardSerial, input.cardType,
         input.idempotencyKey, s3Key, JSON.stringify(input.parsedData ?? {})],
      );
      const cardRead = rows[0];

      await client.query(
        `INSERT INTO card_read_idempotency (idempotency_key, card_read_id)
         VALUES ($1,$2) ON CONFLICT (idempotency_key) DO NOTHING`,
        [input.idempotencyKey, cardRead.id],
      );

      return cardRead;
    });

    await safeSet(cacheKey, JSON.stringify(record), IDEM_TTL);

    emitEvent('card.read.completed', { tenantId: input.tenantId, cardReadId: record.id })
      .catch((e) => console.error({ e }, 'emit card.read.completed failed'));
    emitEvent('billing.event', { tenantId: input.tenantId, cardReadId: record.id })
      .catch((e) => console.error({ e }, 'emit billing.event failed'));

    return record;
  },

  async list(params: {
    tenantId: string; cursor?: string; limit: number; vehicleId?: string;
  }): Promise<PaginatedResponse<CardRead>> {
    const { tenantId, cursor, limit, vehicleId } = params;
    let decoded: { id: string; createdAt: string } | null = null;
    if (cursor) {
      try { decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString()); }
      catch { throw Object.assign(new Error('Invalid cursor'), { statusCode: 400 }); }
    }

    const rows = await withTenantContext(pool, tenantId, async (c) => {
      const conds = ['1=1']; const vals: unknown[] = []; let p = 1;
      if (vehicleId) { conds.push(`vehicle_id=$${p++}`); vals.push(vehicleId); }
      if (decoded) {
        conds.push(`(created_at,id)<($${p++},$${p++})`);
        vals.push(decoded.createdAt, decoded.id);
      }
      vals.push(limit + 1);
      const { rows } = await c.query<CardRead>(
        `SELECT id,tenant_id,device_id,vehicle_id,card_serial,card_type,read_status,created_at
         FROM card_reads WHERE ${conds.join(' AND ')}
         ORDER BY created_at DESC, id DESC LIMIT $${p}`, vals,
      );
      return rows;
    });

    const hasNextPage = rows.length > limit;
    const items = hasNextPage ? rows.slice(0, limit) : rows;
    const nextCursor = hasNextPage
      ? Buffer.from(JSON.stringify({ id: items.at(-1)!.id, createdAt: items.at(-1)!.created_at })).toString('base64url')
      : null;
    return { items, nextCursor, hasNextPage };
  },
};
