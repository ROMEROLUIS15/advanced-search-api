import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Global rate limit guard (design D16, D18).
 *
 * Two deliberate departures from the stock guard:
 *
 * - **Header names.** `RateLimit-Limit` / `-Remaining` / `-Reset` rather than the
 *   library's `X-RateLimit-*`, matching the convention modern clients expect.
 * - **The rejection.** A typed `HttpException` instead of `ThrottlerException`, so
 *   `AllExceptionsFilter` renders the same `{ statusCode, error, message,
 *   timestamp, path }` body as every other error. Status codes are still not
 *   assembled in controllers or adapters.
 *
 * The client identity now comes from `getTracker` in the module options, which
 * needs the configured API keys: a caller with a valid key gets its own budget,
 * and everyone else is counted by `req.ip`, resolved through the configured
 * `trust proxy` hop count — that setting, not this guard, is what stops a client
 * forging `X-Forwarded-For` to escape its budget (design D34).
 */
@Injectable()
export class RateLimitGuard extends ThrottlerGuard {
  protected headerPrefix = 'RateLimit';

  protected throwThrottlingException(): Promise<void> {
    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        error: 'Too Many Requests',
        message: 'Rate limit exceeded, retry after the window resets',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
