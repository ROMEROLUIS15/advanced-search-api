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
