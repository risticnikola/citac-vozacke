// api/src/services/event-emitter.ts
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

const sqs = new SQSClient({
  region: process.env.AWS_REGION ?? 'eu-west-1',
  endpoint: process.env.AWS_ENDPOINT_URL,
});

const QUEUES: Record<string, string | undefined> = {
  'card.read.completed': process.env.SQS_CARD_READ_QUEUE_URL,
  'billing.event':       process.env.SQS_BILLING_QUEUE_URL,
  'report.requested':    process.env.SQS_REPORT_QUEUE_URL,
};

export async function emitEvent(eventType: string, payload: object): Promise<void> {
  const url = QUEUES[eventType];
  if (!url) throw new Error(`Unknown event type: ${eventType}`);
  await sqs.send(new SendMessageCommand({
    QueueUrl: url,
    MessageBody: JSON.stringify({ eventType, payload, ts: new Date().toISOString() }),
    MessageAttributes: { eventType: { DataType: 'String', StringValue: eventType } },
  }));
}
