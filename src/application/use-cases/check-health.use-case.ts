import { Inject, Injectable } from '@nestjs/common';
import { errorMessage } from '@shared/error-message';
import type { HealthReport } from '../models/health-report';
import {
  HEALTH_PROBE,
  type DependencyHealth,
  type HealthProbePort,
} from '../ports/health-probe.port';

/**
 * Aggregates dependency health. Probes are pinged in parallel; a rejected probe
 * counts as down. Overall status is `error` only when a *critical* dependency is
 * down (e.g. Elasticsearch), so a Redis outage is reported but still healthy.
 */
@Injectable()
export class CheckHealthUseCase {
  constructor(@Inject(HEALTH_PROBE) private readonly probes: HealthProbePort[]) {}

  async execute(): Promise<HealthReport> {
    const settled = await Promise.allSettled(this.probes.map((probe) => probe.ping()));
    const dependencies = settled.map((result, index) =>
      this.toDependencyHealth(result, this.probes[index]),
    );
    const healthy = dependencies.every((dep) => !dep.critical || dep.status === 'up');
    return { status: healthy ? 'ok' : 'error', dependencies };
  }

  private toDependencyHealth(
    result: PromiseSettledResult<DependencyHealth>,
    probe: HealthProbePort,
  ): DependencyHealth {
    if (result.status === 'fulfilled') {
      return result.value;
    }
    return {
      name: probe.name,
      status: 'down',
      critical: probe.critical,
      detail: errorMessage(result.reason),
    };
  }
}
