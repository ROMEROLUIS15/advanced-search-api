import type { RateLimitStorePort } from '@application/ports/rate-limit-store.port';
import { ThrottlerStoreAdapter } from './throttler-store.adapter';

function buildAdapter(hit: jest.Mock): ThrottlerStoreAdapter {
  const store: RateLimitStorePort = { hit };
  return new ThrottlerStoreAdapter(store);
}

describe('ThrottlerStoreAdapter', () => {
  it('passes the window straight through in milliseconds and namespaces by throttler', async () => {
    // Arrange
    const hit = jest.fn().mockResolvedValue({ totalHits: 1, timeToExpireMs: 60_000 });
    const adapter = buildAdapter(hit);

    // Act
    await adapter.increment('abc', 60_000, 60, 0, 'default');

    // Assert
    expect(hit).toHaveBeenCalledWith('default:abc', 60_000);
  });

  it('reports the remaining window in seconds, as the library expects', async () => {
    // Arrange
    const hit = jest.fn().mockResolvedValue({ totalHits: 1, timeToExpireMs: 41_200 });
    const adapter = buildAdapter(hit);

    // Act
    const record = await adapter.increment('abc', 60_000, 60, 0, 'default');

    // Assert
    expect(record.timeToExpire).toBe(42);
  });

  it('serves the request that reaches the budget exactly', async () => {
    // Arrange
    const hit = jest.fn().mockResolvedValue({ totalHits: 60, timeToExpireMs: 1_000 });
    const adapter = buildAdapter(hit);

    // Act
    const record = await adapter.increment('abc', 60_000, 60, 0, 'default');

    // Assert
    expect(record.isBlocked).toBe(false);
  });

  it('refuses the first request past the budget', async () => {
    // Arrange
    const hit = jest.fn().mockResolvedValue({ totalHits: 61, timeToExpireMs: 1_000 });
    const adapter = buildAdapter(hit);

    // Act
    const record = await adapter.increment('abc', 60_000, 60, 0, 'default');

    // Assert
    expect(record.isBlocked).toBe(true);
  });

  it('reports retry-after as the remainder of the window, not a separate block', async () => {
    // Arrange
    const hit = jest.fn().mockResolvedValue({ totalHits: 99, timeToExpireMs: 12_000 });
    const adapter = buildAdapter(hit);

    // Act
    const record = await adapter.increment('abc', 60_000, 60, 0, 'default');

    // Assert
    expect(record.timeToBlockExpire).toBe(12);
    expect(record.timeToBlockExpire).toBe(record.timeToExpire);
  });

  it('never reports a negative remainder', async () => {
    // Arrange
    const hit = jest.fn().mockResolvedValue({ totalHits: 1, timeToExpireMs: -5 });
    const adapter = buildAdapter(hit);

    // Act
    const record = await adapter.increment('abc', 60_000, 60, 0, 'default');

    // Assert
    expect(record.timeToExpire).toBe(0);
  });
});
