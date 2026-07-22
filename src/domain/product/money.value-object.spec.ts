import { Money } from './money.value-object';
import { InvariantViolationError } from '../errors/domain.error';

describe('Money', () => {
  it('defaults to USD and rounds to two decimals', () => {
    // Arrange & Act
    const money = Money.of(19.994);

    // Assert
    expect(money.currency).toBe('USD');
    expect(money.toNumber()).toBe(19.99);
    expect(Money.of(19.999).toNumber()).toBe(20);
  });

  it('throws on a negative amount', () => {
    expect(() => Money.of(-0.01)).toThrow(InvariantViolationError);
  });

  it('throws on a non-finite amount', () => {
    expect(() => Money.of(Number.POSITIVE_INFINITY)).toThrow(InvariantViolationError);
  });

  it('compares by amount and currency', () => {
    // Arrange / Act / Assert
    expect(Money.of(10).equals(Money.of(10))).toBe(true);
    expect(Money.of(10, 'EUR').equals(Money.of(10, 'USD'))).toBe(false);
  });
});
