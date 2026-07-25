import { type INestApplication } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import { setupOpenApi } from './swagger.setup';

describe('setupOpenApi', () => {
  afterEach(() => jest.restoreAllMocks());

  it('builds the OpenAPI document and mounts Swagger at /docs with a JSON route', () => {
    const app = {} as INestApplication;
    const document = { openapi: '3.0.0' };
    const createDocument = jest
      .spyOn(SwaggerModule, 'createDocument')
      .mockReturnValue(document as never);
    const setup = jest.spyOn(SwaggerModule, 'setup').mockImplementation(() => undefined);

    setupOpenApi(app);

    // Document is built from the app (the CLI plugin fills the schema at compile time).
    expect(createDocument).toHaveBeenCalledWith(app, expect.any(Object));
    // UI at /docs, raw spec at /docs-json (what the DAST job feeds ZAP).
    expect(setup).toHaveBeenCalledWith('docs', app, document, { jsonDocumentUrl: 'docs-json' });
  });
});
