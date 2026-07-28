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

function buildController(report: HealthReport): {
  controller: HealthController;
  execute: jest.Mock;
  checkReadiness: jest.Mock;
} {
  const execute = jest.fn().mockResolvedValue(report);
  const checkReadiness = jest.fn().mockResolvedValue(report);
  return {
    controller: new HealthController({
      execute,
      checkReadiness,
    } as unknown as CheckHealthUseCase),
    execute,
    checkReadiness,
  };
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

describe('HealthController — readiness and liveness (design D39, D41)', () => {
  it('readiness goes through the critical-only path, not the full report', async () => {
    // Arrange
    const { controller, execute, checkReadiness } = buildController({
      status: 'ok',
      dependencies: [{ name: 'elasticsearch', status: 'up', critical: true }],
    });
    const { res, status } = responseSpy();

    // Act
    const body = await controller.ready(res);

    // Assert
    expect(checkReadiness).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(HttpStatus.OK);
    expect(body.status).toBe('ok');
  });

  it('readiness answers 503 when a critical dependency is down, so a deploy fails', async () => {
    const { controller } = buildController({
      status: 'error',
      dependencies: [{ name: 'elasticsearch', status: 'down', critical: true }],
    });
    const { res, status } = responseSpy();

    await controller.ready(res);

    expect(status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
  });

  it('liveness answers 200 without consulting any dependency', async () => {
    // Arrange: the use case reports everything down; liveness must not care,
    // because it is what distinguishes a dead process from a degraded one.
    const { controller, execute, checkReadiness } = buildController({
      status: 'error',
      dependencies: [{ name: 'elasticsearch', status: 'down', critical: true }],
    });
    const { res, status } = responseSpy();

    // Act
    const body = controller.live(res);

    // Assert
    expect(execute).not.toHaveBeenCalled();
    expect(checkReadiness).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(HttpStatus.OK);
    expect(body.status).toBe('ok');
    expect(body.info).toEqual({});
  });

  it('applies the same no-store rule to all three endpoints', async () => {
    const { controller } = buildController({
      status: 'ok',
      dependencies: [{ name: 'elasticsearch', status: 'up', critical: true }],
    });

    const ready = responseSpy();
    const live = responseSpy();
    await controller.ready(ready.res);
    controller.live(live.res);

    expect(ready.headers['Cache-Control']).toBe('no-store');
    expect(live.headers['Cache-Control']).toBe('no-store');
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
