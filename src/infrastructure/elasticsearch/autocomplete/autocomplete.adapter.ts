import { Inject, Injectable } from '@nestjs/common';
import { Client } from '@elastic/elasticsearch';
import { APP_CONFIG, type AppConfiguration } from '@config/app-config';
import type { AutocompleteItem } from '@application/models/autocomplete-item';
import type { AutocompletePort } from '@application/ports/autocomplete.port';
import { ELASTICSEARCH_CLIENT } from '../client/elasticsearch.client.factory';
import type { ProductDocument } from '../index/product-document';
import { buildAutocompleteQuery } from './autocomplete-query.builder';
import { toAutocompleteItems } from './autocomplete-hit.mapper';

/** Elasticsearch autocomplete adapter over the `name.suggest` search_as_you_type field. */
@Injectable()
export class ElasticsearchAutocompleteAdapter implements AutocompletePort {
  private readonly index: string;

  constructor(
    @Inject(ELASTICSEARCH_CLIENT) private readonly client: Client,
    @Inject(APP_CONFIG) config: AppConfiguration,
  ) {
    this.index = config.elasticsearch.index;
  }

  async complete(prefix: string, limit: number): Promise<AutocompleteItem[]> {
    const response = await this.client.search<Pick<ProductDocument, 'name'>>({
      index: this.index,
      size: limit,
      _source: ['name'],
      query: buildAutocompleteQuery(prefix),
    });
    return toAutocompleteItems(response.hits.hits);
  }
}
