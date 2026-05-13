// worker/src/index.ts
import './telemetry.js';
import pino from 'pino';
import { runConsumer } from './queue/sqs.js';
import { handleVehicleEnrich } from './consumers/vehicle-enrich.consumer.js';
import { handleReportGenerate } from './consumers/report-generate.consumer.js';
import { handleBillingEvent } from './consumers/billing-event.consumer.js';
import { handleDlqMessage } from './consumers/dlq.consumer.js';

const log = pino({ name: 'worker-main' });

const QUEUES = {
  cardRead:       process.env.SQS_CARD_READ_QUEUE_URL!,
  report:         process.env.SQS_REPORT_QUEUE_URL!,
  billing:        process.env.SQS_BILLING_QUEUE_URL!,
  dlq:            process.env.SQS_DLQ_URL!,
};

for (const [name, url] of Object.entries(QUEUES)) {
  if (!url) { log.error({ name }, 'missing queue URL env var'); process.exit(1); }
}

log.info('starting worker consumers');

Promise.all([
  runConsumer({ queueUrl: QUEUES.cardRead,  handler: handleVehicleEnrich  }),
  runConsumer({ queueUrl: QUEUES.report,    handler: handleReportGenerate  }),
  runConsumer({ queueUrl: QUEUES.billing,   handler: handleBillingEvent    }),
  runConsumer({ queueUrl: QUEUES.dlq,       handler: handleDlqMessage,
                maxMessages: 1, visibilityTimeout: 60 }),
]).catch((err) => {
  log.error({ err }, 'fatal consumer error');
  process.exit(1);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { log.info({ sig }, 'shutting down'); process.exit(0); });
}
