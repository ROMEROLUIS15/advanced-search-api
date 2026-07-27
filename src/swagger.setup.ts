import { type INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/**
 * Publishes the OpenAPI contract: Swagger UI at /docs, the raw JSON at
 * /docs-json. Wired from main.ts only — this is API documentation, not part of
 * the security edge the e2e suites exercise through configureApp. The JSON is
 * what the DAST job hands to ZAP's api-scan so the scan reaches /search & co.
 * with their query parameters, which the passive baseline spider cannot
 * discover on a JSON API (it follows HTML links, of which there are none). The
 * @nestjs/swagger CLI plugin (nest-cli.json) derives the parameter schema from
 * the class-validator DTOs, so there is no per-field decoration here.
 */
export function setupOpenApi(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Advanced Product Search API')
    .setDescription(
      'Relevance search, faceting, autocomplete and query suggestions over Elasticsearch.',
    )
    // Matches package.json and the version GET / reports; three places, one number.
    .setVersion('0.1.0')
    .addTag('search', 'Relevance ranking, filtering and facet counts')
    .addTag('autocomplete', 'Type-ahead completions over product names')
    .addTag('suggest', 'Did-you-mean correction and related queries')
    .addTag('health', 'Dependency health for the platform probe')
    .addTag('service', 'Service index')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, { jsonDocumentUrl: 'docs-json' });
}
