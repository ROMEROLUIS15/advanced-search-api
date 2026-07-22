import { Client } from '@elastic/elasticsearch';
import { ElasticsearchAutocompleteAdapter } from './autocomplete.adapter';
import { buildConfig, type AppConfiguration } from '@config/app-config';
import { validateEnv } from '@config/env.schema';

const config: AppConfiguration = buildConfig(
  validateEnv({
    ELASTICSEARCH_NODE: 'http://localhost:9200',
    REDIS_URL: 'redis://localhost:6379',
  }),
);

describe('ElasticsearchAutocompleteAdapter', () => {
  it('queries the suggest field and maps distinct completions honoring limit', async () => {
    // Arrange
    const search = jest.fn().mockResolvedValue({
      hits: {
        hits: [
          { _score: 3, _source: { name: 'Cordless Drill' } },
          { _score: 2, _source: { name: 'Hammer Drill' } },
        ],
      },
    });
    const adapter = new ElasticsearchAutocompleteAdapter({ search } as unknown as Client, config);

    // Act
    const result = await adapter.complete('dri', 5);

    // Assert
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({ index: 'products', size: 5, _source: ['name'] }),
    );
    expect(result).toEqual([
      { text: 'Cordless Drill', score: 3 },
      { text: 'Hammer Drill', score: 2 },
    ]);
  });
});
