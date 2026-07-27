import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { AppConfiguration } from '@config/app-config';
import { ApiKeyGuard } from './api-key.guard';

const VALID = 'key-one';
const SECOND = 'key-two';

function configWith(enabled: boolean, keys: string[] = [VALID, SECOND]): AppConfiguration {
  return { apiAuth: { enabled, keys } } as AppConfiguration;
}

function contextFor(url: string, headers: Record<string, unknown> = {}): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ url, headers }) }),
  } as unknown as ExecutionContext;
}

describe('ApiKeyGuard (design D30–D32)', () => {
  it('rejects a client endpoint with no key', () => {
    const guard = new ApiKeyGuard(configWith(true));

    expect(() => guard.canActivate(contextFor('/search?q=drill'))).toThrow(UnauthorizedException);
  });

  it('rejects an unknown key', () => {
    const guard = new ApiKeyGuard(configWith(true));

    expect(() =>
      guard.canActivate(contextFor('/search', { 'x-api-key': 'not-a-real-key' })),
    ).toThrow(UnauthorizedException);
  });

  it('admits a configured key', () => {
    const guard = new ApiKeyGuard(configWith(true));

    expect(guard.canActivate(contextFor('/search', { 'x-api-key': VALID }))).toBe(true);
  });

  it('admits the second key too, which is what makes rotation possible', () => {
    const guard = new ApiKeyGuard(configWith(true));

    expect(guard.canActivate(contextFor('/search', { 'x-api-key': SECOND }))).toBe(true);
  });

  it.each(['/health', '/health?probe=1'])(
    'leaves %s open: the probe cannot send a header',
    (url) => {
      const guard = new ApiKeyGuard(configWith(true));

      expect(guard.canActivate(contextFor(url))).toBe(true);
    },
  );

  it('leaves /metrics to its own bearer token rather than stacking a second credential', () => {
    const guard = new ApiKeyGuard(configWith(true));

    expect(guard.canActivate(contextFor('/metrics'))).toBe(true);
  });

  it.each(['/docs', '/docs-json', '/', '/autocomplete?q=dr', '/suggest?q=drll'])(
    'protects %s — the contract is not public either',
    (url) => {
      const guard = new ApiKeyGuard(configWith(true));

      expect(() => guard.canActivate(contextFor(url))).toThrow(UnauthorizedException);
    },
  );

  it('never echoes the presented key back in the rejection', () => {
    const guard = new ApiKeyGuard(configWith(true));

    try {
      guard.canActivate(contextFor('/search', { 'x-api-key': 'secret-guess-123' }));
      throw new Error('expected a rejection');
    } catch (error) {
      expect(String((error as Error).message)).not.toContain('secret-guess-123');
      expect(String((error as Error).message)).toMatch(/x-api-key/i);
    }
  });

  it('passes everything through when authentication is disabled', () => {
    const guard = new ApiKeyGuard(configWith(false, []));

    expect(guard.canActivate(contextFor('/search'))).toBe(true);
  });

  it('takes the first value when the header is repeated', () => {
    const guard = new ApiKeyGuard(configWith(true));

    expect(guard.canActivate(contextFor('/search', { 'x-api-key': [VALID, 'x'] }))).toBe(true);
  });
});
