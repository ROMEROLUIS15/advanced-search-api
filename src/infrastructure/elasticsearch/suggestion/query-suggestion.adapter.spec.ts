import { Client } from '@elastic/elasticsearch';
import { ElasticsearchQuerySuggestionAdapter } from './query-suggestion.adapter';
import { buildConfig, type AppConfiguration } from '@config/app-config';
import { validateEnv } from '@config/env.schema';

const config: AppConfiguration = buildConfig(
  validateEnv({
    ELASTICSEARCH_NODE: 'http://localhost:9200',
    REDIS_URL: 'redis://localhost:6379',
  }),
);

describe('ElasticsearchQuerySuggestionAdapter', () => {
  it('issues a size:0 suggest request and maps the response', async () => {
    // Arrange
    const search = jest.fn().mockResolvedValue({
      suggest: {
        did_you_mean: [{ options: [{ text: 'drill' }] }],
        related: [{ options: [{ text: 'drill' }] }],
      },
    });
    const adapter = new ElasticsearchQuerySuggestionAdapter(
      { search } as unknown as Client,
      config,
    );

    // Act
    const result = await adapter.suggest('driil');

    // Assert
    expect(search).toHaveBeenCalledWith(expect.objectContaining({ index: 'products', size: 0 }));
    expect(result).toEqual({ didYouMean: 'drill', related: ['drill'] });
  });
});
