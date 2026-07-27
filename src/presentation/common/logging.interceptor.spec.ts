import { Logger } from '@nestjs/common';
import { of } from 'rxjs';
import { LoggingInterceptor } from './logging.interceptor';

function buildContext(request: object, response: object): any {
  return {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
  };
}

describe('LoggingInterceptor', () => {
  it('passes the handler response through', (done) => {
    const context: any = {
      switchToHttp: () => ({
        getRequest: () => ({ method: 'GET', url: '/search' }),
        getResponse: () => ({ statusCode: 200 }),
      }),
    };
    const next: any = { handle: () => of('payload') };

    new LoggingInterceptor().intercept(context, next).subscribe((value) => {
      expect(value).toBe('payload');
      done();
    });
  });
});

describe('LoggingInterceptor — operator paths', () => {
  it.each(['/health', '/metrics', '/health?probe=1'])(
    'does not log a successful %s: the platform polls it and the line says nothing',
    (url) => {
      // Arrange
      const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      const context = buildContext({ method: 'GET', url }, { statusCode: 200 });

      // Act
      new LoggingInterceptor().intercept(context, { handle: () => of('ok') }).subscribe();

      // Assert
      expect(log).not.toHaveBeenCalled();
      log.mockRestore();
    },
  );

  it('still logs real traffic', () => {
    // Arrange
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const context = buildContext({ method: 'GET', url: '/search?q=drill' }, { statusCode: 200 });

    // Act
    new LoggingInterceptor().intercept(context, { handle: () => of('ok') }).subscribe();

    // Assert
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).toContain('/search?q=drill');
    log.mockRestore();
  });
});
