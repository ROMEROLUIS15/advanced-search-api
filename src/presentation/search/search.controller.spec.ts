import { BadRequestException } from '@nestjs/common';
import type { AppConfiguration } from '@config/app-config';
import type { SearchProductsUseCase } from '@application/use-cases/search-products.use-case';
import type { SearchOutcome } from '@application/models/search-outcome';
import { SearchController } from './search.controller';
import { SearchQueryDto } from './dto/search-query.dto';

const config = { search: { maxPageSize: 100, defaultPageSize: 20 } } as AppConfiguration;

function emptyOutcome(): SearchOutcome {
  return {
    items: [],
    total: 0,
    facets: { categories: [], subcategories: [], locations: [], priceRanges: [] },
    suggestions: { didYouMean: null, related: [] },
  };
}

function buildController(execute: jest.Mock): SearchController {
  const useCase = { execute } as unknown as SearchProductsUseCase;
  return new SearchController(useCase, config);
}

describe('SearchController', () => {
  it('delegates to the use-case and returns a response DTO for a valid query', async () => {
    // Arrange
    const execute = jest.fn().mockResolvedValue(emptyOutcome());
    const controller = buildController(execute);
    const query = Object.assign(new SearchQueryDto(), { q: 'drill', pageSize: 20 });

    // Act
    const result = await controller.search(query);

    // Assert
    expect(execute).toHaveBeenCalledTimes(1);
    expect(result).toHaveProperty('data');
    expect(result).toHaveProperty('meta');
    expect(result).toHaveProperty('facets');
  });

  it('rejects a pageSize above the configured maximum with a 400, before touching the use-case', async () => {
    // Arrange
    const execute = jest.fn();
    const controller = buildController(execute);
    const query = Object.assign(new SearchQueryDto(), { q: 'drill', pageSize: 500 });

    // Act & Assert
    await expect(controller.search(query)).rejects.toBeInstanceOf(BadRequestException);
    expect(execute).not.toHaveBeenCalled();
  });

  it('allows a pageSize exactly at the maximum', async () => {
    // Arrange
    const execute = jest.fn().mockResolvedValue(emptyOutcome());
    const controller = buildController(execute);
    const query = Object.assign(new SearchQueryDto(), { pageSize: 100 });

    // Act
    await controller.search(query);

    // Assert
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
