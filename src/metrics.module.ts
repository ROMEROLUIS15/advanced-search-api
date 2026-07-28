import { Module } from '@nestjs/common';
import { MetricsController } from '@presentation/metrics/metrics.controller';

/**
 * Metrics feature module (design D24). Only the scrape endpoint lives here:
 * recording happens in an Express middleware registered in `app.setup.ts`,
 * ahead of the router, because a Nest interceptor runs after the global guards
 * and never saw the requests they rejected — the 401s, 429s and unmatched 404s
 * that are precisely the abuse signals worth measuring.
 */
@Module({
  controllers: [MetricsController],
})
export class MetricsModule {}
