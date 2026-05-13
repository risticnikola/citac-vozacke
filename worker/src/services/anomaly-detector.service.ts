// worker/src/services/anomaly-detector.service.ts
import type { PoolClient } from 'pg';
import pino from 'pino';

const log = pino({ name: 'anomaly-detector' });

export interface AnomalyResult {
  anomalies: string[];
  severity: 'none' | 'low' | 'medium' | 'high';
}

export async function detectAnomalies(
  client: PoolClient,
  tenantId: string,
  vehicleId: string,
  cardReadId: string,
): Promise<AnomalyResult> {
  const anomalies: string[] = [];

  try {
    // Check read frequency: >10 reads for same vehicle in 1 hour is suspicious
    const { rows: freq } = await client.query<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt FROM card_reads
       WHERE tenant_id=$1 AND vehicle_id=$2
         AND created_at > NOW() - INTERVAL '1 hour'`,
      [tenantId, vehicleId],
    );
    const readCount = parseInt(freq[0]?.cnt ?? '0', 10);
    if (readCount > 10) {
      anomalies.push(`High read frequency: ${readCount} reads in last hour`);
    }

    // Check for duplicate card serial on different vehicles in same tenant
    const { rows: dup } = await client.query<{ vehicle_id: string }>(
      `SELECT DISTINCT vehicle_id FROM card_reads
       WHERE tenant_id=$1 AND id=$2 AND vehicle_id IS NOT NULL AND vehicle_id != $3`,
      [tenantId, cardReadId, vehicleId],
    );
    if (dup.length > 0) {
      anomalies.push('Card serial seen on multiple vehicles');
    }
  } catch (err) {
    log.error({ err }, 'anomaly detection query failed');
  }

  const severity: AnomalyResult['severity'] =
    anomalies.length === 0 ? 'none' :
    anomalies.length === 1 ? 'low' :
    anomalies.length === 2 ? 'medium' : 'high';

  return { anomalies, severity };
}
