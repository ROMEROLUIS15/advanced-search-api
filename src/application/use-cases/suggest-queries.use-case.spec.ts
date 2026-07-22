import { SuggestQueriesUseCase } from './suggest-queries.use-case';
import type { QuerySuggestionPort } from '../ports/query-suggestion.port';
import type { SearchSuggestions } from '../models/query-suggestion';

describe('SuggestQueriesUseCase', () => {
  it('delegates to the suggestion port', async () => {
    const suggestions: SearchSuggestions = { didYouMean: 'drill', related: ['drills'] };
    const port: QuerySuggestionPort = { suggest: jest.fn().mockResolvedValue(suggestions) };

    const result = await new SuggestQueriesUseCase(port).execute('driil');

    expect(port.suggest).toHaveBeenCalledWith('driil');
    expect(result).toBe(suggestions);
  });
});
