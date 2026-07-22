import { Module } from '@nestjs/common';
import { ElasticsearchModule } from '@infrastructure/elasticsearch/elasticsearch.module';
import { RedisModule } from '@infrastructure/redis/redis.module';
import { ElasticsearchHealthProbe } from '@infrastructure/elasticsearch/health/elasticsearch.health-probe';
import { RedisHealthProbe } from '@infrastructure/redis/redis.health-probe';
import { HEALTH_PROBE, type HealthProbePort } from '@application/ports/health-probe.port';
import { CheckHealthUseCase } from '@application/use-cases/check-health.use-case';
import { HealthController } from '@presentation/health/health.controller';

/** Health/readiness module: dependency probes aggregated behind `GET /health`. */
@Module({
  imports: [ElasticsearchModule, RedisModule],
  providers: [
    ElasticsearchHealthProbe,
    RedisHealthProbe,
    {
      provide: HEALTH_PROBE,
      useFactory: (
        elasticsearch: ElasticsearchHealthProbe,
        redis: RedisHealthProbe,
      ): HealthProbePort[] => [elasticsearch, redis],
      inject: [ElasticsearchHealthProbe, RedisHealthProbe],
    },
    CheckHealthUseCase,
  ],
  controllers: [HealthController],
})
export class HealthModule {}
