// worker/src/consumers/billing-event.consumer.ts
import type { Message } from '@aws-sdk/client-sqs';
import { pool } from '../db/client.js';
import { withTenantContext } from '../db/tenant-context.js';
import pino from 'pino';

const log = pino({ name: 'billing-event' });

interface BillingEventPayload {
  tenantId: string;
  cardReadId: string;
}

export async function handleBillingEvent(msg: Message): Promise<void> {
  const body = JSON.parse(msg.Body ?? '{}') as { payload: BillingEventPayload };
  const { tenantId, cardReadId } = body.payload;

  log.info({ tenantId, cardReadId }, 'processing billing event');

  await withTenantContext(pool, tenantId, async (client) => {
    // Idempotent upsert — V5 migration added UNIQUE(card_read_id)
    await client.query(
      `INSERT INTO billing_events (tenant_id, card_read_id, event_type, amount_units)
       VALUES ($1, $2, 'card_read', 1)
       ON CONFLICT (card_read_id) DO NOTHING`,
      [tenantId, cardReadId],
    );
    log.info({ cardReadId }, 'billing event recorded');
  });
}
