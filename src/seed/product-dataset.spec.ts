import { loadProducts, type RawProduct } from './product-dataset';

const validRecord: RawProduct = {
  id: 'p-1',
  name: 'Cordless Drill',
  description: 'A powerful drill',
  category: 'Tools',
  subcategories: ['Power Tools'],
  location: 'Berlin',
  price: 99.99,
  popularity: 10,
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('loadProducts', () => {
  it('builds domain products from valid records', () => {
    // Act
    const { products, invalid } = loadProducts([validRecord]);

    // Assert
    expect(products).toHaveLength(1);
    expect(invalid).toHaveLength(0);
    expect(products[0].price.toNumber()).toBe(99.99);
  });

  it('collects invalid records with a reason instead of throwing', () => {
    // Arrange
    const badRecord = { ...validRecord, id: 'p-2', price: -5 };

    // Act
    const { products, invalid } = loadProducts([validRecord, badRecord]);

    // Assert
    expect(products).toHaveLength(1);
    expect(invalid).toEqual([{ id: 'p-2', reason: expect.stringMatching(/non-negative/) }]);
  });
});
