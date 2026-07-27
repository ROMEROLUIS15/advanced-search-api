import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { MetricsInterceptor } from '@presentation/common/metrics.interceptor';
import { MetricsController } from '@presentation/metrics/metrics.controller';

/**
 * Metrics feature module (design D24). The interceptor is registered through
 * `APP_INTERCEPTOR` rather than `app.useGlobalInterceptors` because it needs the
 * metrics port injected — the same reason the rate-limit guard goes through
 * `APP_GUARD`.
 */
@Module({
  providers: [{ provide: APP_INTERCEPTOR, useClass: MetricsInterceptor }],
  controllers: [MetricsController],
})
export class MetricsModule {}
