import { toSuggestions } from './suggest-response.mapper';

describe('toSuggestions', () => {
  it('returns nulls/empties when the suggest block is absent', () => {
    expect(toSuggestions(undefined)).toEqual({ didYouMean: null, related: [] });
  });

  it('maps phrase options to didYouMean and term options to related (deduped)', () => {
    const suggest = {
      did_you_mean: [{ options: [{ text: 'drill' }] }],
      related: [
        { options: [{ text: 'drill' }, { text: 'drills' }] },
        { options: [{ text: 'drill' }] },
      ],
    };

    expect(toSuggestions(suggest)).toEqual({ didYouMean: 'drill', related: ['drill', 'drills'] });
  });

  it('returns null didYouMean when the phrase suggester has no options', () => {
    expect(toSuggestions({ did_you_mean: [{ options: [] }] })).toEqual({
      didYouMean: null,
      related: [],
    });
  });
});
