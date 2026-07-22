import { buildAutocompleteCacheKey } from './autocomplete-cache-key';

describe('buildAutocompleteCacheKey', () => {
  it('normalizes the prefix (trim + lowercase) and includes the limit', () => {
    expect(buildAutocompleteCacheKey('  Dri  ', 10)).toBe('ac:v1:dri:10');
  });

  it('differs by limit', () => {
    expect(buildAutocompleteCacheKey('dri', 5)).not.toBe(buildAutocompleteCacheKey('dri', 10));
  });
});
