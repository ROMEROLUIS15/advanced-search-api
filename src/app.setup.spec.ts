import type { INestApplication } from '@nestjs/common';
import type { AppConfiguration } from '@config/app-config';
import { configureProxyTrust, resolveCorsOrigin } from './app.setup';

function configWith(overrides: {
  corsOrigins?: string[];
  nodeEnv?: AppConfiguration['app']['nodeEnv'];
  trustProxyHops?: number;
}): AppConfiguration {
  return {
    app: { corsOrigins: overrides.corsOrigins ?? [], nodeEnv: overrides.nodeEnv ?? 'development' },
    rateLimit: { trustProxyHops: overrides.trustProxyHops ?? 0 },
  } as AppConfiguration;
}

describe('resolveCorsOrigin (design D13)', () => {
  it('returns an explicit allow-list when one is configured', () => {
    // Arrange & Act
    const origin = resolveCorsOrigin(
      configWith({ corsOrigins: ['https://a.com'], nodeEnv: 'production' }),
    );

    // Assert — the explicit list wins over the env default
    expect(origin).toEqual(['https://a.com']);
  });

  it('reflects any origin in development when no list is set', () => {
    // Arrange & Act
    const origin = resolveCorsOrigin(configWith({ nodeEnv: 'development' }));

    // Assert
    expect(origin).toBe(true);
  });

  it('falls back to same-origin in production when no list is set', () => {
    // Arrange & Act
    const origin = resolveCorsOrigin(configWith({ nodeEnv: 'production' }));

    // Assert
    expect(origin).toBe(false);
  });
});

describe('configureProxyTrust (design D16)', () => {
  it('sets Express trust proxy to the configured hop count', () => {
    // Arrange
    const set = jest.fn();
    const app = { set } as unknown as INestApplication;

    // Act
    configureProxyTrust(app, configWith({ trustProxyHops: 3 }));

    // Assert
    expect(set).toHaveBeenCalledWith('trust proxy', 3);
  });

  it('is a no-op when the adapter has no set method (non-Express harness)', () => {
    // Arrange
    const app = {} as INestApplication;

    // Act & Assert — must not throw
    expect(() => configureProxyTrust(app, configWith({ trustProxyHops: 1 }))).not.toThrow();
  });
});
