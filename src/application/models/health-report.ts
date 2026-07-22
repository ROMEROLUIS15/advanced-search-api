import type { DependencyHealth } from '../ports/health-probe.port';

/** Aggregate health across probes; `error` when any critical dependency is down. */
export interface HealthReport {
  status: 'ok' | 'error';
  dependencies: DependencyHealth[];
}
