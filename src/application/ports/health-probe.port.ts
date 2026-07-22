export type DependencyStatus = 'up' | 'down';

export interface DependencyHealth {
  name: string;
  status: DependencyStatus;
  /** Critical dependencies failing drive an overall 503; non-critical still report 200. */
  critical: boolean;
  detail?: string;
}

/** Multi-provider token: each dependency (Elasticsearch, Redis) registers a probe. */
export const HEALTH_PROBE = Symbol('HEALTH_PROBE');

export interface HealthProbePort {
  readonly name: string;
  readonly critical: boolean;
  ping(): Promise<DependencyHealth>;
}
