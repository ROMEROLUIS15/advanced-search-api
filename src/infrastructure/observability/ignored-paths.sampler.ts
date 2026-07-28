import { type Attributes, type Context, type Link, SpanKind } from '@opentelemetry/api';
import { type Sampler, SamplingDecision, type SamplingResult } from '@opentelemetry/sdk-trace-base';
import { OPERATOR_PATHS, matchesPath } from '@shared/operator-paths';

/** Where the different HTTP semantic conventions put the request path. */
const PATH_ATTRIBUTES = ['url.path', 'http.route', 'http.target'];

/**
 * Drops whole traces for the platform's probes (design D25).
 *
 * This has to be a **sampler**, not `ignoreIncomingRequestHook`. That hook only
 * suppresses the server span; the Elasticsearch and Redis calls the health probe
 * makes would still be instrumented and, with no parent left, would be sampled
 * as roots in their own right — turning one useless trace into two orphan spans.
 *
 * A sampling decision of `NOT_RECORD` on the root propagates: children consult
 * the parent through {@link ParentBasedSampler} and are dropped with it.
 *
 * Why it matters here: around a deploy Render probes `/health` every few seconds
 * and the container runs its own 30 s `HEALTHCHECK`, so at full sampling the
 * trace list filled with identical 68 ms traces and buried the handful of real
 * searches — observed in Grafana within minutes of enabling the exporter. The
 * keep-alive then keeps calling it six times an hour for as long as the service
 * runs. (An earlier version of this comment said "thousands a day"; measured
 * against Upstash on 2026-07-28 the real figure is ~115 — see
 * `docs/OBSERVABILITY-2026-07-27.md`. The volume was never the point: a trace
 * saying "still fine" carries no information at any rate.)
 */
export class IgnoredPathsSampler implements Sampler {
  constructor(private readonly delegate: Sampler) {}

  shouldSample(
    context: Context,
    traceId: string,
    spanName: string,
    spanKind: SpanKind,
    attributes: Attributes,
    links: Link[],
  ): SamplingResult {
    if (spanKind === SpanKind.SERVER && isIgnored(attributes)) {
      return { decision: SamplingDecision.NOT_RECORD };
    }
    return this.delegate.shouldSample(context, traceId, spanName, spanKind, attributes, links);
  }

  toString(): string {
    return `IgnoredPathsSampler(${this.delegate.toString()})`;
  }
}

function isIgnored(attributes: Attributes): boolean {
  for (const key of PATH_ATTRIBUTES) {
    const value = attributes[key];
    if (typeof value === 'string' && matchesPath(value, OPERATOR_PATHS)) {
      return true;
    }
  }
  return false;
}
