import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { ErrorResponseDto } from './dto/error-response.dto';

/** What each documented status means for this API, in one place. */
const DESCRIPTIONS: Record<number, string> = {
  400: 'Invalid or unknown query parameter, or a value past its limit.',
  422: 'Pagination beyond the maximum result window.',
  429: 'Rate limit exceeded. `RateLimit-*` headers report the budget and reset.',
  502: 'Elasticsearch answered with an error.',
  503: 'Elasticsearch is unreachable.',
};

/**
 * Documents the error statuses an endpoint can return, all sharing
 * {@link ErrorResponseDto}. Declaring them one by one on every handler is how
 * error schemas drift, so the list of codes is the only thing a controller states.
 */
export function ApiErrorResponses(...statuses: number[]): MethodDecorator & ClassDecorator {
  return applyDecorators(
    ...statuses.map((status) =>
      ApiResponse({ status, description: DESCRIPTIONS[status], type: ErrorResponseDto }),
    ),
  );
}
