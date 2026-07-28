import { Inject, Injectable, Logger } from '@nestjs/common';
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
  private readonly logger = new Logger(CheckHealthUseCase.name);
  private readonly downDependencies = new Set<string>();

  constructor(@Inject(HEALTH_PROBE) private readonly probes: HealthProbePort[]) {}

  async execute(): Promise<HealthReport> {
    const settled = await Promise.allSettled(this.probes.map((probe) => probe.ping()));
    const dependencies = settled.map((result, index) =>
      this.toDependencyHealth(result, this.probes[index]),
    );
    this.reportTransitions(dependencies);
    const healthy = dependencies.every((dep) => !dep.critical || dep.status === 'up');
    return { status: healthy ? 'ok' : 'error', dependencies };
  }

  /**
   * Keeps diagnostics in server logs without repeating the same failure on every
   * platform poll. Recovery is logged once as well, closing the incident trail.
   */
  private reportTransitions(dependencies: DependencyHealth[]): void {
    for (const dependency of dependencies) {
      if (dependency.status === 'down') {
        if (!this.downDependencies.has(dependency.name)) {
          const detail = dependency.detail ? `: ${dependency.detail}` : '';
          this.logger.warn(`Dependency ${dependency.name} is down${detail}`);
          this.downDependencies.add(dependency.name);
        }
        continue;
      }

      if (this.downDependencies.delete(dependency.name)) {
        this.logger.log(`Dependency ${dependency.name} recovered`);
      }
    }
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
