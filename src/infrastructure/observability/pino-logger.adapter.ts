import type { LoggerService } from '@nestjs/common';
import pino, { type Logger as PinoLogger } from 'pino';
import type { AppConfiguration } from '@config/app-config';
import { getCorrelationId } from '@shared/correlation.store';

/**
 * Nest `LoggerService` backed by pino (design D21).
 *
 * Installed with `app.useLogger`, so the ~30 existing `new Logger(Context)` call
 * sites keep working untouched and start emitting JSON — no second HTTP
 * middleware, no request-scoped providers. The correlation id is read from the
 * async store rather than passed in, which is what lets a log line made deep
 * inside a use-case carry the id of the request it belongs to.
 *
 * Pretty output is refused in production even when asked for: `pino-pretty` is a
 * dev dependency and the runtime image installs with `--omit=dev`, so resolving
 * the transport there would crash the process at boot.
 */
export class PinoLoggerAdapter implements LoggerService {
  private readonly logger: PinoLogger;

  /** `destination` exists so specs can read what was written; production passes nothing. */
  constructor(config: AppConfiguration, destination?: pino.DestinationStream) {
    const { logLevel, logPretty, serviceName } = config.observability;
    const pretty = logPretty && config.app.nodeEnv !== 'production';
    const options: pino.LoggerOptions = {
      level: logLevel,
      base: { service: serviceName },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
      ...(pretty && destination === undefined
        ? { transport: { target: 'pino-pretty', options: { translateTime: 'SYS:standard' } } }
        : {}),
    };
    this.logger = destination === undefined ? pino(options) : pino(options, destination);
  }

  log(message: unknown, ...params: unknown[]): void {
    this.write('info', message, params);
  }

  error(message: unknown, ...params: unknown[]): void {
    this.write('error', message, params);
  }

  warn(message: unknown, ...params: unknown[]): void {
    this.write('warn', message, params);
  }

  debug(message: unknown, ...params: unknown[]): void {
    this.write('debug', message, params);
  }

  verbose(message: unknown, ...params: unknown[]): void {
    this.write('trace', message, params);
  }

  fatal(message: unknown, ...params: unknown[]): void {
    this.write('fatal', message, params);
  }

  /**
   * Nest passes the context as the last string argument, and for `error` a stack
   * as the one before it. Both become fields instead of being concatenated into
   * the message, which is the whole point of structured logs.
   */
  private write(level: pino.Level, message: unknown, params: unknown[]): void {
    const rest = [...params];
    const context = typeof rest[rest.length - 1] === 'string' ? (rest.pop() as string) : undefined;
    const stack = rest.find((value) => typeof value === 'string');
    const correlationId = getCorrelationId();

    this.logger[level](
      {
        ...(context !== undefined ? { context } : {}),
        ...(stack !== undefined ? { stack } : {}),
        ...(correlationId !== undefined ? { correlationId } : {}),
      },
      toMessage(message),
    );
  }
}

function toMessage(message: unknown): string {
  if (typeof message === 'string') {
    return message;
  }
  if (message instanceof Error) {
    return message.message;
  }
  return JSON.stringify(message);
}
