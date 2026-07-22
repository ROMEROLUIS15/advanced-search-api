import { BadRequestException, HttpStatus } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { ResultWindowExceededError } from '@application/errors/application.error';
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
});
