import { InvariantViolationError } from '../errors/domain.error';

const CURRENCY_DECIMALS = 2;

/**
 * Immutable monetary value. A single implicit currency (USD) is assumed; range
 * filtering and sorting use the numeric amount only (design: price as
 * `scaled_float`, 2-decimal precision, no float drift).
 */
export class Money {
  private constructor(
    readonly amount: number,
    readonly currency: string,
  ) {}

  static of(amount: number, currency = 'USD'): Money {
    if (!Number.isFinite(amount) || amount < 0) {
      throw new InvariantViolationError(
        `Money amount must be a non-negative finite number, got: ${amount}`,
      );
    }
    return new Money(roundToCents(amount), currency);
  }

  equals(other: Money): boolean {
    return this.amount === other.amount && this.currency === other.currency;
  }

  toNumber(): number {
    return this.amount;
  }
}

function roundToCents(value: number): number {
  const factor = 10 ** CURRENCY_DECIMALS;
  return Math.round(value * factor) / factor;
}
