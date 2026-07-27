import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { runWithCorrelationId } from '@shared/correlation.store';

export const CORRELATION_HEADER = 'X-Request-Id';

/**
 * Accepts only what we are willing to echo back into a response header and into
 * every log line: no CR/LF (header and log injection), no unbounded length.
 * Anything else is discarded in favour of a generated id rather than rejected —
 * a malformed trace header is not worth failing a search over.
 */
const SAFE_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * Opens the correlation store for the request (design D22): honours an inbound
 * `X-Request-Id` when it is safe, generates one otherwise, echoes it back, and
 * runs the rest of the pipeline inside the store so every log line of this
 * request carries the same id — including the error line from the exception
 * filter, which today has no way of knowing which request it belongs to.
 */
export function correlationIdMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const id = resolveCorrelationId(request.headers['x-request-id']);
  response.setHeader(CORRELATION_HEADER, id);
  runWithCorrelationId(id, () => {
    next();
  });
}

function resolveCorrelationId(inbound: string | string[] | undefined): string {
  const candidate = Array.isArray(inbound) ? inbound[0] : inbound;
  if (typeof candidate === 'string' && SAFE_ID.test(candidate)) {
    return candidate;
  }
  return randomUUID();
}
