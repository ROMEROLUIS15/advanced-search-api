import type { estypes } from '@elastic/elasticsearch';
import type { RelevanceConfig } from '@config/app-config';

/** Field boosts for the text query (design D3). */
const FIELD_BOOSTS = [
  'name^4',
  'name.std^2',
  'category.text^2',
  'subcategories.text^1.5',
  'location.text^1',
  'description^1',
];

const RECENCY_OFFSET = '7d';

/**
 * Text relevance (design D3): `multi_match` (BM25) wrapped in `function_score`
 * that multiplies in popularity (`field_value_factor`) and recency (`gauss`).
 * An empty query falls back to `match_all` (browse mode).
 */
export function buildTextQuery(
  query: string | undefined,
  relevance: RelevanceConfig,
): estypes.QueryDslQueryContainer {
  const inner: estypes.QueryDslQueryContainer = query
    ? {
        multi_match: {
          query,
          type: 'best_fields',
          fields: FIELD_BOOSTS,
          fuzziness: 'AUTO',
          operator: 'or',
          minimum_should_match: '60%',
        },
      }
    : { match_all: {} };

  return {
    function_score: {
      query: inner,
      functions: [
        {
          field_value_factor: {
            field: 'popularity',
            modifier: 'ln1p',
            factor: relevance.popularityFactor,
          },
        },
        {
          gauss: {
            createdAt: {
              origin: 'now',
              scale: relevance.recencyScale,
              offset: RECENCY_OFFSET,
              decay: relevance.recencyDecay,
            },
          },
        },
      ],
      score_mode: 'sum',
      boost_mode: 'multiply',
    },
  };
}
