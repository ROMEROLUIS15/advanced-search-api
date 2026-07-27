import { getCorrelationId, runWithCorrelationId } from './correlation.store';

describe('correlation store', () => {
  it('exposes the id to everything running inside the callback', () => {
    // Arrange & Act
    const seen = runWithCorrelationId('abc-123', () => getCorrelationId());

    // Assert
    expect(seen).toBe('abc-123');
  });

  it('survives await boundaries, which is why a use-case can log the id', async () => {
    // Arrange & Act
    const seen = await runWithCorrelationId('async-1', async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 1));
      return getCorrelationId();
    });

    // Assert
    expect(seen).toBe('async-1');
  });

  it('returns undefined outside a request, e.g. during bootstrap or the seed', () => {
    // Arrange & Act & Assert
    expect(getCorrelationId()).toBeUndefined();
  });

  it('keeps concurrent requests apart', async () => {
    // Arrange
    const first = runWithCorrelationId('one', async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return getCorrelationId();
    });
    const second = runWithCorrelationId('two', async () => getCorrelationId());

    // Act
    const [a, b] = await Promise.all([first, second]);

    // Assert
    expect(a).toBe('one');
    expect(b).toBe('two');
  });
});
