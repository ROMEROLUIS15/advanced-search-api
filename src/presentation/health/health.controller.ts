import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CheckHealthUseCase } from '@application/use-cases/check-health.use-case';
import type { HealthResponseDto } from './dto/health-response.dto';
import { toHealthResponseDto } from './health-response.mapper';

@Controller('health')
export class HealthController {
  constructor(private readonly checkHealth: CheckHealthUseCase) {}

  @Get()
  async health(@Res({ passthrough: true }) response: Response): Promise<HealthResponseDto> {
    const report = await this.checkHealth.execute();
    response.status(report.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return toHealthResponseDto(report);
  }
}
