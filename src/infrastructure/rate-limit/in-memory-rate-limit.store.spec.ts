import { InMemoryRateLimitStore } from './in-memory-rate-limit.store';

describe('InMemoryRateLimitStore', () => {
  let store: InMemoryRateLimitStore;

  beforeEach(() => {
    store = new InMemoryRateLimitStore();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('counts the first request as one and opens the window', async () => {
    // Arrange & Act
    const hit = await store.hit('client-a', 60_000);

    // Assert
    expect(hit.totalHits).toBe(1);
    expect(hit.timeToExpireMs).toBe(60_000);
  });

  it('accumulates hits for the same key within the window', async () => {
    // Arrange & Act
    await store.hit('client-a', 60_000);
    await store.hit('client-a', 60_000);
    const third = await store.hit('client-a', 60_000);

    // Assert
    expect(third.totalHits).toBe(3);
  });

  it('keeps separate counts per key, so one client cannot exhaust another', async () => {
    // Arrange
    await store.hit('client-a', 60_000);
    await store.hit('client-a', 60_000);

    // Act
    const other = await store.hit('client-b', 60_000);

    // Assert
    expect(other.totalHits).toBe(1);
  });

  it('reports the shrinking remainder of the window', async () => {
    // Arrange
    await store.hit('client-a', 60_000);

    // Act
    jest.advanceTimersByTime(20_000);
    const second = await store.hit('client-a', 60_000);

    // Assert
    expect(second.timeToExpireMs).toBe(40_000);
  });

  it('starts a fresh window once the previous one elapses', async () => {
    // Arrange
    await store.hit('client-a', 60_000);
    await store.hit('client-a', 60_000);

    // Act
    jest.advanceTimersByTime(60_001);
    const afterReset = await store.hit('client-a', 60_000);

    // Assert
    expect(afterReset.totalHits).toBe(1);
    expect(afterReset.timeToExpireMs).toBe(60_000);
  });

  it('does not retain expired keys', async () => {
    // Arrange
    await store.hit('gone', 1_000);

    // Act
    jest.advanceTimersByTime(1_001);
    await store.hit('other', 1_000);

    // Assert
    expect((store as unknown as { windows: Map<string, unknown> }).windows.has('gone')).toBe(false);
  });
});
