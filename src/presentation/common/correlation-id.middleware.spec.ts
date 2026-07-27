import type { NextFunction, Request, Response } from 'express';
import { getCorrelationId } from '@shared/correlation.store';
import { CORRELATION_HEADER, correlationIdMiddleware } from './correlation-id.middleware';

function run(inbound?: string | string[]): { header?: string; insideStore?: string } {
  const headers: Record<string, string | string[] | undefined> = { 'x-request-id': inbound };
  let header: string | undefined;
  let insideStore: string | undefined;

  const request = { headers } as unknown as Request;
  const response = {
    setHeader: (name: string, value: string) => {
      if (name === CORRELATION_HEADER) {
        header = value;
      }
    },
  } as unknown as Response;
  const next: NextFunction = () => {
    insideStore = getCorrelationId();
  };

  correlationIdMiddleware(request, response, next);
  return { header, insideStore };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('correlationIdMiddleware', () => {
  it('generates an id when none arrives, and runs the chain inside the store', () => {
    // Arrange & Act
    const { header, insideStore } = run(undefined);

    // Assert
    expect(header).toMatch(UUID);
    expect(insideStore).toBe(header);
  });

  it('honours a safe inbound id so a caller can correlate across services', () => {
    // Arrange & Act
    const { header, insideStore } = run('trace-42_a.b:c');

    // Assert
    expect(header).toBe('trace-42_a.b:c');
    expect(insideStore).toBe('trace-42_a.b:c');
  });

  it.each([
    ['a CRLF injection attempt', 'abc\r\nX-Evil: 1'],
    ['a value with spaces', 'not a valid id'],
    ['an over-long value', 'x'.repeat(129)],
    ['an empty value', ''],
  ])('replaces %s with a generated id rather than echoing it', (_name, inbound) => {
    // Arrange & Act
    const { header } = run(inbound);

    // Assert
    expect(header).toMatch(UUID);
  });

  it('takes the first value when the header is repeated', () => {
    // Arrange & Act
    const { header } = run(['first-id', 'second-id']);

    // Assert
    expect(header).toBe('first-id');
  });
});
