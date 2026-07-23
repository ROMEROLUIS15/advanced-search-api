export const RATE_LIMIT_STORE = Symbol('RATE_LIMIT_STORE');

/** Outcome of counting one request against a window. */
export interface RateLimitHit {
  /** Requests recorded for this key in the current window, including this one. */
  totalHits: number;
  /** Milliseconds until the window resets. */
  timeToExpireMs: number;
}

/**
 * Counter behind request rate limiting (design D14).
 *
 * Deliberately minimal: one call records a request and reports where the client
 * stands. Deciding whether that exceeds a budget belongs to the HTTP edge, not
 * here, and no Redis or framework type crosses this boundary.
 */
export interface RateLimitStorePort {
  hit(key: string, windowMs: number): Promise<RateLimitHit>;
}
