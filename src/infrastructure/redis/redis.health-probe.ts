import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import { errorMessage } from '@shared/error-message';
import type { DependencyHealth, HealthProbePort } from '@application/ports/health-probe.port';
import { REDIS_CLIENT } from './redis.client.factory';

/** Non-critical probe: Redis being down is reported but the service stays healthy. */
@Injectable()
export class RedisHealthProbe implements HealthProbePort {
  readonly name = 'redis';
  readonly critical = false;

  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  async ping(): Promise<DependencyHealth> {
    try {
      const pong = await this.client.ping();
      return {
        name: this.name,
        status: pong === 'PONG' ? 'up' : 'down',
        critical: this.critical,
      };
    } catch (error) {
      return {
        name: this.name,
        status: 'down',
        critical: this.critical,
        detail: errorMessage(error),
      };
    }
  }
}
