import type { ObservabilityConfig } from '@config/app-config';
import { telemetryStatusLine } from './telemetry-status';

function observabilityWith(overrides: Partial<ObservabilityConfig> = {}): ObservabilityConfig {
  return {
    logLevel: 'info',
    logPretty: false,
    metricsEnabled: true,
    otlpHeaders: {},
    serviceName: 'advanced-search-api',
    tracesSamplerRatio: 1,
    metricsExportEnabled: false,
    metricExportIntervalMs: 60000,
    ...overrides,
  };
}

describe('telemetryStatusLine (design D38)', () => {
  it('reports all three pipelines as off when nothing is configured', () => {
    // Arrange & Act
    const line = telemetryStatusLine(observabilityWith(), false);

    // Assert
    expect(line).toContain('traces: off');
    expect(line).toContain('metrics: local only');
    expect(line).toContain('logs: stdout only');
  });

  it('reports each pipeline independently, so one being on never implies another', () => {
    // Arrange & Act: metrics exporting while logs stay local is a real state.
    const line = telemetryStatusLine(observabilityWith({ metricsExportEnabled: true }), true);

    // Assert
    expect(line).toContain('traces: exporting over OTLP');
    expect(line).toContain('metrics: exporting over OTLP every 60000ms');
    expect(line).toContain('logs: stdout only');
  });

  it('names Loki once log shipping is configured', () => {
    // Arrange & Act
    const line = telemetryStatusLine(
      observabilityWith({ lokiUrl: 'https://logs.example.com' }),
      false,
    );

    // Assert
    expect(line).toContain('logs: stdout + Loki');
  });

  it('never echoes a credential', () => {
    // Arrange & Act
    const line = telemetryStatusLine(
      observabilityWith({
        lokiUrl: 'https://logs.example.com',
        lokiUsername: '12345',
        lokiPassword: 'glc_supersecret',
      }),
      true,
    );

    // Assert
    expect(line).not.toContain('glc_supersecret');
    expect(line).not.toContain('12345');
  });
});
