import { errors } from '@elastic/elasticsearch';

/**
 * True when an error is Elasticsearch's `resource_already_exists_exception`
 * (idempotent create). Keyed on the error *type*, not the status: a concurrent
 * `indices.create` answers **400**, not the 409 one might expect — measured on
 * 8.17.0 and on Serverless 9.6.0 alike.
 */
export function isAlreadyExistsError(error: unknown): boolean {
  if (!(error instanceof errors.ResponseError)) {
    return false;
  }
  return extractErrorType(error.body) === 'resource_already_exists_exception';
}

/** True when Elasticsearch reports the index or alias does not exist. */
export function isIndexNotFoundError(error: unknown): boolean {
  if (!(error instanceof errors.ResponseError)) {
    return false;
  }
  return extractErrorType(error.body) === 'index_not_found_exception' || error.statusCode === 404;
}

function extractErrorType(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null || !('error' in body)) {
    return undefined;
  }
  const errorField = (body as { error?: unknown }).error;
  if (typeof errorField !== 'object' || errorField === null || !('type' in errorField)) {
    return undefined;
  }
  const type = (errorField as { type?: unknown }).type;
  return typeof type === 'string' ? type : undefined;
}
