// worker/src/queue/sqs.ts
import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  ChangeMessageVisibilityCommand,
  type Message,
} from '@aws-sdk/client-sqs';
import pino from 'pino';

const log = pino({ name: 'sqs' });

const sqs = new SQSClient({
  region: process.env.AWS_REGION ?? 'eu-west-1',
  endpoint: process.env.AWS_ENDPOINT_URL,
});

export interface SqsConsumerOptions {
  queueUrl: string;
  maxMessages?: number;
  waitTimeSeconds?: number;
  visibilityTimeout?: number;
  handler: (msg: Message) => Promise<void>;
}

const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 32_000;

export async function runConsumer(opts: SqsConsumerOptions): Promise<never> {
  const { queueUrl, maxMessages = 10, waitTimeSeconds = 20, visibilityTimeout = 30, handler } = opts;
  let consecutiveErrors = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    let messages: Message[] = [];
    try {
      const resp = await sqs.send(new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: maxMessages,
        WaitTimeSeconds: waitTimeSeconds,
        AttributeNames: ['ApproximateReceiveCount'],
      }));
      messages = resp.Messages ?? [];
      consecutiveErrors = 0;
    } catch (err) {
      consecutiveErrors++;
      const backoff = Math.min(BASE_BACKOFF_MS * 2 ** consecutiveErrors, MAX_BACKOFF_MS);
      log.error({ err, consecutiveErrors, backoffMs: backoff }, 'SQS receive error');
      await sleep(backoff);
      continue;
    }

    await Promise.all(messages.map(async (msg) => {
      if (!msg.ReceiptHandle) return;
      try {
        await handler(msg);
        await sqs.send(new DeleteMessageCommand({
          QueueUrl: queueUrl,
          ReceiptHandle: msg.ReceiptHandle,
        }));
      } catch (err) {
        log.error({ err, msgId: msg.MessageId }, 'message handler failed; extending visibility');
        const receiveCount = parseInt(msg.Attributes?.ApproximateReceiveCount ?? '1', 10);
        const extendSecs = Math.min(60 * receiveCount, 600);
        await sqs.send(new ChangeMessageVisibilityCommand({
          QueueUrl: queueUrl,
          ReceiptHandle: msg.ReceiptHandle,
          VisibilityTimeout: extendSecs,
        })).catch((e) => log.error({ e }, 'ChangeMessageVisibility failed'));
      }
    }));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
