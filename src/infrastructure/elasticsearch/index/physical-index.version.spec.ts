import { IndexMigrationError } from './index-migration.error';
import {
  nextPhysicalVersion,
  parsePhysicalIndexVersion,
  physicalIndexName,
} from './physical-index.version';

describe('physicalIndexName', () => {
  it('spells the physical name from the alias and the version', () => {
    expect(physicalIndexName('products', 1)).toBe('products_v1');
    expect(physicalIndexName('products', 12)).toBe('products_v12');
  });
});

describe('parsePhysicalIndexVersion', () => {
  it.each([
    ['products_v1', 1],
    ['products_v2', 2],
    ['products_v10', 10],
  ])('reads the version out of %s', (physicalIndex, expected) => {
    expect(parsePhysicalIndexVersion('products', physicalIndex)).toBe(expected);
  });

  it('accepts an alias containing an underscore', () => {
    expect(parsePhysicalIndexVersion('shop_products', 'shop_products_v3')).toBe(3);
  });

  it.each([
    ['products_hand_made', 'no version suffix'],
    ['products_v', 'empty version'],
    ['products_vX', 'non-numeric version'],
    ['products_v0', 'version below 1'],
    ['other_v1', 'a different alias'],
  ])('refuses to guess from %s (%s)', (physicalIndex) => {
    expect(() => parsePhysicalIndexVersion('products', physicalIndex)).toThrow(IndexMigrationError);
  });
});

describe('nextPhysicalVersion', () => {
  it('starts at 1 when nothing is provisioned, so an existing _v1 is adopted rather than orphaned', () => {
    expect(nextPhysicalVersion(undefined)).toBe(1);
  });

  it('increments the live version', () => {
    expect(nextPhysicalVersion(1)).toBe(2);
    expect(nextPhysicalVersion(9)).toBe(10);
  });
});
