import { OPERATOR_PATHS, matchesPath } from './operator-paths';

describe('matchesPath', () => {
  it.each([
    ['/health', true],
    ['/metrics', true],
    ['/health/ready', true],
    ['/health?probe=1', true],
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

  it('lists both operator endpoints, which three call sites depend on', () => {
    expect([...OPERATOR_PATHS]).toEqual(['/health', '/metrics']);
  });
});
