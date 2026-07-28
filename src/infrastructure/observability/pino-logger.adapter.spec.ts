import { Writable } from 'node:stream';
import pino from 'pino';
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

describe('PinoLoggerAdapter — message shapes', () => {
  it('logs an Error by its message, not "[object Object]"', () => {
    const { logger, records } = build();

    logger.error(new Error('connection refused'), 'ElasticsearchHealthProbe');

    expect(records()[0]).toMatchObject({ msg: 'connection refused' });
  });

  it('serialises a structured message instead of dropping it', () => {
    const { logger, records } = build();

    logger.log({ event: 'seeded', count: 24 });

    expect(records()[0].msg).toBe('{"event":"seeded","count":24}');
  });

  it('logs without a context when Nest passes none', () => {
    const { logger, records } = build();

    logger.log('bare message');

    expect(records()[0]).not.toHaveProperty('context');
    expect(records()[0].msg).toBe('bare message');
  });

  it('refuses pretty output in production, where pino-pretty is not installed', () => {
    const { stream, records } = collector();
    const config = {
      app: { nodeEnv: 'production' },
      observability: { logLevel: 'info', logPretty: true, serviceName: 'svc' },
    } as AppConfiguration;

    new PinoLoggerAdapter(config, stream).log('still json', 'Ctx');

    expect(records()[0]).toMatchObject({ msg: 'still json', context: 'Ctx' });
  });
});

describe('PinoLoggerAdapter — log shipping (design D36)', () => {
  /**
   * `pino.transport` is stubbed rather than exercised: the real one spawns worker
   * threads, and what is worth asserting here is the *configuration* — which
   * targets, which labels, which failure behaviour — not that pino can start a
   * thread.
   */
  function stubTransport(): { calls: any[]; stream: any } {
    const calls: any[] = [];
    const stream: any = { write: jest.fn(), on: jest.fn(), end: jest.fn() };
    jest.spyOn(pino, 'transport').mockImplementation((options: any) => {
      calls.push(options);
      return stream;
    });
    return { calls, stream };
  }

  afterEach(() => jest.restoreAllMocks());

  it('constructs no transport at all when Loki is not configured', () => {
    const { calls } = stubTransport();

    new PinoLoggerAdapter(configWith());

    expect(calls).toHaveLength(0);
  });

  it('keeps writing to standard output alongside Loki', () => {
    const { calls } = stubTransport();

    new PinoLoggerAdapter(configWith({ lokiUrl: 'https://logs.example.com' }));

    const targets = calls[0].targets.map((t: any) => t.target);
    expect(targets).toContain('pino/file');
    expect(targets).toContain('pino-loki');
  });

  it('labels streams by service and env only, never by correlation id', () => {
    const { calls } = stubTransport();

    new PinoLoggerAdapter(configWith({ lokiUrl: 'https://logs.example.com' }));

    // Assert: a label per request would mint a Loki stream per request.
    const loki = calls[0].targets.find((t: any) => t.target === 'pino-loki');
    expect(Object.keys(loki.options.labels).sort()).toEqual(['env', 'service']);
    expect(loki.options.propsToLabels).toBeUndefined();
  });

  it('silences batch errors and attaches an error listener to the stream', () => {
    const { calls, stream } = stubTransport();

    new PinoLoggerAdapter(configWith({ lokiUrl: 'https://logs.example.com' }));

    // Assert: an unhandled 'error' here reaches installProcessSafetyNet, which
    // exits the process — a log backend going down must not restart the API.
    const loki = calls[0].targets.find((t: any) => t.target === 'pino-loki');
    expect(loki.options.silenceErrors).toBe(true);
    expect(stream.on).toHaveBeenCalledWith('error', expect.any(Function));
    const handler = stream.on.mock.calls.find(([event]: [string]) => event === 'error')[1];
    expect(() => handler(new Error('loki is down'))).not.toThrow();
  });

  it('sends basic auth only when both halves are configured', () => {
    const { calls } = stubTransport();

    new PinoLoggerAdapter(configWith({ lokiUrl: 'https://logs.example.com' }));
    new PinoLoggerAdapter(
      configWith({
        lokiUrl: 'https://logs.example.com',
        lokiUsername: '12345',
        lokiPassword: 'glc_token',
      }),
    );

    const lokiOf = (index: number): any =>
      calls[index].targets.find((t: any) => t.target === 'pino-loki').options;
    expect(lokiOf(0).basicAuth).toBeUndefined();
    expect(lokiOf(1).basicAuth).toEqual({ username: '12345', password: 'glc_token' });
  });

  it('ships numeric level and time: either one as a string silently kills a pipeline', () => {
    // Arrange: a string level makes the worker route the line to no target
    // (stdout dies too); a string time multiplies to NaN inside pino-loki and
    // Loki rejects the batch. Both were found in production, not by a test.
    const { stream } = stubTransport();

    new PinoLoggerAdapter(configWith({ lokiUrl: 'https://logs.example.com' })).log(
      'shipped',
      'Ctx',
    );

    const line = JSON.parse(String((stream.write as jest.Mock).mock.calls[0][0]));
    expect(line.level).toBe(30);
    expect(typeof line.time).toBe('number');
    expect(line.msg).toBe('shipped');
  });

  it('still carries the correlation id as a field, which is how a trace is pivoted to its logs', () => {
    // Arrange: the injected destination path is what the other suites use, and
    // it must keep working — shipping is additive, not a replacement.
    const { stream, records } = collector();

    runWithCorrelationId('corr-42', () => {
      new PinoLoggerAdapter(configWith({ lokiUrl: 'https://logs.example.com' }), stream).log(
        'searched',
        'Ctx',
      );
    });

    expect(records()[0]).toMatchObject({ msg: 'searched', correlationId: 'corr-42' });
  });
});
