import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * The one error envelope every failed request gets, rendered by
 * {@link AllExceptionsFilter} (design D10). Declared once and referenced by each
 * endpoint's error responses, so the published contract shows exactly what a
 * client has to parse — the same shape for a 400, a 422, a 429 or a 503.
 */
export class ErrorResponseDto {
  @ApiProperty({ example: 400 })
  statusCode!: number;

  @ApiProperty({ description: 'HTTP reason phrase.', example: 'Bad Request' })
  error!: string;

  @ApiProperty({
    description: 'Human-readable reason; "Validation failed" when `details` is present.',
    example: 'Validation failed',
  })
  message!: string;

  @ApiPropertyOptional({
    description: 'Per-field validation messages. Present only on a validation failure.',
    type: [String],
    example: ['q must be shorter than or equal to 256 characters'],
  })
  details?: string[];

  @ApiProperty({ format: 'date-time', example: '2026-07-27T02:16:01.328Z' })
  timestamp!: string;

  @ApiProperty({ description: 'Request path, query string included.', example: '/search?q=drill' })
  path!: string;
}
