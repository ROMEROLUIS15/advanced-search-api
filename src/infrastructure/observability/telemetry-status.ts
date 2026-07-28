import type { ObservabilityConfig } from '@config/app-config';

/**
 * One line stating which telemetry pipelines are live (design D38).
 *
 * Whether a signal is actually leaving the process is not something anyone
 * should have to infer from an empty dashboard — and the three pipelines are
 * independent, so "tracing is on" says nothing about the other two. Reported
 * together, in one greppable line, because they are read together.
 *
 * Lives outside `main.ts` so it is covered: `collectCoverageFrom` drops the
 * entry point, and this is the one thing there worth asserting.
 */
export function telemetryStatusLine(
  observability: ObservabilityConfig,
  tracingStarted: boolean,
): string {
  const traces = tracingStarted ? 'exporting over OTLP' : 'off (no OTLP endpoint)';
  const metrics = observability.metricsExportEnabled
    ? `exporting over OTLP every ${observability.metricExportIntervalMs}ms`
    : 'local only (/metrics)';
  const logs = observability.lokiUrl === undefined ? 'stdout only' : 'stdout + Loki';
  return `Telemetry — traces: ${traces}; metrics: ${metrics}; logs: ${logs}`;
}
