import { errors } from '@elastic/elasticsearch';
import { isAlreadyExistsError } from './es-errors';

function responseError(body: unknown): unknown {
  return new errors.ResponseError({ statusCode: 400, body, headers: {}, meta: {} } as never);
}

describe('isAlreadyExistsError', () => {
  it('recognises the exception that makes index creation idempotent', () => {
    // Arrange & Act & Assert
    expect(
      isAlreadyExistsError(responseError({ error: { type: 'resource_already_exists_exception' } })),
    ).toBe(true);
  });

  it('rejects a different Elasticsearch error type', () => {
    // Arrange & Act & Assert
    expect(isAlreadyExistsError(responseError({ error: { type: 'illegal_argument' } }))).toBe(
      false,
    );
  });

  it.each([
    ['a plain Error', new Error('boom')],
    ['a string', 'resource_already_exists_exception'],
    ['null', null],
    ['undefined', undefined],
  ])('rejects %s, which never came from the client', (_name, value) => {
    expect(isAlreadyExistsError(value)).toBe(false);
  });

  it.each([
    ['a non-object body', 'not-an-object'],
    ['a body without an error field', { acknowledged: true }],
    ['a non-object error field', { error: 'boom' }],
    ['an error without a type', { error: { reason: 'nope' } }],
    ['a non-string type', { error: { type: 42 } }],
  ])('rejects %s instead of throwing while inspecting it', (_name, body) => {
    expect(isAlreadyExistsError(responseError(body))).toBe(false);
  });
});
