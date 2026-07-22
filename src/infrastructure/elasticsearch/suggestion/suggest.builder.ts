import type { estypes } from '@elastic/elasticsearch';

/**
 * Suggest block (design D7): a phrase suggester over the trigram field produces a
 * corrected full-query "did you mean" (a `collate` query ensures the suggestion
 * actually returns documents), while a term suggester yields related per-token
 * alternatives. Shared by `GET /suggest` and the `/search` round-trip.
 */
export function buildSuggest(text: string): NonNullable<estypes.SearchRequest['suggest']> {
  return {
    text,
    did_you_mean: {
      phrase: {
        field: 'suggest_text.trigram',
        size: 1,
        gram_size: 3,
        max_errors: 2,
        direct_generator: [{ field: 'suggest_text.trigram', suggest_mode: 'always' }],
        collate: {
          query: { source: '{"match":{"suggest_text":"{{suggestion}}"}}' },
          prune: true,
        },
      },
    },
    related: {
      term: {
        field: 'suggest_text',
        suggest_mode: 'popular',
        size: 3,
      },
    },
  };
}
