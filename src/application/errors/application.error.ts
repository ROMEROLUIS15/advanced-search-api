/**
 * Base class for application-level errors (input/pagination constraints that are
 * not domain invariants). The global exception filter maps these to HTTP codes.
 */
export abstract class ApplicationError extends Error {
  abstract readonly code: string;

  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Requested `from + size` exceeds Elasticsearch's `max_result_window` (design D5 ⇒ 422). */
export class ResultWindowExceededError extends ApplicationError {
  readonly code = 'RESULT_WINDOW_EXCEEDED';

  constructor(
    readonly maxResultWindow: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * The search engine answered, but with something the adapter cannot map — a hit
 * without `_source`, for instance. Not the caller's fault and not a crash of
 * ours, so it maps to **502** rather than the 400 an `ApplicationError` usually
 * carries. Exists so no production path has to throw a bare `Error`.
 */
export class UpstreamResponseError extends ApplicationError {
  readonly code = 'UPSTREAM_RESPONSE_INVALID';

  constructor(message: string) {
    super(message);
  }
}
