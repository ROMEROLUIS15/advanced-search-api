import { Injectable } from '@nestjs/common';
import type { RateLimitHit, RateLimitStorePort } from '@application/ports/rate-limit-store.port';

interface Window {
  count: number;
  expiresAt: number;
}

/**
 * Per-process {@link RateLimitStorePort} (design D14).
 *
 * Serves two purposes: it is the fallback used whenever Redis is unreachable, so
 * protection survives an outage of a dependency the service treats as
 * non-critical, and it is a complete store in its own right for a single-instance
 * deployment. Counts are per process, so with N instances the effective ceiling
 * is N x the limit — a bounded, documented loss of precision, and far better
 * than counting nothing.
 */
@Injectable()
export class InMemoryRateLimitStore implements RateLimitStorePort {
  private readonly windows = new Map<string, Window>();

  hit(key: string, windowMs: number): Promise<RateLimitHit> {
    const now = Date.now();
    this.evictExpired(now);

    const current = this.windows.get(key);
    if (!current || current.expiresAt <= now) {
      const fresh: Window = { count: 1, expiresAt: now + windowMs };
      this.windows.set(key, fresh);
      return Promise.resolve({ totalHits: 1, timeToExpireMs: windowMs });
    }

    current.count += 1;
    return Promise.resolve({
      totalHits: current.count,
      timeToExpireMs: current.expiresAt - now,
    });
  }

  /**
   * Swept on write rather than on a timer: the map only grows with active
   * clients, and a timer would keep the event loop alive and complicate
   * shutdown.
   */
  private evictExpired(now: number): void {
    for (const [key, window] of this.windows) {
      if (window.expiresAt <= now) {
        this.windows.delete(key);
      }
    }
  }
}
