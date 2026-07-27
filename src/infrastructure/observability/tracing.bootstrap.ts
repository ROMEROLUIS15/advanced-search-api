import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ParentBasedSampler, TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-base';
import { loadConfig } from '@config/load-config';

let sdk: NodeSDK | undefined;

/**
 * Starts OpenTelemetry before anything else loads (design D25).
 *
 * **Ordering is the whole point.** Instrumentation patches modules as they are
 * required, so this has to run before `@nestjs/core`, Express, ioredis or the
 * Elasticsearch client are imported — which is why `main.ts` imports it first
 * and why adding an import above it silently disables tracing.
 *
 * Elasticsearch needs no instrumentation here: `@elastic/transport` depends on
 * `@opentelemetry/api` directly and emits its own spans once a provider exists.
 *
 * With no OTLP endpoint configured this returns without constructing anything —
 * no SDK, no exporter, no overhead — which is what lets local runs, CI and the
 * e2e suites work with no collector in sight.
 *
 * @returns whether tracing was started, for the caller to log or assert.
 */
export function startTracing(): boolean {
  const { observability } = loadConfig();
  const { otlpEndpoint, otlpHeaders, serviceName, tracesSamplerRatio } = observability;
  if (otlpEndpoint === undefined) {
    return false;
  }

  sdk = new NodeSDK({
    serviceName,
    traceExporter: new OTLPTraceExporter({
      url: `${otlpEndpoint.replace(/\/$/, '')}/v1/traces`,
      headers: otlpHeaders,
    }),
    // Parent-based so a sampled inbound trace stays sampled end to end; the
    // ratio only decides what happens when this service starts the trace.
    sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(tracesSamplerRatio) }),
    instrumentations: [new HttpInstrumentation(), new IORedisInstrumentation()],
  });
  sdk.start();

  // Flush on the way out; without this the last spans of a deploy are lost.
  process.once('SIGTERM', () => {
    void stopTracing();
  });
  return true;
}

/** Flushes and shuts the SDK down. Safe to call when tracing never started. */
export async function stopTracing(): Promise<void> {
  const running = sdk;
  sdk = undefined;
  if (running !== undefined) {
    await running.shutdown();
  }
}
