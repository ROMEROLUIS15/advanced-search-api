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

  it('does not retain expired keys once a sweep is due', async () => {
    // Arrange
    await store.hit('gone', 1_000);

    // Act: past the window *and* past the sweep interval. Sweeping on every hit
    // instead would make each request O(active clients) on the fail-over path.
    jest.advanceTimersByTime(31_000);
    await store.hit('other', 1_000);

    // Assert
    expect((store as unknown as { windows: Map<string, unknown> }).windows.has('gone')).toBe(false);
  });
});

describe('InMemoryRateLimitStore — sweeping (QA review follow-up)', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('counts correctly without sweeping, because expiry is checked per key', async () => {
    // Arrange
    jest.useFakeTimers().setSystemTime(0);
    const store = new InMemoryRateLimitStore();

    // Act
    await store.hit('client-a', 1_000);
    jest.setSystemTime(1_500);
    const afterWindow = await store.hit('client-a', 1_000);

    // Assert: the window reset even though no sweep ran in between.
    expect(afterWindow.totalHits).toBe(1);
  });

  it('reclaims expired entries once the sweep interval has passed', async () => {
    // Arrange
    jest.useFakeTimers().setSystemTime(0);
    const store = new InMemoryRateLimitStore();
    for (let i = 0; i < 50; i += 1) {
      await store.hit(`client-${i}`, 1_000);
    }

    // Act: past both the window and the 30 s sweep interval.
    jest.setSystemTime(40_000);
    await store.hit('client-new', 1_000);

    // Assert: the 50 expired windows are gone, only the fresh one remains.
    const windows = (store as unknown as { windows: Map<string, unknown> }).windows;
    expect(windows.size).toBe(1);
  });

  it('does not sweep on every hit, which is what made it O(n) per request', async () => {
    // Arrange
    jest.useFakeTimers().setSystemTime(0);
    const store = new InMemoryRateLimitStore();
    await store.hit('client-a', 1_000);

    // Act: well past the window, but nowhere near the sweep interval.
    jest.setSystemTime(2_000);
    await store.hit('client-b', 1_000);

    // Assert: client-a's expired entry is still resident — reclaimed later, not now.
    const windows = (store as unknown as { windows: Map<string, unknown> }).windows;
    expect(windows.size).toBe(2);
  });
});
