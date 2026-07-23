import type { ExecutionContext } from '@nestjs/common';
import type { ThrottlerModuleOptions } from '@nestjs/throttler';
import type { RateLimitConfig } from '@config/app-config';
import { buildThrottlerOptions, isExempt, resolveLimit } from './rate-limit.options';

/** Narrows the union return type to the object form this module always builds. */
function skipIfOf(options: ThrottlerModuleOptions): (context: ExecutionContext) => boolean {
  if (Array.isArray(options) || !options.skipIf) {
    throw new Error('expected object-form options with skipIf');
  }
  return options.skipIf;
}

const config: RateLimitConfig = {
  enabled: true,
  windowSeconds: 60,
  search: 60,
  autocomplete: 300,
  suggest: 60,
  default: 120,
  trustProxyHops: 0,
};

function contextFor(path: string): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ path }) }),
  } as unknown as ExecutionContext;
}

describe('resolveLimit', () => {
  it.each([
    ['/search', 60],
    ['/search?q=drill&category=Tools', 60],
    ['/autocomplete', 300],
    ['/suggest', 60],
    ['/', 120],
  ])('gives %s a budget of %i per window', (path, expected) => {
    // Arrange & Act
    const limit = resolveLimit(contextFor(path), config);

    // Assert
    expect(limit).toBe(expected);
  });

  it('gives type-ahead a far larger budget than deliberate search', () => {
    // Arrange & Act
    const search = resolveLimit(contextFor('/search'), config);
    const autocomplete = resolveLimit(contextFor('/autocomplete'), config);

    // Assert — autocomplete fires on nearly every keystroke
    expect(autocomplete).toBeGreaterThan(search);
  });
});

describe('isExempt', () => {
  it('exempts the readiness probe, which the platform polls constantly', () => {
    // Arrange & Act & Assert
    expect(isExempt('/health')).toBe(true);
  });

  it.each(['/search', '/autocomplete', '/suggest', '/', '/healthy-products'])(
    'does not exempt %s',
    (path) => {
      // Arrange & Act & Assert
      expect(isExempt(path)).toBe(false);
    },
  );
});

describe('buildThrottlerOptions', () => {
  it('derives the window in milliseconds, as the library expects', () => {
    // Arrange & Act
    const options = buildThrottlerOptions(config);

    // Assert
    const throttlers = Array.isArray(options) ? options : options.throttlers;
    expect(throttlers[0].ttl).toBe(60_000);
  });

  it('skips the health probe while enforcing everything else', () => {
    // Arrange
    const skipIf = skipIfOf(buildThrottlerOptions(config));

    // Act & Assert
    expect(skipIf(contextFor('/health'))).toBe(true);
    expect(skipIf(contextFor('/search'))).toBe(false);
  });

  it('skips every route when enforcement is switched off (D19)', () => {
    // Arrange
    const skipIf = skipIfOf(buildThrottlerOptions({ ...config, enabled: false }));

    // Act & Assert
    expect(skipIf(contextFor('/search'))).toBe(true);
    expect(skipIf(contextFor('/autocomplete'))).toBe(true);
  });
});
