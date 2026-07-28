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

  /** The full report over every probe: what a human and the uptime monitor read. */
  async execute(): Promise<HealthReport> {
    return this.report(this.probes);
  }

  /**
   * Readiness: the critical probes only (design D39).
   *
   * The platform polls this every few seconds and cannot be slowed down, so a
   * probe whose result cannot change the answer is not merely redundant — it is
   * a recurring bill. A non-critical dependency is by definition one whose
   * outage leaves the verdict at `ok`, so calling it here would spend a command
   * to compute a value that is then discarded. Measured before this existed:
   * Render's ~4.3 s polling put Redis on course for ~605k commands a month
   * against a 500k free tier, every one of them ignored.
   *
   * Selected by the `critical` flag rather than by dependency name, so a second
   * critical dependency is covered the day it is registered and a second
   * non-critical one never reaches the polled path.
   */
  async checkReadiness(): Promise<HealthReport> {
    return this.report(this.probes.filter((probe) => probe.critical));
  }

  private async report(probes: HealthProbePort[]): Promise<HealthReport> {
    const settled = await Promise.allSettled(probes.map((probe) => probe.ping()));
    const dependencies = settled.map((result, index) =>
      this.toDependencyHealth(result, probes[index]),
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
