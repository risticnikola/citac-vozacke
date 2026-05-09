// api/src/telemetry.ts — must be imported first in server.ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { Resource } from '@opentelemetry/resources';
import { SEMRESATTRS_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { ParentBasedSampler, TraceIdRatioBased } from '@opentelemetry/sdk-trace-node';

const sdk = new NodeSDK({
  resource: new Resource({ [SEMRESATTRS_SERVICE_NAME]: 'vehicle-card-api' }),
  traceExporter: new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4317',
  }),
  instrumentations: [getNodeAutoInstrumentations()],
  sampler: new ParentBasedSampler({
    root: new TraceIdRatioBased(process.env.NODE_ENV === 'production' ? 0.1 : 1.0),
  }),
});

if (process.env.NODE_ENV !== 'test') sdk.start();
process.on('SIGTERM', () => sdk.shutdown());
