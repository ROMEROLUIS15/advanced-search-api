import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfiguration } from '@config/app-config';
import { METRICS_EXPORTER, METRICS_PORT } from '@application/ports/metrics.port';
import { CompositeMetricsAdapter } from './composite-metrics.adapter';
import { NoopMetricsAdapter } from './noop-metrics.adapter';
import { OtlpMetricsAdapter } from './otlp-metrics.adapter';
import { PrometheusMetricsAdapter } from './prometheus-metrics.adapter';

/**
 * Binds the metrics ports to one instance, chosen by configuration (design D24).
 *
 * `@Global` because counting is cross-cutting: the search and autocomplete
 * modules count cache outcomes, the rate-limit store counts fail-overs, and the
 * metrics endpoint renders — making every one of them import this module would
 * be noise around a single shared registry. It is the third global module in the
 * app, alongside config and nothing else, and it is deliberate rather than
 * convenient.
 */
@Global()
@Module({
  providers: [
    {
      provide: METRICS_PORT,
      useFactory: (config: AppConfiguration): MetricsAdapter => buildMetricsAdapter(config),
      inject: [APP_CONFIG],
    },
    // One instance serves both ports: what is recorded is what is rendered.
    { provide: METRICS_EXPORTER, useExisting: METRICS_PORT },
  ],
  exports: [METRICS_PORT, METRICS_EXPORTER],
})
export class ObservabilityModule {}

type MetricsAdapter = PrometheusMetricsAdapter | CompositeMetricsAdapter | NoopMetricsAdapter;

/**
 * Three states, in order of how much they do: measuring nothing, measuring
 * locally, and measuring locally *and* shipping. Export is opt-in on its own
 * flag rather than following the OTLP endpoint, so configuring tracing cannot
 * start a metrics pipeline by accident — which is what happened once already
 * (design D35/D38).
 */
export function buildMetricsAdapter(config: AppConfiguration): MetricsAdapter {
  const { metricsEnabled, metricsExportEnabled, otlpEndpoint } = config.observability;
  if (!metricsEnabled) {
    return new NoopMetricsAdapter();
  }

  const local = new PrometheusMetricsAdapter();
  if (!metricsExportEnabled || otlpEndpoint === undefined) {
    return local;
  }
  return new CompositeMetricsAdapter(
    local,
    new OtlpMetricsAdapter(config.observability, otlpEndpoint),
  );
}
