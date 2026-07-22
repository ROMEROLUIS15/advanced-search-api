import { buildAutocompleteQuery } from './autocomplete-query.builder';

describe('buildAutocompleteQuery', () => {
  it('builds a bool_prefix multi_match over the suggest sub-fields', () => {
    expect(buildAutocompleteQuery('dri')).toEqual({
      multi_match: {
        query: 'dri',
        type: 'bool_prefix',
        fields: ['name.suggest', 'name.suggest._2gram', 'name.suggest._3gram'],
      },
    });
  });
});
