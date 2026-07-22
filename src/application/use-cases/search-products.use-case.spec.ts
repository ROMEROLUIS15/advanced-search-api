import { SearchProductsUseCase } from './search-products.use-case';
import type { ProductSearchPort } from '../ports/product-search.port';
import type { SearchOutcome } from '../models/search-outcome';
import type { SearchCriteria } from '../models/search-criteria';

describe('SearchProductsUseCase', () => {
  it('delegates to the search port', async () => {
    // Arrange
    const outcome: SearchOutcome = {
      items: [],
      total: 0,
      facets: { categories: [], subcategories: [], locations: [], priceRanges: [] },
      suggestions: { didYouMean: null, related: [] },
    };
    const port: ProductSearchPort = { search: jest.fn().mockResolvedValue(outcome) };
    const useCase = new SearchProductsUseCase(port);
    const criteria: SearchCriteria = {
      filters: {},
      sort: 'relevance',
      order: 'desc',
      page: 1,
      pageSize: 20,
    };

    // Act
    const result = await useCase.execute(criteria);

    // Assert
    expect(port.search).toHaveBeenCalledWith(criteria);
    expect(result).toBe(outcome);
  });
});
