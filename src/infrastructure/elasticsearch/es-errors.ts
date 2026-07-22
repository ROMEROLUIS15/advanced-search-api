import { errors } from '@elastic/elasticsearch';

/** True when an error is Elasticsearch's `resource_already_exists_exception` (idempotent create). */
export function isAlreadyExistsError(error: unknown): boolean {
  if (!(error instanceof errors.ResponseError)) {
    return false;
  }
  return extractErrorType(error.body) === 'resource_already_exists_exception';
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
