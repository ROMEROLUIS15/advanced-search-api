import type { HealthReport } from '@application/models/health-report';
import type { DependencyStatusDto, HealthResponseDto } from './dto/health-response.dto';

/** Maps the aggregate report into the `{ status, info }` response body. */
export function toHealthResponseDto(report: HealthReport): HealthResponseDto {
  const info: Record<string, DependencyStatusDto> = {};
  for (const dependency of report.dependencies) {
    info[dependency.name] = {
      status: dependency.status,
      ...(dependency.detail ? { detail: dependency.detail } : {}),
    };
  }
  return { status: report.status, info };
}
