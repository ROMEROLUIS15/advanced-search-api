import { HttpException, HttpStatus } from '@nestjs/common';
import { RateLimitGuard } from './rate-limit.guard';

/** Exposes the two protected overrides for unit testing. */
class TestableGuard extends RateLimitGuard {
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
