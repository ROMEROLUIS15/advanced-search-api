import { buildSort } from './sort.builder';

describe('buildSort', () => {
  it('sorts by score then id for relevance', () => {
    expect(buildSort('relevance', 'desc')).toEqual([
      { _score: { order: 'desc' } },
      { id: { order: 'asc' } },
    ]);
  });

  it('sorts by popularity with a score+id tiebreaker for stable pagination', () => {
    expect(buildSort('popularity', 'desc')).toEqual([
      { popularity: { order: 'desc' } },
      { _score: { order: 'desc' } },
      { id: { order: 'asc' } },
    ]);
  });

  it('sorts by created_at with a stable tiebreaker', () => {
    expect(buildSort('created_at', 'asc')).toEqual([
      { createdAt: { order: 'asc' } },
      { _score: { order: 'desc' } },
      { id: { order: 'asc' } },
    ]);
  });
});
