import { Module } from '@nestjs/common';
import { Client } from '@elastic/elasticsearch';
import { APP_CONFIG, type AppConfiguration } from '@config/app-config';
import { PRODUCT_INDEX_PORT } from '@application/ports/product-index.port';
import { PRODUCT_SEARCH_PORT } from '@application/ports/product-search.port';
import { AUTOCOMPLETE_PORT } from '@application/ports/autocomplete.port';
import { QUERY_SUGGESTION_PORT } from '@application/ports/query-suggestion.port';
import {
  ELASTICSEARCH_CLIENT,
  createElasticsearchClient,
} from './client/elasticsearch.client.factory';
import { ElasticsearchClientLifecycle } from './client/elasticsearch-client.lifecycle';
import { ProductIndexAdapter } from './index/product-index.adapter';
import { ElasticsearchProductSearchAdapter } from './search/product-search.adapter';
import { ElasticsearchAutocompleteAdapter } from './autocomplete/autocomplete.adapter';
import { ElasticsearchQuerySuggestionAdapter } from './suggestion/query-suggestion.adapter';

/**
 * Infrastructure module wiring the Elasticsearch client and its adapters. Ports
 * are bound to adapters here; consumers depend only on the port tokens.
 */
@Module({
  providers: [
    {
      provide: ELASTICSEARCH_CLIENT,
      useFactory: (config: AppConfiguration): Client => createElasticsearchClient(config),
      inject: [APP_CONFIG],
    },
    ElasticsearchClientLifecycle,
    { provide: PRODUCT_INDEX_PORT, useClass: ProductIndexAdapter },
    { provide: PRODUCT_SEARCH_PORT, useClass: ElasticsearchProductSearchAdapter },
    { provide: AUTOCOMPLETE_PORT, useClass: ElasticsearchAutocompleteAdapter },
    { provide: QUERY_SUGGESTION_PORT, useClass: ElasticsearchQuerySuggestionAdapter },
  ],
  exports: [
    ELASTICSEARCH_CLIENT,
    PRODUCT_INDEX_PORT,
    PRODUCT_SEARCH_PORT,
    AUTOCOMPLETE_PORT,
    QUERY_SUGGESTION_PORT,
  ],
})
export class ElasticsearchModule {}
