import { Writable } from 'node:stream';
import type { AppConfiguration } from '@config/app-config';
import { runWithCorrelationId } from '@shared/correlation.store';
import { PinoLoggerAdapter } from './pino-logger.adapter';

function collector(): { stream: Writable; records: () => any[] } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback): void {
      lines.push(String(chunk));
      callback();
    },
  });
  return { stream, records: () => lines.map((line) => JSON.parse(line)) };
}

function configWith(overrides: Partial<AppConfiguration['observability']> = {}): AppConfiguration {
  return {
    app: { nodeEnv: 'test' },
    observability: {
      logLevel: 'info',
      logPretty: false,
      serviceName: 'advanced-search-api',
      ...overrides,
    },
  } as AppConfiguration;
}

function build(overrides?: Partial<AppConfiguration['observability']>): {
  logger: PinoLoggerAdapter;
  records: () => any[];
} {
  const { stream, records } = collector();
  return { logger: new PinoLoggerAdapter(configWith(overrides), stream), records };
}

describe('PinoLoggerAdapter', () => {
  it('emits one JSON object per record with level, service, context and message', () => {
    // Arrange
    const { logger, records } = build();

    // Act
    logger.log('GET /search 200 4ms', 'HTTP');

    // Assert
    expect(records()).toHaveLength(1);
    expect(records()[0]).toMatchObject({
      level: 'info',
      service: 'advanced-search-api',
      context: 'HTTP',
      msg: 'GET /search 200 4ms',
    });
    expect(typeof records()[0].time).toBe('string');
  });

  it('stamps the correlation id of the request in flight without being told', () => {
    // Arrange
    const { logger, records } = build();

    // Act
    runWithCorrelationId('req-7', () => {
      logger.warn('Cache read failed', 'SearchProductsUseCase');
    });

    // Assert
    expect(records()[0]).toMatchObject({ correlationId: 'req-7', level: 'warn' });
  });

  it('omits the correlation id outside a request instead of inventing one', () => {
    // Arrange
    const { logger, records } = build();

    // Act
    logger.log('Nest application successfully started', 'NestApplication');

    // Assert
    expect(records()[0]).not.toHaveProperty('correlationId');
  });

  it('keeps the stack as its own field, the way the exception filter passes it', () => {
    // Arrange
    const { logger, records } = build();

    // Act
    logger.error('GET /search -> 500', 'Error: boom\n    at handler', 'AllExceptionsFilter');

    // Assert
    expect(records()[0]).toMatchObject({
      level: 'error',
      context: 'AllExceptionsFilter',
      stack: 'Error: boom\n    at handler',
      msg: 'GET /search -> 500',
    });
  });

  it('honours the configured level, so debug noise stays out of production', () => {
    // Arrange
    const { logger, records } = build({ logLevel: 'warn' });

    // Act
    logger.log('chatty');
    logger.warn('important');

    // Assert
    expect(records()).toHaveLength(1);
    expect(records()[0].msg).toBe('important');
  });

  it('maps verbose to trace and fatal to fatal', () => {
    // Arrange
    const { logger, records } = build({ logLevel: 'trace' });

    // Act
    logger.verbose('detail');
    logger.fatal('unrecoverable');

    // Assert
    expect(records().map((r) => r.level)).toEqual(['trace', 'fatal']);
  });
});
