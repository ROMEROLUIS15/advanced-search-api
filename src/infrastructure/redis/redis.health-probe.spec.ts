import { Redis } from 'ioredis';
import { RedisHealthProbe } from './redis.health-probe';

describe('RedisHealthProbe', () => {
  it('reports up when PING returns PONG', async () => {
    const probe = new RedisHealthProbe({
      ping: jest.fn().mockResolvedValue('PONG'),
    } as unknown as Redis);

    await expect(probe.ping()).resolves.toEqual({ name: 'redis', status: 'up', critical: false });
  });

  it('reports down (non-critical) when ping throws', async () => {
    const probe = new RedisHealthProbe({
      ping: jest.fn().mockRejectedValue(new Error('connection refused')),
    } as unknown as Redis);

    await expect(probe.ping()).resolves.toMatchObject({
      name: 'redis',
      status: 'down',
      critical: false,
    });
  });
});
