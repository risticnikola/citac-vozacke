// worker/src/consumers/dlq.consumer.ts
// DLQ monitor: log + alert on dead-lettered messages; NEVER auto-replay
import type { Message } from '@aws-sdk/client-sqs';
import pino from 'pino';

const log = pino({ name: 'dlq-monitor' });

export async function handleDlqMessage(msg: Message): Promise<void> {
  const body = (() => {
    try { return JSON.parse(msg.Body ?? '{}'); }
    catch { return { raw: msg.Body }; }
  })();

  log.error({
    msgId: msg.MessageId,
    receiveCount: msg.Attributes?.ApproximateReceiveCount,
    body,
  }, 'DLQ message received — manual intervention required');

  // Emit structured alert that monitoring systems can scrape.
  // Never re-enqueue automatically — inspect root cause first.
}
