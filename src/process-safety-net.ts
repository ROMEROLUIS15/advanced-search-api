import { Logger } from '@nestjs/common';
import { errorMessage } from '@shared/error-message';

/** The slice of INestApplication the safety net needs; keeps the unit test tiny. */
export interface ClosableApp {
  close(): Promise<void>;
}

/**
 * Handles a failure that escaped Nest's per-request exception zone — the zone
 * `AllExceptionsFilter` covers. An unhandled rejection or uncaught exception
 * leaves the process in an indeterminate state, so we log it, close the app so
 * shutdown hooks release the ES/Redis connections, then exit non-zero for the
 * orchestrator (Render) to restart a clean process. Fail fast and restart beats
 * serving from a corrupted process.
 */
export async function handleFatalError(
  label: string,
  reason: unknown,
  app: ClosableApp,
  logger: Logger,
): Promise<void> {
  logger.error(
    `${label}: ${errorMessage(reason)}`,
    reason instanceof Error ? reason.stack : undefined,
  );
  try {
    await app.close();
  } catch (closeError) {
    logger.error(`Failed to close the app cleanly: ${errorMessage(closeError)}`);
  } finally {
    process.exit(1);
  }
}

/**
 * Installs process-level handlers for failures outside the HTTP request cycle.
 * Wired from `main.ts` only — never from `configureApp`, so the e2e suites (which
 * each boot the app through `configureApp`) don't stack one listener per app. A
 * re-entry guard stops a second event from starting a concurrent shutdown.
 */
export function installProcessSafetyNet(
  app: ClosableApp,
  logger: Logger = new Logger('ProcessSafetyNet'),
): void {
  let handling = false;
  const onFatal = (label: string, reason: unknown): void => {
    if (handling) {
      return;
    }
    handling = true;
    void handleFatalError(label, reason, app, logger);
  };

  process.on('unhandledRejection', (reason) => onFatal('Unhandled promise rejection', reason));
  process.on('uncaughtException', (error) => onFatal('Uncaught exception', error));
}
