import type { SearchSuggestions } from '@application/models/query-suggestion';

export interface SuggestResponseDto {
  data: SearchSuggestions;
}
