// worker/src/telemetry.ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { ParentBasedSampler, TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-base';

if (process.env.NODE_ENV !== 'test') {
  const samplingRatio = process.env.NODE_ENV === 'production' ? 0.1 : 1.0;
  const sdk = new NodeSDK({
    resource: new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: 'worker',
      [SemanticResourceAttributes.SERVICE_VERSION]: process.env.npm_package_version ?? '0.0.0',
    }),
    traceExporter: new OTLPTraceExporter({
      url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4317',
    }),
    instrumentations: [new PgInstrumentation()],
    sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(samplingRatio) }),
  });
  sdk.start();
  process.on('SIGTERM', () => sdk.shutdown());
}
