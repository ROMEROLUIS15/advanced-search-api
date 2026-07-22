import { Module } from '@nestjs/common';
import { Client } from '@elastic/elasticsearch';
import { APP_CONFIG, type AppConfiguration } from '@config/app-config';
import { PRODUCT_INDEX_PORT } from '@application/ports/product-index.port';
import {
  ELASTICSEARCH_CLIENT,
  createElasticsearchClient,
} from './client/elasticsearch.client.factory';
import { ElasticsearchClientLifecycle } from './client/elasticsearch-client.lifecycle';
import { ProductIndexAdapter } from './index/product-index.adapter';

/**
 * Infrastructure module wiring the Elasticsearch client and the index adapter.
 * Ports are bound to adapters here; consumers depend only on the port tokens.
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
  ],
  exports: [ELASTICSEARCH_CLIENT, PRODUCT_INDEX_PORT],
})
export class ElasticsearchModule {}
