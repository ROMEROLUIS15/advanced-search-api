import { toAutocompleteItems } from './autocomplete-hit.mapper';

describe('toAutocompleteItems', () => {
  it('maps hits to items, de-duplicating by name and preserving order', () => {
    const hits: any = [
      { _score: 3, _source: { name: 'Cordless Drill' } },
      { _score: 2, _source: { name: 'Hammer Drill' } },
      { _score: 1, _source: { name: 'Cordless Drill' } },
      { _score: 1, _source: undefined },
    ];

    expect(toAutocompleteItems(hits)).toEqual([
      { text: 'Cordless Drill', score: 3 },
      { text: 'Hammer Drill', score: 2 },
    ]);
  });
});
