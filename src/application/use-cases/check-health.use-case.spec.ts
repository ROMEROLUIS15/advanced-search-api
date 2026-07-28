import { Logger } from '@nestjs/common';
import { CheckHealthUseCase } from './check-health.use-case';
import type { DependencyHealth, HealthProbePort } from '../ports/health-probe.port';

function probe(name: string, critical: boolean, result: DependencyHealth | Error): HealthProbePort {
  return {
    name,
    critical,
    ping: jest
      .fn()
      .mockImplementation(() =>
        result instanceof Error ? Promise.reject(result) : Promise.resolve(result),
      ),
  };
}

const up = (name: string, critical: boolean): DependencyHealth => ({
  name,
  status: 'up',
  critical,
});
const down = (name: string, critical: boolean): DependencyHealth => ({
  name,
  status: 'down',
  critical,
});

describe('CheckHealthUseCase', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reports ok when all critical dependencies are up', async () => {
    const useCase = new CheckHealthUseCase([
      probe('elasticsearch', true, up('elasticsearch', true)),
      probe('redis', false, up('redis', false)),
    ]);

    const report = await useCase.execute();

    expect(report.status).toBe('ok');
    expect(report.dependencies).toHaveLength(2);
  });

  it('reports error when a critical dependency is down', async () => {
    const useCase = new CheckHealthUseCase([
      probe('elasticsearch', true, down('elasticsearch', true)),
      probe('redis', false, up('redis', false)),
    ]);

    expect((await useCase.execute()).status).toBe('error');
  });

  it('stays ok when only a non-critical dependency is down', async () => {
    const useCase = new CheckHealthUseCase([
      probe('elasticsearch', true, up('elasticsearch', true)),
      probe('redis', false, down('redis', false)),
    ]);

    const report = await useCase.execute();

    expect(report.status).toBe('ok');
    expect(report.dependencies.find((dep) => dep.name === 'redis')?.status).toBe('down');
  });

  it('treats a rejected probe as down', async () => {
    const useCase = new CheckHealthUseCase([probe('elasticsearch', true, new Error('boom'))]);

    const report = await useCase.execute();

    expect(report.status).toBe('error');
    expect(report.dependencies[0]).toMatchObject({
      name: 'elasticsearch',
      status: 'down',
      detail: 'boom',
    });
  });

  it('leaves non-critical probes untouched on the readiness path (design D39)', async () => {
    // Arrange: this is the whole point of the split — the platform polls
    // readiness every few seconds, so a probe whose result cannot change the
    // verdict must not cost a command at all.
    const elasticsearch = probe('elasticsearch', true, up('elasticsearch', true));
    const redis = probe('redis', false, up('redis', false));
    const useCase = new CheckHealthUseCase([elasticsearch, redis]);

    // Act
    const report = await useCase.checkReadiness();

    // Assert
    expect(redis.ping).not.toHaveBeenCalled();
    expect(elasticsearch.ping).toHaveBeenCalledTimes(1);
    expect(report.dependencies.map((dep) => dep.name)).toEqual(['elasticsearch']);
    expect(report.status).toBe('ok');
  });

  it('is ready while a non-critical dependency is down, without asking it', async () => {
    const redis = probe('redis', false, down('redis', false));
    const useCase = new CheckHealthUseCase([
      probe('elasticsearch', true, up('elasticsearch', true)),
      redis,
    ]);

    expect((await useCase.checkReadiness()).status).toBe('ok');
    expect(redis.ping).not.toHaveBeenCalled();
  });

  it('is not ready when the critical dependency is down', async () => {
    const useCase = new CheckHealthUseCase([
      probe('elasticsearch', true, down('elasticsearch', true)),
      probe('redis', false, up('redis', false)),
    ]);

    expect((await useCase.checkReadiness()).status).toBe('error');
  });

  it('picks up a second critical dependency without naming it', async () => {
    // Selection is by the `critical` flag, so a new critical probe reaches
    // readiness the day it is registered.
    const other = probe('other-critical', true, down('other-critical', true));
    const useCase = new CheckHealthUseCase([
      probe('elasticsearch', true, up('elasticsearch', true)),
      other,
      probe('redis', false, up('redis', false)),
    ]);

    const report = await useCase.checkReadiness();

    expect(other.ping).toHaveBeenCalledTimes(1);
    expect(report.status).toBe('error');
  });

  it('still calls every probe on the full report', async () => {
    const redis = probe('redis', false, up('redis', false));
    const useCase = new CheckHealthUseCase([
      probe('elasticsearch', true, up('elasticsearch', true)),
      redis,
    ]);

    await useCase.execute();

    expect(redis.ping).toHaveBeenCalledTimes(1);
  });

  it('logs a failure once and logs its recovery once', async () => {
    const elasticsearch: HealthProbePort = {
      name: 'elasticsearch',
      critical: true,
      ping: jest
        .fn()
        .mockResolvedValueOnce({
          ...down('elasticsearch', true),
          detail: 'connection refused',
        })
        .mockResolvedValueOnce({
          ...down('elasticsearch', true),
          detail: 'connection refused',
        })
        .mockResolvedValueOnce(up('elasticsearch', true)),
    };
    const useCase = new CheckHealthUseCase([elasticsearch]);

    await useCase.execute();
    await useCase.execute();
    await useCase.execute();

    expect(Logger.prototype.warn).toHaveBeenCalledTimes(1);
    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      'Dependency elasticsearch is down: connection refused',
    );
    expect(Logger.prototype.log).toHaveBeenCalledTimes(1);
    expect(Logger.prototype.log).toHaveBeenCalledWith('Dependency elasticsearch recovered');
  });
});
