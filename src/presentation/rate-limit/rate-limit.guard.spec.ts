import { HttpException, HttpStatus } from '@nestjs/common';
import { RateLimitGuard } from './rate-limit.guard';

/** Exposes the two protected overrides for unit testing. */
class TestableGuard extends RateLimitGuard {
  publicGetTracker(req: Record<string, unknown>): Promise<string> {
    return this.getTracker(req);
  }

  publicThrow(): void {
    // The base signature is async, but the override throws synchronously.
    void this.throwThrottlingException();
  }
}

function buildGuard(): TestableGuard {
  // The base guard's collaborators are unused by the two methods under test.
  return new TestableGuard({ throttlers: [] }, { increment: jest.fn() }, {
    getAllAndOverride: jest.fn(),
  } as never);
}

describe('RateLimitGuard', () => {
  describe('getTracker (design D16)', () => {
    it('identifies the client by req.ip when present', async () => {
      // Arrange & Act
      const tracker = await buildGuard().publicGetTracker({ ip: '203.0.113.7' });

      // Assert
      expect(tracker).toBe('203.0.113.7');
    });

    it('falls back to the socket address when req.ip is absent', async () => {
      // Arrange & Act
      const tracker = await buildGuard().publicGetTracker({
        socket: { remoteAddress: '198.51.100.4' },
      });

      // Assert
      expect(tracker).toBe('198.51.100.4');
    });

    it('yields a stable placeholder when no address can be resolved', async () => {
      // Arrange & Act
      const tracker = await buildGuard().publicGetTracker({});

      // Assert
      expect(tracker).toBe('unknown');
    });
  });

  describe('throwThrottlingException (design D18)', () => {
    it('throws a typed 429 that AllExceptionsFilter renders, not a raw ThrottlerException', () => {
      // Arrange
      const guard = buildGuard();

      // Act & Assert
      expect(() => guard.publicThrow()).toThrow(HttpException);
      try {
        guard.publicThrow();
      } catch (error) {
        const httpError = error as HttpException;
        expect(httpError.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
        expect((httpError.getResponse() as { error: string }).error).toBe('Too Many Requests');
      }
    });
  });

  it('advertises the RateLimit-* header prefix rather than the library default', () => {
    // Arrange & Act
    const prefix = (buildGuard() as unknown as { headerPrefix: string }).headerPrefix;

    // Assert
    expect(prefix).toBe('RateLimit');
  });
});
