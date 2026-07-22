import { Inject, Injectable } from '@nestjs/common';
import { Client } from '@elastic/elasticsearch';
import { APP_CONFIG, type AppConfiguration } from '@config/app-config';
import type { SearchSuggestions } from '@application/models/query-suggestion';
import type { QuerySuggestionPort } from '@application/ports/query-suggestion.port';
import { ELASTICSEARCH_CLIENT } from '../client/elasticsearch.client.factory';
import { buildSuggest } from './suggest.builder';
import { toSuggestions } from './suggest-response.mapper';

/** Dedicated `GET /suggest` adapter — a `size: 0` request returning only suggestions. */
@Injectable()
export class ElasticsearchQuerySuggestionAdapter implements QuerySuggestionPort {
  private readonly index: string;

  constructor(
    @Inject(ELASTICSEARCH_CLIENT) private readonly client: Client,
    @Inject(APP_CONFIG) config: AppConfiguration,
  ) {
    this.index = config.elasticsearch.index;
  }

  async suggest(text: string): Promise<SearchSuggestions> {
    const response = await this.client.search({
      index: this.index,
      size: 0,
      suggest: buildSuggest(text),
    });
    return toSuggestions(response.suggest);
  }
}
