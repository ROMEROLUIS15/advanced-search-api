import type { SearchSuggestions } from '../models/query-suggestion';

export const QUERY_SUGGESTION_PORT = Symbol('QUERY_SUGGESTION_PORT');

export interface QuerySuggestionPort {
  /** Returns the "did you mean" phrase plus related query alternatives. */
  suggest(text: string): Promise<SearchSuggestions>;
}
