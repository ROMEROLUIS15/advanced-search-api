import { ApiProperty, ApiPropertyOptional, getSchemaPath } from '@nestjs/swagger';

/** Per-dependency verdict. `detail` carries the reason only when it is down. */
export class DependencyStatusDto {
  @ApiProperty({ enum: ['up', 'down'], example: 'up' })
  status!: 'up' | 'down';

  @ApiPropertyOptional({ example: 'connect ECONNREFUSED 127.0.0.1:6379' })
  detail?: string;
}

/**
 * Response body for `GET /health` (design D11). `status` is `error` — and the
 * response a 503 — only when a *critical* dependency is down: Elasticsearch is
 * critical, Redis is reported but never fails the check.
 */
export class HealthResponseDto {
  @ApiProperty({ enum: ['ok', 'error'], example: 'ok' })
  status!: 'ok' | 'error';

  @ApiProperty({
    description: 'Keyed by dependency name, e.g. `elasticsearch`, `redis`.',
    type: 'object',
    additionalProperties: { $ref: getSchemaPath(DependencyStatusDto) },
    example: { elasticsearch: { status: 'up' }, redis: { status: 'up' } },
  })
  info!: Record<string, DependencyStatusDto>;
}
