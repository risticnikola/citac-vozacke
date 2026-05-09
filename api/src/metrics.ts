// api/src/metrics.ts
import { Registry, Counter, Histogram } from 'prom-client';

export const registry = new Registry();
registry.setDefaultLabels({ service: 'vehicle-card-api' });

export const cardReadLatency = new Histogram({
  name: 'card_read_latency_ms',
  help: 'Card read processing duration (ms)',
  labelNames: ['tenant_id', 'status'],
  buckets: [10, 50, 100, 250, 500, 1000, 2500, 5000],
  registers: [registry],
});

export const cardReadTotal = new Counter({
  name: 'card_reads_total',
  help: 'Total card reads processed',
  labelNames: ['tenant_id', 'status'],
  registers: [registry],
});

export const failedReadsTotal = new Counter({
  name: 'failed_reads_total',
  help: 'Failed reads by error type',
  labelNames: ['tenant_id', 'error_type'],
  registers: [registry],
});

export const billingEventsTotal = new Counter({
  name: 'billing_events_emitted_total',
  help: 'Billing events emitted',
  labelNames: ['tenant_id', 'event_type'],
  registers: [registry],
});

export const dbQueryDuration = new Histogram({
  name: 'db_query_duration_ms',
  help: 'DB query duration (ms)',
  labelNames: ['query_name'],
  buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000],
  registers: [registry],
});
