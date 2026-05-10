// bridge/src/cloud/client.ts
import type { QueuedRead } from '../types.js';
import { getToken } from './auth.js';
import { markSuccess, markFailed, dequeueReady, queueDepth } from '../bridge/queue.js';

const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [1_000, 3_000, 10_000];

interface UploadResult {
  id: string;
}

export class CloudClient {
  constructor(
    private readonly apiUrl: string,
    private readonly deviceId: string,
    private readonly tenantId: string,
    private readonly privateKeyPem: string,
  ) {}

  async uploadCardRead(item: QueuedRead): Promise<UploadResult> {
    const token = getToken(this.deviceId, this.tenantId, this.privateKeyPem);
    let lastErr: Error | null = null;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        const resp = await fetch(`${this.apiUrl}/v1/card-reads`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': item.idempotencyKey,
          },
          body: JSON.stringify({
            deviceId: item.deviceId,
            rawDump: item.rawDump.toString('base64'),
            cardSerial: item.cardSerial,
            cardType: item.cardType,
            parsedData: (item as any).parsedData,
          }),
          signal: AbortSignal.timeout(15_000),
        });

        if (resp.status === 201 || resp.status === 200) {
          return (await resp.json()) as UploadResult;
        }
        if (resp.status === 422) {
          // Validation error — do not retry
          throw Object.assign(new Error(`Validation error: ${resp.status}`), { noRetry: true });
        }
        throw new Error(`HTTP ${resp.status}`);
      } catch (err: any) {
        lastErr = err;
        if (err.noRetry || attempt === MAX_ATTEMPTS - 1) break;
        await sleep(RETRY_DELAYS_MS[attempt]);
      }
    }
    throw lastErr ?? new Error('Upload failed');
  }

  async drainQueue(): Promise<{ uploaded: number; failed: number }> {
    const items = dequeueReady();
    let uploaded = 0;
    let failed = 0;

    for (const item of items) {
      try {
        await this.uploadCardRead(item);
        markSuccess(item.id);
        uploaded++;
      } catch {
        markFailed(item.id);
        failed++;
      }
    }
    return { uploaded, failed };
  }

  getQueueDepth(): number {
    return queueDepth();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
