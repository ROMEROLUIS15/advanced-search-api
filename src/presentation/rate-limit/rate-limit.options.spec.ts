import type { ExecutionContext } from '@nestjs/common';
import type { ThrottlerModuleOptions } from '@nestjs/throttler';
import type { RateLimitConfig } from '@config/app-config';
import { createKeyIdentifier } from '@presentation/auth/api-key.identity';
import {
  buildThrottlerOptions,
  isExempt,
  resolveLimit,
  resolveTracker,
} from './rate-limit.options';

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
    const options = buildThrottlerOptions(config, () => undefined);

    // Assert
    const throttlers = Array.isArray(options) ? options : options.throttlers;
    expect(throttlers[0].ttl).toBe(60_000);
  });

  it('skips the health probe while enforcing everything else', () => {
    // Arrange
    const skipIf = skipIfOf(buildThrottlerOptions(config, () => undefined));

    // Act & Assert
    expect(skipIf(contextFor('/health'))).toBe(true);
    expect(skipIf(contextFor('/search'))).toBe(false);
  });

  it('skips every route when enforcement is switched off (D19)', () => {
    // Arrange
    const skipIf = skipIfOf(buildThrottlerOptions({ ...config, enabled: false }, () => undefined));

    // Act & Assert
    expect(skipIf(contextFor('/search'))).toBe(true);
    expect(skipIf(contextFor('/autocomplete'))).toBe(true);
  });
});

describe('resolveTracker (design D34)', () => {
  const VALID = 'key-one';
  const identify = createKeyIdentifier([VALID, 'key-two']);

  it('gives a client with a valid key its own bucket', () => {
    // Arrange & Act
    const tracker = resolveTracker(
      { ip: '203.0.113.7', headers: { 'x-api-key': VALID } },
      identify,
    );

    // Assert
    expect(tracker).toMatch(/^key:[0-9a-f]{16}$/);
  });

  it('separates two consumers calling from the same address', () => {
    // Arrange
    const address = '203.0.113.7';

    // Act
    const first = resolveTracker({ ip: address, headers: { 'x-api-key': VALID } }, identify);
    const second = resolveTracker({ ip: address, headers: { 'x-api-key': 'key-two' } }, identify);

    // Assert: sharing an office address no longer means sharing a budget.
    expect(first).not.toBe(second);
  });

  it('never puts the credential itself in the tracker', () => {
    // Arrange & Act
    const tracker = resolveTracker(
      { ip: '203.0.113.7', headers: { 'x-api-key': VALID } },
      identify,
    );

    // Assert: this string reaches Redis and an operator's screen.
    expect(tracker).not.toContain(VALID);
  });

  it('falls back to the address when no key is presented', () => {
    // Arrange & Act & Assert
    expect(resolveTracker({ ip: '203.0.113.7', headers: {} }, identify)).toBe('203.0.113.7');
  });

  it('falls back to the address for an INVALID key, so guessing cannot mint buckets', () => {
    // Arrange & Act
    const tracker = resolveTracker(
      { ip: '203.0.113.7', headers: { 'x-api-key': 'not-a-real-key' } },
      identify,
    );

    // Assert: otherwise a caller would get a fresh budget per guess.
    expect(tracker).toBe('203.0.113.7');
  });

  it('falls back to the socket address when req.ip is absent', () => {
    // Arrange & Act
    const tracker = resolveTracker({ socket: { remoteAddress: '198.51.100.4' } }, identify);

    // Assert
    expect(tracker).toBe('198.51.100.4');
  });

  it('yields a stable placeholder when no address can be resolved', () => {
    // Arrange & Act & Assert
    expect(resolveTracker({}, identify)).toBe('unknown');
  });

  it('takes the first value when the header is repeated', () => {
    // Arrange & Act
    const tracker = resolveTracker(
      { ip: '1.2.3.4', headers: { 'x-api-key': [VALID, 'x'] } },
      identify,
    );

    // Assert
    expect(tracker).toMatch(/^key:/);
  });
});
