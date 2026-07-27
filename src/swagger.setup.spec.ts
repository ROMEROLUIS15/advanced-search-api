import { type INestApplication } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import type { AppConfiguration } from '@config/app-config';
import { setupOpenApi } from './swagger.setup';

const KEY = 'key-one';

function configWith(enabled: boolean): AppConfiguration {
  return { apiAuth: { enabled, keys: [KEY] } } as AppConfiguration;
}

function appDouble(): { app: INestApplication; use: jest.Mock } {
  const use = jest.fn();
  return { app: { use } as unknown as INestApplication, use };
}

function runMiddleware(
  use: jest.Mock,
  headers: Record<string, unknown>,
): { status?: number; body?: any; nextCalled: boolean } {
  const middleware = use.mock.calls[0][1] as (req: any, res: any, next: () => void) => void;
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
