import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Client } from '@elastic/elasticsearch';
import { ELASTICSEARCH_CLIENT } from './elasticsearch.client.factory';

/** Closes the Elasticsearch connection pool on shutdown so no sockets leak. */
@Injectable()
export class ElasticsearchClientLifecycle implements OnModuleDestroy {
  constructor(@Inject(ELASTICSEARCH_CLIENT) private readonly client: Client) {}

  async onModuleDestroy(): Promise<void> {
    await this.client.close();
  }
}
