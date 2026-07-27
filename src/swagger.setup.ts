import { type INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import type { AppConfiguration } from '@config/app-config';
import {
  API_KEY_HEADER,
  type KeyIdentifier,
  createKeyIdentifier,
} from '@presentation/auth/api-key.identity';

/** Paths SwaggerModule mounts. Listed here because they must be protected before it does. */
const DOCS_PATHS = ['/docs', '/docs-json'];

/**
 * Publishes the OpenAPI contract: Swagger UI at /docs, the raw JSON at
 * /docs-json. Wired from main.ts only — this is API documentation, not part of
 * the security edge the e2e suites exercise through configureApp. The JSON is
 * what the DAST job hands to ZAP's api-scan so the scan reaches /search & co.
 * with their query parameters, which the passive baseline spider cannot
 * discover on a JSON API (it follows HTML links, of which there are none). The
 * @nestjs/swagger CLI plugin (nest-cli.json) derives the parameter schema from
 * the class-validator DTOs, so there is no per-field decoration here.
 *
 * The docs are protected by the same API key as the data (design D32), and the
 * check is a **middleware** rather than the global guard: SwaggerModule mounts
 * these paths straight onto Express, so no Nest guard ever runs for them. That
 * is easy to miss and would leave the whole contract public while the data
 * behind it was locked.
 */
export function setupOpenApi(app: INestApplication, config: AppConfiguration): void {
  if (config.apiAuth.enabled) {
    app.use(DOCS_PATHS, docsKeyMiddleware(createKeyIdentifier(config.apiAuth.keys)));
  }

  const builder = new DocumentBuilder()
    .setTitle('Advanced Product Search API')
    .setDescription(
      'Relevance search, faceting, autocomplete and query suggestions over Elasticsearch.',
    )
    // Matches package.json and the version GET / reports; three places, one number.
    .setVersion('0.1.0')
    .addApiKey({ type: 'apiKey', name: 'X-API-Key', in: 'header' }, 'api-key')
    .addTag('search', 'Relevance ranking, filtering and facet counts')
    .addTag('autocomplete', 'Type-ahead completions over product names')
    .addTag('suggest', 'Did-you-mean correction and related queries')
    .addTag('health', 'Dependency health for the platform probe')
    .addTag('service', 'Service index');

  const document = SwaggerModule.createDocument(app, builder.build());
  SwaggerModule.setup('docs', app, document, { jsonDocumentUrl: 'docs-json' });
}

/**
 * The error body is written by hand here, the one place that happens outside
 * `AllExceptionsFilter`: these routes are not Nest routes, so nothing thrown
 * from here would reach the filter. The shape is kept identical on purpose.
 */
function docsKeyMiddleware(identify: KeyIdentifier) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const header = request.headers[API_KEY_HEADER];
    const presented = Array.isArray(header) ? header[0] : header;
    if (identify(presented) === undefined) {
      response.status(401).json({
        statusCode: 401,
        error: 'Unauthorized',
        message: `A valid ${API_KEY_HEADER} header is required`,
        timestamp: new Date().toISOString(),
        path: request.originalUrl,
      });
      return;
    }
    next();
  };
}
