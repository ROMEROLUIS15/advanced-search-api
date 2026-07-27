import { type Attributes, type Context, type Link, SpanKind } from '@opentelemetry/api';
import { type Sampler, SamplingDecision, type SamplingResult } from '@opentelemetry/sdk-trace-base';

/**
 * Operator plumbing, not client traffic — the same list `/health` and `/metrics`
 * already sit on elsewhere (exempt from the rate limiter, absent from the
 * OpenAPI document).
 */
const IGNORED_PREFIXES = ['/health', '/metrics'];

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
 * Why it matters here: Render polls `/health` continuously and the container has
 * its own 30 s `HEALTHCHECK`, so at full sampling the probes produced thousands
 * of identical 68 ms traces a day and buried the handful of real searches —
 * observed in Grafana within minutes of enabling the exporter.
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

/**
 * Same matching rule as the rate limiter's `isExempt`: exact, or a sub-path.
 * A plain `startsWith` would silently swallow a future `/healthy-products`.
 */
function isIgnored(attributes: Attributes): boolean {
  for (const key of PATH_ATTRIBUTES) {
    const value = attributes[key];
    if (typeof value !== 'string') {
      continue;
    }
    const path = value.split('?')[0];
    if (IGNORED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
      return true;
    }
  }
  return false;
}
