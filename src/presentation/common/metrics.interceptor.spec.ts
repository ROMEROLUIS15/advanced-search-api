import { EventEmitter } from 'node:events';
import { of, throwError } from 'rxjs';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { MetricsPort } from '@application/ports/metrics.port';
import { MetricsInterceptor } from './metrics.interceptor';

function buildMetrics(): jest.Mocked<MetricsPort> {
  return {
    observeRequest: jest.fn(),
    recordCacheHit: jest.fn(),
    recordCacheMiss: jest.fn(),
    recordRateLimitFailover: jest.fn(),
  };
}

function buildContext(
  request: object,
  response: EventEmitter & { statusCode: number },
): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
  } as unknown as ExecutionContext;
}

function buildResponse(statusCode: number): EventEmitter & { statusCode: number } {
  return Object.assign(new EventEmitter(), { statusCode });
}

const handler: CallHandler = { handle: () => of('body') };

describe('MetricsInterceptor', () => {
  it('records the matched route pattern, never the URL with its query string', () => {
    // Arrange
    const metrics = buildMetrics();
    const response = buildResponse(200);
    const context = buildContext(
      { method: 'GET', url: '/search?q=drill&page=2', route: { path: '/search' } },
      response,
    );

    // Act
    new MetricsInterceptor(metrics).intercept(context, handler).subscribe();
    response.emit('finish');

    // Assert
    expect(metrics.observeRequest).toHaveBeenCalledWith('GET', '/search', 200, expect.any(Number));
  });

  it('buckets everything unrouted under one label instead of exploding cardinality', () => {
    // Arrange
    const metrics = buildMetrics();
    const response = buildResponse(404);
    const context = buildContext({ method: 'GET', url: '/nope' }, response);

    // Act
    new MetricsInterceptor(metrics).intercept(context, handler).subscribe();
    response.emit('finish');

    // Assert
    expect(metrics.observeRequest).toHaveBeenCalledWith(
      'GET',
      'unmatched',
      404,
      expect.any(Number),
    );
  });

  it('records the final status of a failed request, which tap() would have missed', () => {
    // Arrange
    const metrics = buildMetrics();
    const response = buildResponse(200);
    const context = buildContext(
      { method: 'GET', url: '/search', route: { path: '/search' } },
      response,
    );
    const failing: CallHandler = { handle: () => throwError(() => new Error('boom')) };

    // Act
    new MetricsInterceptor(metrics)
      .intercept(context, failing)
      .subscribe({ error: () => undefined });
    // The filter writes the status after the observable errors; 'finish' is the
    // only moment it is final.
    response.statusCode = 502;
    response.emit('finish');

    // Assert
    expect(metrics.observeRequest).toHaveBeenCalledWith('GET', '/search', 502, expect.any(Number));
  });

  it('records nothing until the response actually finishes', () => {
    // Arrange
    const metrics = buildMetrics();
    const response = buildResponse(200);
    const context = buildContext({ method: 'GET', url: '/', route: { path: '/' } }, response);

    // Act
    new MetricsInterceptor(metrics).intercept(context, handler).subscribe();

    // Assert
    expect(metrics.observeRequest).not.toHaveBeenCalled();
  });
});
