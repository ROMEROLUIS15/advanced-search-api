/**
 * Base class for domain-rule violations. Framework-free; the presentation layer
 * maps `DomainError` subclasses to HTTP status codes (design D10).
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;

  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** A domain invariant (entity/value-object precondition) was violated. */
export class InvariantViolationError extends DomainError {
  readonly code = 'INVARIANT_VIOLATION';

  constructor(message: string) {
    super(message);
  }
}
