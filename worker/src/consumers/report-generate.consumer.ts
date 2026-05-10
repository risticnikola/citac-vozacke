// worker/src/consumers/report-generate.consumer.ts
import type { Message } from '@aws-sdk/client-sqs';
import { pool } from '../db/client.js';
import { withTenantContext } from '../db/tenant-context.js';
import { generateAndUploadPdf } from '../services/pdf-generator.service.js';
import pino from 'pino';

const log = pino({ name: 'report-generate' });

interface ReportRequestedPayload {
  tenantId: string;
  reportId: string;
  vehicleId?: string;
  fromDate?: string;
  toDate?: string;
}

export async function handleReportGenerate(msg: Message): Promise<void> {
  const body = JSON.parse(msg.Body ?? '{}') as { payload: ReportRequestedPayload };
  const { tenantId, reportId, vehicleId, fromDate, toDate } = body.payload;

  log.info({ tenantId, reportId }, 'generating report');

  await withTenantContext(pool, tenantId, async (client) => {
    await client.query(
      `UPDATE reports SET status='generating', updated_at=NOW() WHERE id=$1`,  // updated_at added by V7 migration
      [reportId],
    );

    let vehicle: Awaited<ReturnType<typeof import('../services/pdf-generator.service.js').generateAndUploadPdf>> | null = null;
    let vehicleRow: Record<string, unknown> | null = null;

    if (vehicleId) {
      const { rows } = await client.query(
        'SELECT plate,vin,make,model,year,owner_name FROM vehicles WHERE id=$1',
        [vehicleId],
      );
      vehicleRow = rows[0] ?? null;
    }

    const conds = ['1=1']; const vals: unknown[] = []; let p = 1;
    if (vehicleId) { conds.push(`vehicle_id=$${p++}`); vals.push(vehicleId); }
    if (fromDate) { conds.push(`created_at >= $${p++}`); vals.push(fromDate); }
    if (toDate) { conds.push(`created_at <= $${p++}`); vals.push(toDate); }

    const { rows: reads } = await client.query(
      `SELECT id,card_type,card_serial,read_status,created_at
       FROM card_reads WHERE ${conds.join(' AND ')}
       ORDER BY created_at DESC LIMIT 1000`,
      vals,
    );

    const s3Key = await generateAndUploadPdf({
      tenantId,
      reportId,
      title: vehicleRow
        ? `Vehicle Report — ${vehicleRow['plate'] ?? vehicleRow['vin'] ?? 'Unknown'}`
        : 'Fleet Card Read Report',
      vehicle: vehicleRow ? {
        plate: vehicleRow['plate'] as string,
        vin: vehicleRow['vin'] as string,
        make: vehicleRow['make'] as string,
        model: vehicleRow['model'] as string,
        year: vehicleRow['year'] as number,
        ownerName: vehicleRow['owner_name'] as string,
      } : undefined,
      cardReads: reads.map((r) => ({
        id: r.id,
        cardType: r.card_type,
        cardSerial: r.card_serial,
        readStatus: r.read_status,
        createdAt: new Date(r.created_at).toISOString(),
      })),
      generatedAt: new Date().toISOString(),
    });

    await client.query(
      `UPDATE reports SET status='ready', pdf_s3_key=$2, updated_at=NOW() WHERE id=$1`,
      [reportId, s3Key],
    );

    log.info({ reportId, s3Key }, 'report ready');
  });
}
