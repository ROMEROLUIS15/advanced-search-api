import { Client } from '@elastic/elasticsearch';
import type { AppConfiguration } from '@config/app-config';
import { ElasticsearchHealthProbe } from './elasticsearch.health-probe';

describe('ElasticsearchHealthProbe', () => {
  const config = {
    elasticsearch: { index: 'products' },
  } as AppConfiguration;

  it('reports up when the configured search index exists', async () => {
    const exists = jest.fn().mockResolvedValue(true);
    const probe = new ElasticsearchHealthProbe(
      {
        indices: { exists },
      } as unknown as Client,
      config,
    );

    await expect(probe.ping()).resolves.toEqual({
      name: 'elasticsearch',
      status: 'up',
      critical: true,
    });
    expect(exists).toHaveBeenCalledWith({ index: 'products' });
  });

  it('reports down (critical) when the configured search index is missing', async () => {
    const probe = new ElasticsearchHealthProbe(
      {
        indices: { exists: jest.fn().mockResolvedValue(false) },
      } as unknown as Client,
      config,
    );

    await expect(probe.ping()).resolves.toEqual({
      name: 'elasticsearch',
      status: 'down',
      critical: true,
      detail: 'Configured search index is missing',
    });
  });

  it('reports down (critical) when Elasticsearch rejects the check', async () => {
    const probe = new ElasticsearchHealthProbe(
      {
        indices: { exists: jest.fn().mockRejectedValue(new Error('no cluster')) },
      } as unknown as Client,
      config,
    );

    await expect(probe.ping()).resolves.toMatchObject({
      name: 'elasticsearch',
      status: 'down',
      critical: true,
      detail: 'no cluster',
    });
  });
});
