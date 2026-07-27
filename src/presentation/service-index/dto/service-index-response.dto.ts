import { ApiProperty } from '@nestjs/swagger';

/** Response body for `GET /`: a static description of what this service exposes. */
export class ServiceIndexResponseDto {
  @ApiProperty({ example: 'Advanced Product Search API' })
  name!: string;

  @ApiProperty({ example: '0.1.0' })
  version!: string;

  @ApiProperty({
    description: 'Route (`GET /search`) → one-line description of what it does.',
    type: 'object',
    additionalProperties: { type: 'string' },
    example: { 'GET /search': 'Relevance-ranked search with filters, facets and suggestions' },
  })
  endpoints!: Record<string, string>;

  @ApiProperty({
    description: 'Where the written documentation lives.',
    example: 'https://github.com/ROMEROLUIS15/advanced-search-api',
  })
  docs!: string;
}
