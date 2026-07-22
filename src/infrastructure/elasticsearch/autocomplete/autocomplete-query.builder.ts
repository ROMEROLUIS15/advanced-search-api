import type { estypes } from '@elastic/elasticsearch';

/**
 * Type-ahead query (design D6): a `bool_prefix` multi_match over the
 * `search_as_you_type` field and its shingle sub-fields, so it matches mid-phrase
 * as the user types.
 */
export function buildAutocompleteQuery(prefix: string): estypes.QueryDslQueryContainer {
  return {
    multi_match: {
      query: prefix,
      type: 'bool_prefix',
      fields: ['name.suggest', 'name.suggest._2gram', 'name.suggest._3gram'],
    },
  };
}
