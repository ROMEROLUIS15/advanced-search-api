import type { SuggestQueriesUseCase } from '@application/use-cases/suggest-queries.use-case';
import { SuggestionController } from './suggestion.controller';
import { SuggestQueryDto } from './dto/suggest-query.dto';

describe('SuggestionController', () => {
  it('delegates to the use-case and wraps the suggestions in data', async () => {
    // Arrange
    const suggestions = { didYouMean: 'drill', related: ['drill'] };
    const execute = jest.fn().mockResolvedValue(suggestions);
    const controller = new SuggestionController({
      execute,
    } as unknown as SuggestQueriesUseCase);
    const query = Object.assign(new SuggestQueryDto(), { q: 'driil' });

    // Act
    const result = await controller.suggest(query);

    // Assert
    expect(execute).toHaveBeenCalledWith('driil');
    expect(result).toEqual({ data: suggestions });
  });
});
