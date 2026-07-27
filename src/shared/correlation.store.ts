import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request correlation id, carried implicitly (design D22).
 *
 * `AsyncLocalStorage` is what lets a log statement made from a static position —
 * a use-case's private `Logger`, the exception filter — pick up the id of the
 * request it is running under without anyone passing it down. The alternative,
 * a request-scoped provider, would make the whole injection subtree
 * request-scoped; threading the id through the ports would put an HTTP artifact
 * into the domain-facing contracts.
 *
 * Outside a request (bootstrap, the seed command, a background timer) there is
 * simply no store, and `getCorrelationId()` returns undefined.
 */
const storage = new AsyncLocalStorage<string>();

/** Runs `fn` with `id` visible to everything it awaits. */
export function runWithCorrelationId<T>(id: string, fn: () => T): T {
  return storage.run(id, fn);
}

/** The id of the request in flight, or undefined outside one. */
export function getCorrelationId(): string | undefined {
  return storage.getStore();
}
