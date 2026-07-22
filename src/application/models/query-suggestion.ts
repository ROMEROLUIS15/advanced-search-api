/** A single suggester candidate (phrase or per-token alternative). */
export interface QuerySuggestion {
  text: string;
  score?: number;
}

/**
 * Suggestion block surfaced by `/suggest` and, on low recall, inside `/search`
 * (design D7). `didYouMean` is the best corrected phrase; `related` are
 * alternative queries.
 */
export interface SearchSuggestions {
  didYouMean: string | null;
  related: string[];
}
