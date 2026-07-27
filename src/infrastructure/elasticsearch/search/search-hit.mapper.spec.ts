import { UpstreamResponseError } from '@application/errors/application.error';
import { toProductSummary } from './search-hit.mapper';

const source = {
  id: 'tool-001',
  name: 'Cordless Drill 18V',
  description: 'Compact 18V brushless cordless drill',
  category: 'Tools',
  subcategories: ['Power Tools'],
  location: 'Berlin',
  price: 149.99,
  popularity: 87,
  createdAt: '2026-03-14T00:00:00.000Z',
};

describe('toProductSummary', () => {
  it('maps the document and stamps the currency the index does not carry', () => {
    // Arrange & Act
    const summary = toProductSummary({ _id: '1', _source: source, _score: 12.5 } as never);

    // Assert
    expect(summary).toMatchObject({ ...source, currency: 'USD', score: 12.5 });
  });

  it('omits score entirely when browsing, rather than reporting a null relevance', () => {
    // Arrange & Act
    const summary = toProductSummary({ _id: '1', _source: source, _score: null } as never);

    // Assert
    expect(summary).not.toHaveProperty('score');
  });

  it('keeps a zero score, which is a real relevance value and not "missing"', () => {
    // Arrange & Act
    const summary = toProductSummary({ _id: '1', _source: source, _score: 0 } as never);

    // Assert
    expect(summary.score).toBe(0);
  });

  it('throws a typed upstream error when the engine returns a hit without _source', () => {
    // Arrange & Act & Assert: mapped to 502, not the 500 a bare Error would give.
    expect(() => toProductSummary({ _id: 'abc' } as never)).toThrow(UpstreamResponseError);
    expect(() => toProductSummary({ _id: 'abc' } as never)).toThrow(/abc/);
  });

  it('names the unknown hit when even the id is missing', () => {
    // Arrange & Act & Assert
    expect(() => toProductSummary({} as never)).toThrow(/\(unknown\)/);
  });
});
