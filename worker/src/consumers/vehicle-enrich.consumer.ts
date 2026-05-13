// worker/src/consumers/vehicle-enrich.consumer.ts
import type { Message } from '@aws-sdk/client-sqs';
import { pool } from '../db/client.js';
import { withTenantContext } from '../db/tenant-context.js';
import { lookupVin } from '../services/vin-lookup.service.js';
import { detectAnomalies } from '../services/anomaly-detector.service.js';
import pino from 'pino';

const log = pino({ name: 'vehicle-enrich' });

interface CardReadCompletedPayload {
  tenantId: string;
  cardReadId: string;
}

export async function handleVehicleEnrich(msg: Message): Promise<void> {
  const body = JSON.parse(msg.Body ?? '{}') as { payload: CardReadCompletedPayload };
  const { tenantId, cardReadId } = body.payload;

  log.info({ tenantId, cardReadId }, 'processing card.read.completed');

  await withTenantContext(pool, tenantId, async (client) => {
    const { rows } = await client.query<{
      id: string; vehicle_id: string | null; parsed_data: Record<string, unknown>;
    }>(
      'SELECT id, vehicle_id, parsed_data FROM card_reads WHERE id=$1',
      [cardReadId],
    );
    const read = rows[0];
    if (!read) {
      log.warn({ cardReadId }, 'card_read not found; skipping');
      return;
    }

    const vin = (read.parsed_data?.vin as string | undefined) ?? null;

    if (vin && read.vehicle_id) {
      const vinData = await lookupVin(vin);
      if (vinData) {
        await client.query(
          `UPDATE vehicles
           SET make=COALESCE(make,$1), model=COALESCE(model,$2),
               year=COALESCE(year,$3), updated_at=NOW()
           WHERE id=$4`,
          [vinData.make ?? null, vinData.model ?? null, vinData.year ?? null, read.vehicle_id],
        );
        log.info({ vehicleId: read.vehicle_id, vinData }, 'vehicle enriched');
      }

      const anomaly = await detectAnomalies(client, tenantId, read.vehicle_id, cardReadId);
      if (anomaly.severity !== 'none') {
        await client.query(
          `INSERT INTO audit_log (tenant_id, user_id, device_id, action, resource_type, resource_id)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [tenantId, null, null, 'anomaly.detected', 'card_read', cardReadId],
        );
        log.warn({ anomaly, cardReadId }, 'anomaly detected');
      }
    }
  });
}
