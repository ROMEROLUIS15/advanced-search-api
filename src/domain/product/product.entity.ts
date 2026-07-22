import { InvariantViolationError } from '../errors/domain.error';
import { Money } from './money.value-object';

export interface ProductProps {
  id: string;
  name: string;
  description: string;
  category: string;
  subcategories: string[];
  location: string;
  price: Money;
  popularity: number;
  createdAt: Date;
}

/**
 * Product aggregate. Pure and framework-free. Invariants: non-empty id/name,
 * `price >= 0` (enforced by {@link Money}), non-negative integer popularity, and
 * a valid `createdAt`. Instances are immutable; collections are defensively copied.
 */
export class Product {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: string;
  readonly subcategories: readonly string[];
  readonly location: string;
  readonly price: Money;
  readonly popularity: number;
  readonly createdAt: Date;

  private constructor(props: ProductProps) {
    this.id = props.id;
    this.name = props.name;
    this.description = props.description;
    this.category = props.category;
    this.subcategories = [...props.subcategories];
    this.location = props.location;
    this.price = props.price;
    this.popularity = props.popularity;
    this.createdAt = new Date(props.createdAt.getTime());
  }

  static create(props: ProductProps): Product {
    if (props.id.trim().length === 0) {
      throw new InvariantViolationError('Product id must not be empty');
    }
    if (props.name.trim().length === 0) {
      throw new InvariantViolationError('Product name must not be empty');
    }
    if (!Number.isInteger(props.popularity) || props.popularity < 0) {
      throw new InvariantViolationError('Product popularity must be a non-negative integer');
    }
    if (Number.isNaN(props.createdAt.getTime())) {
      throw new InvariantViolationError('Product createdAt must be a valid date');
    }
    return new Product(props);
  }
}
