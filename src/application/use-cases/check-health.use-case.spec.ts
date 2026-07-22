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
});
