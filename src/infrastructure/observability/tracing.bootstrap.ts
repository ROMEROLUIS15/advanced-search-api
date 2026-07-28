import type { Span } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { NodeSDK, type NodeSDKConfiguration } from '@opentelemetry/sdk-node';
import { ParentBasedSampler, TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-base';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { type ObservabilityConfig } from '@config/app-config';
import { loadConfig } from '@config/load-config';
import { IgnoredPathsSampler } from './ignored-paths.sampler';

let sdk: NodeSDK | undefined;

/**
 * The SDK options, built apart from the SDK itself so a spec can assert them
 * without constructing anything.
 *
 * @returns the configuration, or `undefined` when no OTLP endpoint is set —
 *   the single place that decides tracing stays off.
 */
export function buildTracingConfig(
  observability: ObservabilityConfig,
): Partial<NodeSDKConfiguration> | undefined {
  const { otlpEndpoint, otlpHeaders, serviceName, tracesSamplerRatio } = observability;
  if (otlpEndpoint === undefined) {
    return undefined;
  }

  return {
    serviceName,
    traceExporter: new OTLPTraceExporter({
      url: `${otlpEndpoint.replace(/\/$/, '')}/v1/traces`,
      headers: otlpHeaders,
    }),
    // Parent-based so a sampled inbound trace stays sampled end to end; the
    // ratio only decides what happens when this service starts the trace. The
    // probe filter wraps the root decision, so a `/health` trace is dropped
    // whole — server span and the Elasticsearch/Redis calls under it alike.
    sampler: new ParentBasedSampler({
      root: new IgnoredPathsSampler(new TraceIdRatioBasedSampler(tracesSamplerRatio)),
    }),
    instrumentations: [
      new HttpInstrumentation({ requestHook: redactIncomingQuery }),
      new IORedisInstrumentation({ dbStatementSerializer: commandNameOnly }),
    ],
    // Traces only, and it has to be said out loud. Left unset, `NodeSDK` falls
    // back to reading the environment, where the default metrics exporter is
    // OTLP — so setting `OTEL_EXPORTER_OTLP_ENDPOINT` for tracing quietly
    // starts a second, undeclared pipeline. It shipped that way and ran
    // unnoticed in production until 2026-07-27, when Grafana Cloud turned out
    // to hold `http_server_request_duration_seconds` for this service: the HTTP
    // instrumentation's own histograms, counting the very probes the sampler
    // drops from traces, and without an `http_route` label to make them useful.
    // An empty array is not the same as unset — the SDK skips the whole
    // `MeterProvider` when a reader list is present and empty. Metrics leave
    // this service through `METRICS_PORT` and `/metrics`, nowhere else.
    metricReaders: [],
  };
}

/**
 * Starts OpenTelemetry before anything else loads (design D25).
 *
 * **Ordering is the whole point.** Instrumentation patches modules as they are
 * required, so this has to run before `@nestjs/core`, Express, ioredis or the
 * Elasticsearch client are imported. `tracing.preload.ts` calls this at module
 * evaluation time; calling it later from `bootstrap()` is already too late.
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
  const config = buildTracingConfig(loadConfig().observability);
  if (config === undefined) {
    return false;
  }

  sdk = new NodeSDK(config);
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

/**
 * Query values are client-controlled search data. Keep the fact that a query
 * existed without exporting its contents to the trace backend.
 */
/**
 * The Redis command name, without its arguments (`db.query.text`).
 *
 * The default serializer writes the whole command, arguments included. Observed
 * in production the moment Redis started being traced at all: a rate-limit span
 * carried `evalsha <sha> 1 ratelimit:v1:default:<digest> 60000`. The rate
 * limiter's own key is only a digest, but the *cache* path runs
 * `SET search:v1:<scope>:<hash> <the entire serialized response>` — so every
 * cache miss would have shipped a full result set to the trace backend. That is
 * product data in Tempo, and a span two orders of magnitude past the ~2.7 kB
 * the free-tier budget was computed from.
 *
 * The operation is the part worth tracing; a span already carries its duration,
 * its parent and the server it talked to, and none of that needs the payload.
 *
 * Declared with one parameter on purpose. The serializer is called with
 * `(name, args)` and JavaScript discards the extra argument, so the arguments
 * are not merely unused here — they are unreachable, which is a stronger
 * guarantee than a variable someone could later decide to interpolate.
 */
export function commandNameOnly(commandName: string): string {
  return commandName;
}

export function redactIncomingQuery(span: Span, request: ClientRequest | IncomingMessage): void {
  if ('url' in request && typeof request.url === 'string' && request.url.includes('?')) {
    span.setAttribute('url.query', '[REDACTED]');
  }
}
