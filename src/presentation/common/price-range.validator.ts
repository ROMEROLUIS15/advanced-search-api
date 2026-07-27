import {
  type ValidationArguments,
  type ValidationOptions,
  registerDecorator,
} from 'class-validator';

/**
 * Rejects an inverted price range at the edge.
 *
 * Before this, `minPrice=500&maxPrice=10` answered 200 with an empty list —
 * indistinguishable from a catalogue that genuinely has nothing in that range,
 * so a client could not tell a typo from a real result. A cross-field rule needs
 * a custom constraint because class-validator's built-ins only see one property.
 */
export function IsNotBelowMinPrice(
  options?: ValidationOptions,
): (target: object, propertyName: string) => void {
  return function register(target: object, propertyName: string): void {
    registerDecorator({
      name: 'isNotBelowMinPrice',
      target: target.constructor,
      propertyName,
      options,
      validator: {
        validate(value: unknown, args: ValidationArguments): boolean {
          const minPrice = (args.object as { minPrice?: unknown }).minPrice;
          if (typeof value !== 'number' || typeof minPrice !== 'number') {
            return true; // Each bound is validated on its own elsewhere.
          }
          return minPrice <= value;
        },
        defaultMessage(): string {
          return 'maxPrice must be greater than or equal to minPrice';
        },
      },
    });
  };
}
