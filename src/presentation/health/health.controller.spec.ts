import { HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import type { CheckHealthUseCase } from '@application/use-cases/check-health.use-case';
import type { HealthReport } from '@application/models/health-report';
import { HealthController } from './health.controller';

function responseSpy(): { res: Response; status: jest.Mock } {
  const status = jest.fn();
  return { res: { status } as unknown as Response, status };
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
