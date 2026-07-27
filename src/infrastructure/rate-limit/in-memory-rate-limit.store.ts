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
/** How often the map is swept, at most. See {@link InMemoryRateLimitStore.evictExpired}. */
const SWEEP_INTERVAL_MS = 30_000;

/** A sweep is forced past this many entries, whatever the interval says. */
const SWEEP_SIZE_THRESHOLD = 10_000;

@Injectable()
export class InMemoryRateLimitStore implements RateLimitStorePort {
  private readonly windows = new Map<string, Window>();
  private lastSweepAt = 0;

  hit(key: string, windowMs: number): Promise<RateLimitHit> {
    const now = Date.now();
    this.maybeEvictExpired(now);

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
   * Swept on write rather than on a timer: a timer would keep the event loop
   * alive and complicate shutdown. But sweeping the *whole* map on every hit
   * made each request O(active clients) — and this store is the fail-over path,
   * so it carries the full load exactly when Redis is down and traffic is
   * heaviest. The per-key expiry check in `hit` already keeps counts correct;
   * this only reclaims memory, so it is fine to do it rarely.
   */
  private maybeEvictExpired(now: number): void {
    const due = now - this.lastSweepAt >= SWEEP_INTERVAL_MS;
    if (!due && this.windows.size < SWEEP_SIZE_THRESHOLD) {
      return;
    }
    this.lastSweepAt = now;
    for (const [key, window] of this.windows) {
      if (window.expiresAt <= now) {
        this.windows.delete(key);
      }
    }
  }
}
