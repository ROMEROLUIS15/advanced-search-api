import { of } from 'rxjs';
import { LoggingInterceptor } from './logging.interceptor';

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
