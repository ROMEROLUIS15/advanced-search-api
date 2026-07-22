import { Product, type ProductProps } from './product.entity';
import { Money } from './money.value-object';
import { InvariantViolationError } from '../errors/domain.error';

const validProps = (): ProductProps => ({
  id: 'p-1',
  name: 'Cordless Drill',
  description: 'A powerful cordless drill',
  category: 'Tools',
  subcategories: ['Power Tools', 'Drills'],
  location: 'Berlin',
  price: Money.of(129.99),
  popularity: 42,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
});

describe('Product.create', () => {
  it('creates a valid product and copies subcategories defensively', () => {
    // Arrange
    const subcategories = ['Power Tools'];

    // Act
    const product = Product.create({ ...validProps(), subcategories });
    subcategories.push('mutated');

    // Assert
    expect(product.subcategories).toEqual(['Power Tools']);
    expect(product.price.toNumber()).toBe(129.99);
  });

  it('throws when the name is blank', () => {
    expect(() => Product.create({ ...validProps(), name: '   ' })).toThrow(InvariantViolationError);
  });

  it('throws when popularity is negative', () => {
    expect(() => Product.create({ ...validProps(), popularity: -1 })).toThrow(
      InvariantViolationError,
    );
  });

  it('throws when createdAt is invalid', () => {
    expect(() => Product.create({ ...validProps(), createdAt: new Date('not-a-date') })).toThrow(
      InvariantViolationError,
    );
  });
});
