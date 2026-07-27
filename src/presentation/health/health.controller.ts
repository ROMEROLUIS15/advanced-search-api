import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CheckHealthUseCase } from '@application/use-cases/check-health.use-case';
import { DependencyStatusDto, HealthResponseDto } from './dto/health-response.dto';
import { toHealthResponseDto } from './health-response.mapper';

@ApiTags('health')
@ApiExtraModels(DependencyStatusDto)
@Controller('health')
export class HealthController {
  constructor(private readonly checkHealth: CheckHealthUseCase) {}

  @Get()
  @ApiOperation({
    summary: 'Dependency health',
    description:
      'Elasticsearch is critical, Redis is not: a Redis outage is reported and still answers 200. ' +
      'The only endpoint exempt from rate limiting, since the platform polls it.',
  })
  @ApiOkResponse({ type: HealthResponseDto })
  @ApiResponse({
    status: 503,
    description: 'A critical dependency is down. Same body, `status: "error"`.',
    type: HealthResponseDto,
  })
  async health(@Res({ passthrough: true }) response: Response): Promise<HealthResponseDto> {
    const report = await this.checkHealth.execute();
    response.status(report.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    // A cached readiness probe is worse than useless (design D28).
    response.setHeader('Cache-Control', 'no-store');
    return toHealthResponseDto(report);
  }
}
