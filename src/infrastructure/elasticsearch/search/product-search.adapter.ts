import { Inject, Injectable } from '@nestjs/common';
import { Client, type estypes } from '@elastic/elasticsearch';
import { APP_CONFIG, type AppConfiguration, type RelevanceConfig } from '@config/app-config';
import type { SearchCriteria } from '@application/models/search-criteria';
import type { SearchOutcome } from '@application/models/search-outcome';
import type { ProductSearchPort } from '@application/ports/product-search.port';
import { ResultWindowExceededError } from '@application/errors/application.error';
import { ELASTICSEARCH_CLIENT } from '../client/elasticsearch.client.factory';
import type { ProductDocument } from '../index/product-document';
import { buildSearchRequest } from './query/search-query.builder';
import { toProductSummary } from './search-hit.mapper';
import { toFacets } from './facet-response.mapper';

/**
 * Elasticsearch search adapter. Builds one request (hits via the query +
 * post_filter), maps hits to the read model, and guards deep pagination. Facets
 * and suggestions are filled by later groups; here they are returned empty.
 */
@Injectable()
export class ElasticsearchProductSearchAdapter implements ProductSearchPort {
  private readonly index: string;
  private readonly relevance: RelevanceConfig;
  private readonly maxResultWindow: number;

  constructor(
    @Inject(ELASTICSEARCH_CLIENT) private readonly client: Client,
    @Inject(APP_CONFIG) config: AppConfiguration,
  ) {
    this.index = config.elasticsearch.index;
    this.relevance = config.relevance;
    this.maxResultWindow = config.search.maxResultWindow;
  }

  async search(criteria: SearchCriteria): Promise<SearchOutcome> {
    const { from, size } = this.resolveWindow(criteria.page, criteria.pageSize);
    const request = buildSearchRequest({ criteria, relevance: this.relevance, from, size });
    const response = await this.client.search<ProductDocument>({ index: this.index, ...request });

    return {
      items: response.hits.hits.map(toProductSummary),
      total: totalHits(response.hits.total),
      facets: toFacets(response.aggregations),
      suggestions: { didYouMean: null, related: [] },
    };
  }

  private resolveWindow(page: number, pageSize: number): { from: number; size: number } {
    const from = (page - 1) * pageSize;
    if (from + pageSize > this.maxResultWindow) {
      throw new ResultWindowExceededError(
        this.maxResultWindow,
        `Requested result window ${from + pageSize} exceeds max_result_window ${this.maxResultWindow}`,
      );
    }
    return { from, size: pageSize };
  }
}

function totalHits(total: estypes.SearchTotalHits | number | undefined): number {
  if (typeof total === 'number') {
    return total;
  }
  return total?.value ?? 0;
}
