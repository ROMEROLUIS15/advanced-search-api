import { startTracing } from './tracing.bootstrap';

/**
 * Starts instrumentation while this module is being loaded.
 *
 * This must remain a side effect rather than a function called from `bootstrap()`:
 * CommonJS evaluates every `require` before the application function runs, so a
 * later call would let `AppModule` load ioredis before its instrumentation hook.
 */
export const tracingStarted = startTracing();
