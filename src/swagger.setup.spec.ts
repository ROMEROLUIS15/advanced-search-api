import { type INestApplication } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import { RATE_LIMIT_STORE } from '@application/ports/rate-limit-store.port';
import type { AppConfiguration } from '@config/app-config';
import { setupOpenApi } from './swagger.setup';

const KEY = 'key-one';

function configWith(enabled: boolean, rateLimitEnabled = false): AppConfiguration {
  return {
    apiAuth: { enabled, keys: [KEY] },
    rateLimit: { enabled: rateLimitEnabled, windowSeconds: 60, default: 120 },
  } as AppConfiguration;
}

function appDouble(): { app: INestApplication; use: jest.Mock; get: jest.Mock } {
  const use = jest.fn();
  const get = jest.fn(() => ({
    hit: jest.fn().mockResolvedValue({ totalHits: 1, timeToExpireMs: 60_000 }),
  }));
  return { app: { use, get } as unknown as INestApplication, use, get };
}

/**
 * The key check is the **last** middleware registered on the docs paths: when
 * rate limiting is on, the limiter is registered ahead of it on purpose.
 */
function runMiddleware(
  use: jest.Mock,
  headers: Record<string, unknown>,
): { status?: number; body?: any; nextCalled: boolean } {
  const registrations = use.mock.calls;
  const middleware = registrations[registrations.length - 1][1] as (
    req: any,
    res: any,
    next: () => void,
  ) => void;
  let status: number | undefined;
  let body: any;
  let nextCalled = false;
  const res = {
    status: (code: number) => {
      status = code;
      return { json: (payload: any) => (body = payload) };
    },
  };
  middleware({ headers, originalUrl: '/docs-json' }, res, () => (nextCalled = true));
  return { status, body, nextCalled };
}

describe('setupOpenApi', () => {
  beforeEach(() => {
    jest.spyOn(SwaggerModule, 'createDocument').mockReturnValue({ openapi: '3.0.0' } as never);
    jest.spyOn(SwaggerModule, 'setup').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('mounts Swagger at /docs with a JSON route', () => {
    const { app } = appDouble();

    setupOpenApi(app, configWith(false));

    expect(SwaggerModule.createDocument).toHaveBeenCalledWith(app, expect.any(Object));
    expect(SwaggerModule.setup).toHaveBeenCalledWith('docs', app, expect.any(Object), {
      jsonDocumentUrl: 'docs-json',
    });
  });

  it('declares the API key scheme so the UI can send it', () => {
    const { app } = appDouble();

    setupOpenApi(app, configWith(false));

    const [, document] = (SwaggerModule.createDocument as jest.Mock).mock.calls[0];
    expect(document.components.securitySchemes).toMatchObject({
      'api-key': { type: 'apiKey', name: 'X-API-Key', in: 'header' },
    });
  });

  it('guards the docs paths when authentication is on — no Nest guard runs for them', () => {
    const { app, use } = appDouble();

    setupOpenApi(app, configWith(true));

    expect(use).toHaveBeenCalledWith(['/docs', '/docs-json'], expect.any(Function));
  });

  it('does not guard them when authentication is off', () => {
    const { app, use } = appDouble();

    setupOpenApi(app, configWith(false));

    expect(use).not.toHaveBeenCalled();
  });

  it('rejects a docs request with no key, in the project error shape', () => {
    const { app, use } = appDouble();
    setupOpenApi(app, configWith(true));

    const { status, body, nextCalled } = runMiddleware(use, {});

    expect(status).toBe(401);
    expect(body).toMatchObject({ statusCode: 401, error: 'Unauthorized', path: '/docs-json' });
    expect(nextCalled).toBe(false);
  });

  it('serves the docs to a caller holding a configured key', () => {
    const { app, use } = appDouble();
    setupOpenApi(app, configWith(true));

    const { nextCalled, status } = runMiddleware(use, { 'x-api-key': KEY });

    expect(nextCalled).toBe(true);
    expect(status).toBeUndefined();
  });
});

describe('setupOpenApi — the limiter reaches what the guard cannot', () => {
  beforeEach(() => {
    jest.spyOn(SwaggerModule, 'createDocument').mockReturnValue({ openapi: '3.0.0' } as never);
    jest.spyOn(SwaggerModule, 'setup').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('registers the limiter BEFORE the key check, so a flood is counted not refused for free', () => {
    // Same ordering as RateLimitModule before ApiAuthModule. Reversed, key
    // guessing against the contract would cost the attacker nothing.
    const { app, use, get } = appDouble();

    setupOpenApi(app, configWith(true, true));

    expect(get).toHaveBeenCalledWith(RATE_LIMIT_STORE);
    expect(use).toHaveBeenCalledTimes(2);
    expect(use.mock.calls[0][0]).toEqual(['/docs', '/docs-json']);
    expect(use.mock.calls[1][0]).toEqual(['/docs', '/docs-json']);
  });

  it('registers only the key check when rate limiting is off', () => {
    const { app, use, get } = appDouble();

    setupOpenApi(app, configWith(true, false));

    expect(use).toHaveBeenCalledTimes(1);
    expect(get).not.toHaveBeenCalled();
  });

  it('touches neither when authentication is off', () => {
    const { app, use, get } = appDouble();

    setupOpenApi(app, configWith(false, true));

    expect(use).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });
});
