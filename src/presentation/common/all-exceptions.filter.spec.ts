import { BadRequestException, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { errors as esErrors } from '@elastic/elasticsearch';
import { AllExceptionsFilter } from './all-exceptions.filter';
import {
  ResultWindowExceededError,
  UpstreamResponseError,
} from '@application/errors/application.error';
import { InvariantViolationError } from '@domain/errors/domain.error';

function runFilter(exception: unknown): { status: number; body: any } {
  let status = 0;
  let body: any;
  const response = {
    status: (code: number) => {
      status = code;
      return {
        json: (payload: any) => {
          body = payload;
        },
      };
    },
  };
  const host: any = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ url: '/search' }),
    }),
  };

  new AllExceptionsFilter().catch(exception, host);
  return { status, body };
}

describe('AllExceptionsFilter', () => {
  it('maps ResultWindowExceededError to 422', () => {
    const { status, body } = runFilter(new ResultWindowExceededError(10000, 'window too deep'));
    expect(status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(body).toMatchObject({
      statusCode: 422,
      error: 'Unprocessable Entity',
      message: 'window too deep',
      path: '/search',
    });
  });

  it('maps domain invariant errors to 400', () => {
    const { status } = runFilter(new InvariantViolationError('bad value'));
    expect(status).toBe(HttpStatus.BAD_REQUEST);
  });

  it('passes Nest HTTP exceptions through with their message', () => {
    const { status, body } = runFilter(new BadRequestException('pageSize too large'));
    expect(status).toBe(400);
    expect(body.message).toBe('pageSize too large');
  });

  it('maps unknown errors to 500 without leaking internals', () => {
    const { status, body } = runFilter(new Error('secret stack trace'));
    expect(status).toBe(500);
    expect(body.message).toBe('Internal server error');
  });

  it('maps Elasticsearch response errors to 502', () => {
    const esError = new esErrors.ResponseError({
      statusCode: 500,
      body: {},
      headers: {},
      warnings: null,
      meta: {},
    } as never);

    const { status, body } = runFilter(esError);

    expect(status).toBe(502);
    expect(body.message).toBe('Search engine error');
  });

  it('maps a 400 from Elasticsearch to 400, not 502 (the query was bad, not the cluster)', () => {
    // Arrange: what a rejected query looks like coming back from the engine.
    const esError = new esErrors.ResponseError({
      statusCode: 400,
      body: { error: { type: 'search_phase_execution_exception' } },
      headers: {},
      warnings: null,
      meta: {},
    } as never);

    // Act
    const { status, body } = runFilter(esError);

    // Assert
    expect(status).toBe(400);
    expect(body.error).toBe('Bad Request');
    expect(body.message).toBe('Invalid search query');
  });

  it('keeps a 404 from Elasticsearch as 502 (a missing index is not the caller)', () => {
    const esError = new esErrors.ResponseError({
      statusCode: 404,
      body: { error: { type: 'index_not_found_exception' } },
      headers: {},
      warnings: null,
      meta: {},
    } as never);

    const { status, body } = runFilter(esError);

    expect(status).toBe(502);
    expect(body.message).toBe('Search engine error');
  });

  it('maps Elasticsearch connection errors to 503', () => {
    const { status, body } = runFilter(new esErrors.ConnectionError('connection refused'));

    expect(status).toBe(503);
    expect(body.message).toBe('Search engine unavailable');
  });

  it('moves validation array messages into details with a generic message', () => {
    const validation = new BadRequestException({
      statusCode: 400,
      error: 'Bad Request',
      message: ['q must be a string'],
    });

    const { body } = runFilter(validation);

    expect(body.message).toBe('Validation failed');
    expect(body.details).toEqual(['q must be a string']);
  });
});

describe('AllExceptionsFilter — rate limiting (design D18)', () => {
  it('renders the guard rejection as a 429 in the project error shape', () => {
    // Arrange
    const exception = new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        error: 'Too Many Requests',
        message: 'Rate limit exceeded, retry after the window resets',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );

    // Act
    const { status, body } = runFilter(exception);

    // Assert
    expect(status).toBe(429);
    expect(body.error).toBe('Too Many Requests');
    expect(body.message).toMatch(/rate limit exceeded/i);
    expect(body).toHaveProperty('timestamp');
    expect(body).toHaveProperty('path');
  });

  it('does not leak the guard internals as the error label', () => {
    // Arrange
    const exception = new HttpException(
      { statusCode: 429, error: 'Too Many Requests', message: 'slow down' },
      429,
    );

    // Act
    const { body } = runFilter(exception);

    // Assert — never "ThrottlerException"
    expect(body.error).not.toMatch(/Throttler/);
  });
});

describe('AllExceptionsFilter — logging', () => {
  afterEach(() => jest.restoreAllMocks());

  it('logs a 4xx as a warning carrying the reason, not as an error', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    runFilter(new BadRequestException('pageSize too large'));

    expect(error).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('-> 400');
    expect(String(warn.mock.calls[0][0])).toContain('pageSize too large');
  });

  it('summarizes validation details in the 4xx warning line', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    runFilter(
      new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: ['q must be a string'],
      }),
    );

    expect(String(warn.mock.calls[0][0])).toContain('q must be a string');
  });

  it('still logs a 5xx as an error, not a warning', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    runFilter(new Error('secret stack trace'));

    expect(warn).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
  });
});

describe('AllExceptionsFilter — upstream contract errors', () => {
  it('maps an unusable Elasticsearch response to 502, not the 400 of other application errors', () => {
    // Arrange
    const exception = new UpstreamResponseError('Search hit abc is missing _source');

    // Act
    const { status, body } = runFilter(exception);

    // Assert
    expect(status).toBe(502);
    expect(body.message).toBe('Search engine error');
  });
});
