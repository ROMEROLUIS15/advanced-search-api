import { buildAutocompleteCacheKey } from './autocomplete-cache-key';

const SCOPE = 'a1b2c3d4';

describe('buildAutocompleteCacheKey', () => {
  it('is namespaced, scoped, and keeps the limit readable', () => {
    expect(buildAutocompleteCacheKey('dri', 10, SCOPE)).toMatch(/^ac:v1:a1b2c3d4:[a-f0-9]{40}:10$/);
  });

  it('normalizes the prefix (trim + lowercase)', () => {
    expect(buildAutocompleteCacheKey('  Dri  ', 10, SCOPE)).toBe(
      buildAutocompleteCacheKey('dri', 10, SCOPE),
    );
  });

  it('differs by limit', () => {
    expect(buildAutocompleteCacheKey('dri', 5, SCOPE)).not.toBe(
      buildAutocompleteCacheKey('dri', 10, SCOPE),
    );
  });

  it('differs by scope, so another index cannot serve these completions', () => {
    expect(buildAutocompleteCacheKey('dri', 10, SCOPE)).not.toBe(
      buildAutocompleteCacheKey('dri', 10, 'ffffffff'),
    );
  });

  it('never writes what the user typed into the key', () => {
    // Arrange & Act: the whole point — an operator reading the keyspace learns
    // that someone searched, not what for.
    const key = buildAutocompleteCacheKey('divorce lawyer', 10, SCOPE);

    // Assert
    expect(key).not.toContain('divorce');
    expect(key).not.toContain('lawyer');
  });
});
