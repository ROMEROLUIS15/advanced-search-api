import { EventEmitter } from 'node:events';
import type { MetricsPort } from '@application/ports/metrics.port';
import { buildMetricsMiddleware } from './metrics.middleware';

function buildMetrics(): jest.Mocked<MetricsPort> {
  return {
    observeRequest: jest.fn(),
    recordCacheHit: jest.fn(),
    recordCacheMiss: jest.fn(),
    recordRateLimitFailover: jest.fn(),
  };
}

function buildResponse(statusCode: number): EventEmitter & { statusCode: number } {
  return Object.assign(new EventEmitter(), { statusCode });
}

function run(
  metrics: MetricsPort,
  request: object,
  response: EventEmitter & { statusCode: number },
): jest.Mock {
  const next = jest.fn();
  buildMetricsMiddleware(metrics)(request as never, response as never, next);
  return next;
}

describe('metricsMiddleware', () => {
  it('records the matched route pattern, never the URL with its query string', () => {
    // Arrange
    const metrics = buildMetrics();
    const response = buildResponse(200);
    const request = { method: 'GET', url: '/search?q=drill&page=2', route: { path: '/search' } };

    // Act
    const next = run(metrics, request, response);
    response.emit('finish');

    // Assert
    expect(next).toHaveBeenCalled();
    expect(metrics.observeRequest).toHaveBeenCalledWith('GET', '/search', 200, expect.any(Number));
  });

  it('buckets everything unrouted under one label instead of exploding cardinality', () => {
    // Arrange
    const metrics = buildMetrics();
    const response = buildResponse(404);

    // Act
    run(metrics, { method: 'GET', url: '/nope' }, response);
    response.emit('finish');

    // Assert
    expect(metrics.observeRequest).toHaveBeenCalledWith(
      'GET',
      'unmatched',
      404,
      expect.any(Number),
    );
  });

  it('counts a guard rejection, which the interceptor it replaces never saw', () => {
    // Arrange: an API-key 401 (or a 429) ends inside the route, after Express
    // matched it but before any interceptor ran — the middleware still measures.
    const metrics = buildMetrics();
    const response = buildResponse(401);
    const request = { method: 'GET', url: '/search?q=drill', route: { path: '/search' } };

    // Act
    run(metrics, request, response);
    response.emit('finish');

    // Assert
    expect(metrics.observeRequest).toHaveBeenCalledWith('GET', '/search', 401, expect.any(Number));
  });

  it('reads route and status at finish time, when both are final', () => {
    // Arrange: the middleware runs before the router, so at registration time
    // the request has no route and the status is still the default.
    const metrics = buildMetrics();
    const response = buildResponse(200);
    const request: { method: string; url: string; route?: { path: string } } = {
      method: 'GET',
      url: '/search',
    };

    // Act: Express matches the route and the exception filter writes the status
    // only later; 'finish' is the one moment both are settled.
    run(metrics, request, response);
    request.route = { path: '/search' };
    response.statusCode = 502;
    response.emit('finish');

    // Assert
    expect(metrics.observeRequest).toHaveBeenCalledWith('GET', '/search', 502, expect.any(Number));
  });

  it('records nothing until the response actually finishes', () => {
    // Arrange
    const metrics = buildMetrics();
    const response = buildResponse(200);

    // Act
    run(metrics, { method: 'GET', url: '/', route: { path: '/' } }, response);

    // Assert
    expect(metrics.observeRequest).not.toHaveBeenCalled();
  });
});
