import { Inject, Injectable } from '@nestjs/common';
import type { SearchSuggestions } from '../models/query-suggestion';
import { QUERY_SUGGESTION_PORT, type QuerySuggestionPort } from '../ports/query-suggestion.port';

/** Returns "did you mean" + related query suggestions for the dedicated endpoint. */
@Injectable()
export class SuggestQueriesUseCase {
  constructor(@Inject(QUERY_SUGGESTION_PORT) private readonly suggestions: QuerySuggestionPort) {}

  execute(text: string): Promise<SearchSuggestions> {
    return this.suggestions.suggest(text);
  }
}
