import type { AutocompleteUseCase } from '@application/use-cases/autocomplete.use-case';
import { AutocompleteController } from './autocomplete.controller';
import { AutocompleteQueryDto } from './dto/autocomplete-query.dto';

function buildController(execute: jest.Mock): AutocompleteController {
  return new AutocompleteController({ execute } as unknown as AutocompleteUseCase);
}

describe('AutocompleteController', () => {
  it('passes the query and explicit limit through and wraps the items in data', async () => {
    // Arrange
    const items = [{ text: 'Cordless Drill 18V', score: 8.1 }];
    const execute = jest.fn().mockResolvedValue(items);
    const controller = buildController(execute);
    const query = Object.assign(new AutocompleteQueryDto(), { q: 'cor', limit: 5 });

    // Act
    const result = await controller.complete(query);

    // Assert
    expect(execute).toHaveBeenCalledWith('cor', 5);
    expect(result).toEqual({ data: items });
  });

  it('applies the default limit of 10 when none is given', async () => {
    // Arrange
    const execute = jest.fn().mockResolvedValue([]);
    const controller = buildController(execute);
    const query = Object.assign(new AutocompleteQueryDto(), { q: 'dri' });

    // Act
    await controller.complete(query);

    // Assert
    expect(execute).toHaveBeenCalledWith('dri', 10);
  });
});
