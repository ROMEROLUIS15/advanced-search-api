import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { HealthReport } from '@application/models/health-report';
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
    return this.render(response, report);
  }

  @Get('ready')
  @ApiOperation({
    summary: 'Readiness for continuous polling',
    description:
      'What the platform polls, several times a minute. Evaluates the critical dependencies only — ' +
      'today Elasticsearch and the existence of the configured index — because a non-critical outage ' +
      'never changes this answer, so probing one would spend a call per poll to compute a discarded ' +
      'value. Read `GET /health` for the full picture, Redis included.',
  })
  @ApiOkResponse({ type: HealthResponseDto })
  @ApiResponse({
    status: 503,
    description: 'A critical dependency is down. Same body, `status: "error"`.',
    type: HealthResponseDto,
  })
  async ready(@Res({ passthrough: true }) response: Response): Promise<HealthResponseDto> {
    const report = await this.checkHealth.checkReadiness();
    return this.render(response, report);
  }

  @Get('live')
  @ApiOperation({
    summary: 'Liveness',
    description:
      'Answers 200 whenever the process is running, calling no dependency at all. It is what ' +
      'separates a dead process from a running one whose dependencies are degraded.',
  })
  @ApiOkResponse({ type: HealthResponseDto })
  live(@Res({ passthrough: true }) response: Response): HealthResponseDto {
    return this.render(response, { status: 'ok', dependencies: [] });
  }

  /** One status rule and one cache rule for all three endpoints. */
  private render(response: Response, report: HealthReport): HealthResponseDto {
    response.status(report.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    // A cached readiness probe is worse than useless (design D28).
    response.setHeader('Cache-Control', 'no-store');
    return toHealthResponseDto(report);
  }
}
