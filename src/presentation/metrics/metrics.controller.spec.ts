import { UnauthorizedException } from '@nestjs/common';
import type { Response } from 'express';
import type { AppConfiguration } from '@config/app-config';
import type { MetricsExporterPort } from '@application/ports/metrics.port';
import { MetricsController } from './metrics.controller';

const exporter: MetricsExporterPort = {
  render: () => Promise.resolve('# HELP http_requests_total\nhttp_requests_total 1'),
  contentType: 'text/plain; version=0.0.4; charset=utf-8',
};

function configWith(metricsToken?: string): AppConfiguration {
  return { observability: { metricsToken } } as AppConfiguration;
}

function buildResponse(): { response: Response; headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  const response = {
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
  } as unknown as Response;
  return { response, headers };
}

describe('MetricsController', () => {
  it('renders the registry with the Prometheus content type and no-store', async () => {
    // Arrange
    const controller = new MetricsController(exporter, configWith());
    const { response, headers } = buildResponse();

    // Act
    const body = await controller.metrics(undefined, response);

    // Assert
    expect(body).toContain('http_requests_total 1');
    expect(headers['Content-Type']).toBe('text/plain; version=0.0.4; charset=utf-8');
    expect(headers['Cache-Control']).toBe('no-store');
  });

  it('stays open without a token in environments where validation permits it', async () => {
    // Arrange
    const controller = new MetricsController(exporter, configWith());
    const { response } = buildResponse();

    // Act & Assert
    await expect(controller.metrics(undefined, response)).resolves.toContain('http_requests_total');
  });

  it('demands the bearer token once one is configured', async () => {
    // Arrange
    const controller = new MetricsController(exporter, configWith('s3cret'));
    const { response } = buildResponse();

    // Act & Assert
    await expect(controller.metrics(undefined, response)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(controller.metrics('Bearer wrong', response)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('stays out of the published contract (design D23)', () => {
    // Arrange & Act: what @ApiExcludeEndpoint leaves behind, checked without
    // booting an app — /docs is the client contract, this is an ops endpoint.
    // The key is inlined because @nestjs/swagger does not export its constants
    // through a resolvable entry point.
    const excluded: unknown = Reflect.getMetadata(
      'swagger/apiExcludeEndpoint',
      MetricsController.prototype.metrics,
    );

    // Assert
    expect(excluded).toEqual({ disable: true });
  });

  it('accepts the configured token', async () => {
    // Arrange
    const controller = new MetricsController(exporter, configWith('s3cret'));
    const { response } = buildResponse();

    // Act & Assert
    await expect(controller.metrics('Bearer s3cret', response)).resolves.toContain(
      'http_requests_total',
    );
  });
});
