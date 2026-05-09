// bridge/tests/queue.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { initQueue, enqueue, dequeueReady, markSuccess, markFailed, queueDepth } from '../src/bridge/queue.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'bridge-queue-'));
  initQueue(path.join(tmpDir, 'test.db'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('offline queue', () => {
  const sampleItem = {
    deviceId: 'dev-01',
    cardSerial: 'AABBCCDD',
    cardType: 'vehicle' as const,
    rawDump: Buffer.from('deadbeef', 'hex'),
    idempotencyKey: 'idem-01',
  };

  it('enqueues an item and dequeues it', () => {
    enqueue(sampleItem);
    const items = dequeueReady(10);
    expect(items).toHaveLength(1);
    expect(items[0].cardSerial).toBe('AABBCCDD');
    expect(items[0].retryCount).toBe(0);
  });

  it('markSuccess removes the item', () => {
    enqueue(sampleItem);
    const [item] = dequeueReady();
    markSuccess(item.id);
    expect(dequeueReady()).toHaveLength(0);
  });

  it('markFailed increments retry_count and sets next_retry_at in future', () => {
    enqueue(sampleItem);
    const [item] = dequeueReady();
    markFailed(item.id);
    // Should not be ready immediately (backoff)
    expect(dequeueReady()).toHaveLength(0);
  });

  it('prevents duplicate idempotency keys', () => {
    enqueue(sampleItem);
    enqueue(sampleItem); // same idempotencyKey
    expect(queueDepth()).toBe(1);
  });

  it('queueDepth returns correct count', () => {
    expect(queueDepth()).toBe(0);
    enqueue(sampleItem);
    enqueue({ ...sampleItem, idempotencyKey: 'idem-02' });
    expect(queueDepth()).toBe(2);
  });
});
