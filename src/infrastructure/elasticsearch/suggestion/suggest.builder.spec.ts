import { buildSuggest } from './suggest.builder';

describe('buildSuggest', () => {
  const suggest: any = buildSuggest('driil');

  it('applies the query text to the suggesters', () => {
    expect(suggest.text).toBe('driil');
  });

  it('builds a phrase suggester with a collate query over the trigram field', () => {
    expect(suggest.did_you_mean.phrase.field).toBe('suggest_text.trigram');
    expect(suggest.did_you_mean.phrase.collate.query.source).toContain('{{suggestion}}');
    expect(suggest.did_you_mean.phrase.collate.prune).toBe(true);
  });

  it('builds a term suggester for related alternatives', () => {
    expect(suggest.related.term.field).toBe('suggest_text');
  });
});
