import type { Request, Response } from 'express';
import type { RateLimitConfig } from '@config/app-config';
import type { RateLimitHit, RateLimitStorePort } from '@application/ports/rate-limit-store.port';
import { buildDocsRateLimitMiddleware } from './docs-rate-limit.middleware';

const config = {
  enabled: true,
  windowSeconds: 60,
  search: 60,
  autocomplete: 300,
  suggest: 60,
  default: 3,
  trustProxyHops: 0,
} as RateLimitConfig;

/** Only `known-key` resolves, mirroring how a real identifier behaves. */
const identify = (presented: string | undefined): string | undefined =>
  presented === 'known-key' ? 'key:abc123' : undefined;

function storeReturning(...outcomes: RateLimitHit[]): {
  store: RateLimitStorePort;
  keys: string[];
} {
  const keys: string[] = [];
  let call = 0;
  return {
    keys,
    store: {
      hit: jest.fn((key: string) => {
        keys.push(key);
        return Promise.resolve(outcomes[Math.min(call++, outcomes.length - 1)]);
      }),
    },
  };
}

function requestWith(headers: Record<string, string> = {}, ip = '10.0.0.7'): Request {
  return { headers, ip, originalUrl: '/docs-json' } as unknown as Request;
}

function responseSpy(): {
  res: Response;
  status: jest.Mock;
  json: jest.Mock;
  headers: Record<string, unknown>;
} {
  const json = jest.fn();
  const headers: Record<string, unknown> = {};
  const status = jest.fn(() => ({ json }) as unknown as Response);
  return {
    res: {
      status,
      json,
      setHeader: (name: string, value: unknown) => {
        headers[name] = value;
      },
    } as unknown as Response,
    status,
    json,
    headers,
  };
}

describe('docs rate limit middleware', () => {
  it('passes a request that is inside the budget', async () => {
    const { store } = storeReturning({ totalHits: 1, timeToExpireMs: 60_000 });
    const next = jest.fn();

    buildDocsRateLimitMiddleware(store, config, identify)(requestWith(), responseSpy().res, next);
    await Promise.resolve();

    expect(next).toHaveBeenCalled();
  });

  it('rejects with 429 and Retry-After once the budget is spent', async () => {
    const { store } = storeReturning({ totalHits: 4, timeToExpireMs: 21_000 });
    const next = jest.fn();
    const spy = responseSpy();

    buildDocsRateLimitMiddleware(store, config, identify)(requestWith(), spy.res, next);
    await Promise.resolve();

    expect(next).not.toHaveBeenCalled();
    expect(spy.status).toHaveBeenCalledWith(429);
    expect(spy.headers['Retry-After']).toBe(21);
  });

  it('counts an unauthenticated attempt, which is the flood worth metering', async () => {
    // The limiter runs before the key check for exactly this reason: rejecting
    // a bad key for free would leave key-guessing unmetered.
    const { store, keys } = storeReturning({ totalHits: 1, timeToExpireMs: 60_000 });

    buildDocsRateLimitMiddleware(store, config, identify)(
      requestWith({ 'x-api-key': 'wrong' }),
      responseSpy().res,
      jest.fn(),
    );
    await Promise.resolve();

    expect(keys[0]).toBe('docs:10.0.0.7');
  });

  it('gives a valid key its own bucket, so guessing cannot mint budgets', async () => {
    const { store, keys } = storeReturning({ totalHits: 1, timeToExpireMs: 60_000 });

    buildDocsRateLimitMiddleware(store, config, identify)(
      requestWith({ 'x-api-key': 'known-key' }),
      responseSpy().res,
      jest.fn(),
    );
    await Promise.resolve();

    expect(keys[0]).toBe('docs:key:abc123');
  });

  it('serves the contract when even the failover store throws', async () => {
    // The store already fails over rather than open; if that also fails, the
    // key check is still in front of the document.
    const store = { hit: jest.fn(() => Promise.reject(new Error('down'))) };
    const next = jest.fn();

    buildDocsRateLimitMiddleware(store, config, identify)(requestWith(), responseSpy().res, next);
    await Promise.resolve();
    await Promise.resolve();

    expect(next).toHaveBeenCalled();
  });
});
