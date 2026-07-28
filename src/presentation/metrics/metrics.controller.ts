import { Controller, Get, Headers, Inject, Res, UnauthorizedException } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import type { Response } from 'express';
import { APP_CONFIG, type AppConfiguration } from '@config/app-config';
import { METRICS_EXPORTER, type MetricsExporterPort } from '@application/ports/metrics.port';

/**
 * Prometheus scrape endpoint (design D23).
 *
 * Excluded from the OpenAPI document on purpose: `/docs` is the contract a
 * client of the search API needs, and an operations endpoint is not part of it.
 * That also keeps the blocking ZAP api-scan pointed at the client surface.
 *
 * Not exempt from the rate limiter either, unlike `/health`: a scraper makes
 * about four requests a minute against a budget of 120, so exempting it would
 * only hand an unauthenticated endpoint an unlimited one.
 */
@Controller('metrics')
export class MetricsController {
  private readonly token?: string;

  constructor(
    @Inject(METRICS_EXPORTER) private readonly exporter: MetricsExporterPort,
    @Inject(APP_CONFIG) config: AppConfiguration,
  ) {
    this.token = config.observability.metricsToken;
  }

  @Get()
  @ApiExcludeEndpoint()
  async metrics(
    @Headers('authorization') authorization: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<string> {
    this.assertAuthorized(authorization);
    response.setHeader('Content-Type', this.exporter.contentType);
    // A cached counter is worse than no counter (design D28).
    response.setHeader('Cache-Control', 'no-store');
    return this.exporter.render();
  }

  /** Tokenless access is permitted only where validated configuration allows a missing token. */
  private assertAuthorized(authorization: string | undefined): void {
    if (this.token === undefined) {
      return;
    }
    if (authorization !== `Bearer ${this.token}`) {
      throw new UnauthorizedException('Metrics access requires a valid bearer token');
    }
  }
}
