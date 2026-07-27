/**
 * Every path this API routes. Kept here because Nest answers **404** for a known
 * path called with the wrong method — Express simply finds no matching handler —
 * and telling a client "that path exists, this verb does not" needs the list.
 *
 * A spec asserts this against the controllers' own metadata, so adding a
 * controller without adding it here fails the build rather than drifting.
 */
export const API_PATHS = [
  '/',
  '/search',
  '/autocomplete',
  '/suggest',
  '/health',
  '/metrics',
] as const;

/** The verbs a read-only API answers. Everything else is Method Not Allowed. */
export const ALLOWED_METHODS = ['GET', 'HEAD', 'OPTIONS'] as const;

export const ALLOW_HEADER_VALUE = 'GET, HEAD, OPTIONS';

/** Exact match only: `/searching` is not `/search` with a different verb, it is a 404. */
export function isApiPath(path: string): boolean {
  const withoutQuery = path.split('?')[0];
  return API_PATHS.some((known) => known === withoutQuery);
}

export function isAllowedMethod(method: string): boolean {
  return ALLOWED_METHODS.some((allowed) => allowed === method.toUpperCase());
}
