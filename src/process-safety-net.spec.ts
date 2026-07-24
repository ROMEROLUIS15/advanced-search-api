import { Logger } from '@nestjs/common';
import { type ClosableApp, handleFatalError, installProcessSafetyNet } from './process-safety-net';

function fakeLogger(): Logger {
  return { error: jest.fn() } as unknown as Logger;
}

describe('handleFatalError', () => {
  let exitSpy: jest.SpyInstance;

  beforeEach(() => {
    exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  });

  afterEach(() => jest.restoreAllMocks());

  it('logs the reason with its stack, closes the app, and exits non-zero', async () => {
    const app: ClosableApp = { close: jest.fn().mockResolvedValue(undefined) };
    const logger = fakeLogger();

    await handleFatalError('Uncaught exception', new Error('boom'), app, logger);

    expect(logger.error).toHaveBeenCalledWith(
      'Uncaught exception: boom',
      expect.stringContaining('boom'),
    );
    expect(app.close).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('still exits when closing the app fails', async () => {
    const app: ClosableApp = { close: jest.fn().mockRejectedValue(new Error('close failed')) };
    const logger = fakeLogger();

    await handleFatalError('Unhandled promise rejection', 'weird', app, logger);

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to close the app cleanly'),
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe('installProcessSafetyNet', () => {
  const handlers = new Map<string, (arg: unknown) => void>();

  beforeEach(() => {
    jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    jest.spyOn(process, 'on').mockImplementation(((event: string, cb: (arg: unknown) => void) => {
      handlers.set(event, cb);
      return process;
    }) as never);
  });

  afterEach(() => {
    handlers.clear();
    jest.restoreAllMocks();
  });

  it('registers handlers for both process-level failure events', () => {
    installProcessSafetyNet({ close: jest.fn().mockResolvedValue(undefined) });

    expect(handlers.has('unhandledRejection')).toBe(true);
    expect(handlers.has('uncaughtException')).toBe(true);
  });

  it('shuts down only once even if a second event fires', async () => {
    const app: ClosableApp = { close: jest.fn().mockResolvedValue(undefined) };
    installProcessSafetyNet(app, fakeLogger());

    handlers.get('uncaughtException')?.(new Error('first'));
    handlers.get('unhandledRejection')?.('second');
    await Promise.resolve();
    await Promise.resolve();

    expect(app.close).toHaveBeenCalledTimes(1);
  });
});
