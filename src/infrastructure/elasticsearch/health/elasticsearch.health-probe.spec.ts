import { Client } from '@elastic/elasticsearch';
import { ElasticsearchHealthProbe } from './elasticsearch.health-probe';

describe('ElasticsearchHealthProbe', () => {
  it('reports up when ping succeeds', async () => {
    const probe = new ElasticsearchHealthProbe({
      ping: jest.fn().mockResolvedValue(true),
    } as unknown as Client);

    await expect(probe.ping()).resolves.toEqual({
      name: 'elasticsearch',
      status: 'up',
      critical: true,
    });
  });

  it('reports down (critical) when ping throws', async () => {
    const probe = new ElasticsearchHealthProbe({
      ping: jest.fn().mockRejectedValue(new Error('no cluster')),
    } as unknown as Client);

    await expect(probe.ping()).resolves.toMatchObject({
      name: 'elasticsearch',
      status: 'down',
      critical: true,
      detail: 'no cluster',
    });
  });
});
