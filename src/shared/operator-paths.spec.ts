import { OPERATOR_PATHS, matchesPath, pathWithoutQuery } from './operator-paths';

describe('matchesPath', () => {
  it.each([
    ['/health', true],
    ['/metrics', true],
    // The health family: readiness and liveness are exempt because they are
    // sub-paths, which is what lets them be added without touching this list
    // or any of its consumers (design D40).
    ['/health/ready', true],
    ['/health/live', true],
    ['/health?probe=1', true],
    ['/health/ready?probe=1', true],
    ['/metrics?format=text', true],
    ['/search', false],
    ['/', false],
    // The reason this is not a bare startsWith: both are plausible future routes.
    ['/healthy-products', false],
    ['/metrics-report', false],
    ['', false],
  ])('%s -> %s against the operator paths', (path, expected) => {
    expect(matchesPath(path, OPERATOR_PATHS)).toBe(expected);
  });

  it('matches against whatever list it is given, not a hard-coded one', () => {
    expect(matchesPath('/health', ['/health'])).toBe(true);
    expect(matchesPath('/metrics', ['/health'])).toBe(false);
  });

  it('lists both operator endpoints, which four call sites depend on', () => {
    // The API-key guard, the request logger and the trace sampler read this
    // list; the rate limiter keeps its own narrower one over the same matcher.
    expect([...OPERATOR_PATHS]).toEqual(['/health', '/metrics']);
  });

  it('removes query parameters from paths used in logs', () => {
    expect(pathWithoutQuery('/search?q=private')).toBe('/search');
    expect(pathWithoutQuery('/search')).toBe('/search');
  });
});
