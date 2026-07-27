import { NoopMetricsAdapter } from './noop-metrics.adapter';
import { PrometheusMetricsAdapter } from './prometheus-metrics.adapter';

describe('PrometheusMetricsAdapter', () => {
  it('exposes process metrics without anyone recording anything', async () => {
    // Arrange
    const adapter = new PrometheusMetricsAdapter();

    // Act
    const output = await adapter.render();

    // Assert
    expect(output).toContain('process_cpu_user_seconds_total');
    expect(adapter.contentType).toContain('text/plain');
  });

  it('counts a request and its duration under the route label, not the raw URL', async () => {
    // Arrange
    const adapter = new PrometheusMetricsAdapter();

    // Act
    adapter.observeRequest('GET', '/search', 200, 12.5);

    // Assert
    const output = await adapter.render();
    expect(output).toContain('http_requests_total{method="GET",route="/search",status="200"} 1');
    expect(output).toContain('http_request_duration_seconds_bucket');
  });

  it('separates cache hits from misses', async () => {
    // Arrange
    const adapter = new PrometheusMetricsAdapter();

    // Act
    adapter.recordCacheHit();
    adapter.recordCacheHit();
    adapter.recordCacheMiss();

    // Assert
    const output = await adapter.render();
    expect(output).toContain('search_cache_events_total{result="hit"} 2');
    expect(output).toContain('search_cache_events_total{result="miss"} 1');
  });

  it('counts rate-limit fail-overs, the signal a Redis outage produces', async () => {
    // Arrange
    const adapter = new PrometheusMetricsAdapter();

    // Act
    adapter.recordRateLimitFailover();

    // Assert
    expect(await adapter.render()).toContain('rate_limit_failover_total 1');
  });

  it('keeps its own registry, so two instances do not collide on metric names', () => {
    // Arrange & Act & Assert
    expect(() => new PrometheusMetricsAdapter()).not.toThrow();
  });
});

describe('NoopMetricsAdapter', () => {
  it('accepts every recording call and renders nothing', async () => {
    // Arrange
    const adapter = new NoopMetricsAdapter();

    // Act
    adapter.observeRequest();
    adapter.recordCacheHit();
    adapter.recordCacheMiss();
    adapter.recordRateLimitFailover();

    // Assert: an empty 200 tells a scraper "metrics are off" without a 404 to interpret.
    expect(await adapter.render()).toBe('');
    expect(adapter.contentType).toContain('text/plain');
  });
});
