import { type Attributes, ROOT_CONTEXT, SpanKind } from '@opentelemetry/api';
import {
  AlwaysOnSampler,
  type Sampler,
  SamplingDecision,
  type SamplingResult,
} from '@opentelemetry/sdk-trace-base';
import { IgnoredPathsSampler } from './ignored-paths.sampler';

function sample(
  attributes: Attributes,
  kind: SpanKind = SpanKind.SERVER,
  delegate: Sampler = new AlwaysOnSampler(),
): SamplingResult {
  return new IgnoredPathsSampler(delegate).shouldSample(
    ROOT_CONTEXT,
    'trace-id',
    'GET',
    kind,
    attributes,
    [],
  );
}

describe('IgnoredPathsSampler (design D25)', () => {
  it.each([
    ['url.path', { 'url.path': '/health' }],
    ['http.route', { 'http.route': '/health' }],
    ['http.target', { 'http.target': '/health?probe=1' }],
  ])('drops a probe trace whatever semantic convention carries the path (%s)', (_name, attrs) => {
    expect(sample(attrs).decision).toBe(SamplingDecision.NOT_RECORD);
  });

  it('drops /metrics as well — a scrape is not client traffic either', () => {
    expect(sample({ 'url.path': '/metrics' }).decision).toBe(SamplingDecision.NOT_RECORD);
  });

  it('keeps real traffic', () => {
    expect(sample({ 'url.path': '/search' }).decision).toBe(SamplingDecision.RECORD_AND_SAMPLED);
  });

  it.each(['/healthy-products', '/metrics-report', '/searching'])(
    'does not drop %s, which merely starts with the same letters',
    (path) => {
      expect(sample({ 'url.path': path }).decision).toBe(SamplingDecision.RECORD_AND_SAMPLED);
    },
  );

  it('still drops a sub-path of a probe, e.g. /health/ready', () => {
    expect(sample({ 'url.path': '/health/ready' }).decision).toBe(SamplingDecision.NOT_RECORD);
  });

  it('only judges server spans, so an outbound call to a /health URL is untouched', () => {
    expect(sample({ 'url.path': '/health' }, SpanKind.CLIENT).decision).toBe(
      SamplingDecision.RECORD_AND_SAMPLED,
    );
  });

  it('defers to the delegate for everything it does not drop', () => {
    // Arrange
    const delegate: Sampler = {
      shouldSample: jest.fn().mockReturnValue({ decision: SamplingDecision.NOT_RECORD }),
      toString: () => 'Stub',
    };

    // Act
    const result = sample({ 'url.path': '/search' }, SpanKind.SERVER, delegate);

    // Assert: the ratio still gets to say no.
    expect(delegate.shouldSample).toHaveBeenCalledTimes(1);
    expect(result.decision).toBe(SamplingDecision.NOT_RECORD);
  });

  it('describes itself with the delegate, which is what shows up in diagnostics', () => {
    expect(new IgnoredPathsSampler(new AlwaysOnSampler()).toString()).toContain('AlwaysOnSampler');
  });

  it('keeps a span with no path attribute at all rather than guessing', () => {
    expect(sample({}).decision).toBe(SamplingDecision.RECORD_AND_SAMPLED);
  });
});
