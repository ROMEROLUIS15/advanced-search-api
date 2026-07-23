import { Controller, Get } from '@nestjs/common';
import type { ServiceIndexResponseDto } from './dto/service-index-response.dto';

/**
 * Declared here rather than imported from `package.json`: that file sits outside
 * `rootDir`, so importing it would nest the compiled output under `dist/src/`.
 * Kept honest by a unit test that compares it against `package.json`.
 */
const SERVICE_VERSION = '0.1.0';

const SERVICE_INDEX: ServiceIndexResponseDto = {
  name: 'Advanced Product Search API',
  version: SERVICE_VERSION,
  endpoints: {
    'GET /search': 'Relevance-ranked search with filters, facets and low-recall suggestions',
    'GET /autocomplete': 'Type-ahead product-name completions',
    'GET /suggest': 'Did-you-mean correction and related queries',
    'GET /health': 'Dependency health (Elasticsearch critical, Redis non-critical)',
  },
  docs: 'https://github.com/ROMEROLUIS15/advanced-search-api',
};

/**
 * Landing route. Without it the base URL answers a bare 404, which reads as a
 * broken deployment; this tells a caller what the service is and where to go next.
 */
@Controller()
export class ServiceIndexController {
  @Get()
  index(): ServiceIndexResponseDto {
    return SERVICE_INDEX;
  }
}
