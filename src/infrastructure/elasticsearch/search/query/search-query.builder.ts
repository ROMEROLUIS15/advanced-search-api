import type { estypes } from '@elastic/elasticsearch';
import type { RelevanceConfig } from '@config/app-config';
import type { SearchCriteria } from '@application/models/search-criteria';
import { buildTextQuery } from './text-query.builder';
import { buildFilterClauses } from './filter.builder';
import { buildFacetAggregations } from './facet-aggregations.builder';
import { buildSort } from './sort.builder';
import { buildSuggest } from '../../suggestion/suggest.builder';

export interface SearchRequestParams {
  criteria: SearchCriteria;
  relevance: RelevanceConfig;
  from: number;
  size: number;
}

/**
 * Assembles the Elasticsearch request body. Facet filters go in `post_filter` so
 * they constrain the hits while leaving the aggregation universe at the text
 * query (design D4); aggregations are added in group 7.
 */
export function buildSearchRequest(params: SearchRequestParams): estypes.SearchRequest {
  const { criteria, relevance, from, size } = params;
  const filters = buildFilterClauses(criteria.filters);

  return {
    from,
    size,
    track_total_hits: true,
    query: buildTextQuery(criteria.query, relevance),
    ...(filters.length > 0 ? { post_filter: { bool: { filter: filters } } } : {}),
    aggregations: buildFacetAggregations(criteria.filters),
    ...(criteria.query ? { suggest: buildSuggest(criteria.query) } : {}),
    sort: buildSort(criteria.sort, criteria.order),
  };
}
