import { HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import type { CheckHealthUseCase } from '@application/use-cases/check-health.use-case';
import type { HealthReport } from '@application/models/health-report';
import { HealthController } from './health.controller';

function responseSpy(): { res: Response; status: jest.Mock; headers: Record<string, string> } {
  const status = jest.fn();
  const headers: Record<string, string> = {};
  const setHeader = (name: string, value: string): void => {
    headers[name] = value;
  };
  return { res: { status, setHeader } as unknown as Response, status, headers };
}

function buildController(report: HealthReport): { controller: HealthController } {
  const execute = jest.fn().mockResolvedValue(report);
  return { controller: new HealthController({ execute } as unknown as CheckHealthUseCase) };
}

describe('HealthController', () => {
  it('returns 200 when the report is ok', async () => {
    // Arrange
    const { controller } = buildController({
      status: 'ok',
      dependencies: [{ name: 'elasticsearch', status: 'up', critical: true }],
    });
    const { res, status } = responseSpy();

    // Act
    const body = await controller.health(res);

    // Assert
    expect(status).toHaveBeenCalledWith(HttpStatus.OK);
    expect(body.status).toBe('ok');
  });

  it('returns 503 when a critical dependency is down', async () => {
    // Arrange
    const { controller } = buildController({
      status: 'error',
      dependencies: [{ name: 'elasticsearch', status: 'down', critical: true }],
    });
    const { res, status } = responseSpy();

    // Act
    await controller.health(res);

    // Assert
    expect(status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
  });
});

describe('HealthController — cache policy (design D28)', () => {
  it('refuses to be cached: a stale readiness probe is worse than none', async () => {
    // Arrange
    const { controller } = buildController({
      status: 'ok',
      dependencies: [{ name: 'elasticsearch', status: 'up', critical: true }],
    });
    const { res, headers } = responseSpy();

    // Act
    await controller.health(res);

    // Assert
    expect(headers['Cache-Control']).toBe('no-store');
  });
});
