import { productIndexDefinition } from './product-index.mapping';

describe('productIndexDefinition', () => {
  const { settings, mappings } = productIndexDefinition();
  // Cast to a loose shape: these are ES data objects asserted by content.
  const analysis = settings.analysis as any;
  const properties = mappings.properties as any;

  it('defines the custom analyzers and filters (design D2)', () => {
    expect(analysis.analyzer).toHaveProperty('text_std');
    expect(analysis.analyzer).toHaveProperty('text_en');
    expect(analysis.analyzer).toHaveProperty('shingle_analyzer');
    expect(analysis.filter).toHaveProperty('english_stemmer');
    expect(analysis.filter).toHaveProperty('shingle_2_3');
  });

  it('configures custom analysis settings for full-text search', () => {
    expect(settings.analysis).toBeDefined();
  });

  it('maps name with a search_as_you_type sub-field and copies to the suggest corpus', () => {
    expect(properties.name.fields.suggest.type).toBe('search_as_you_type');
    expect(properties.name.copy_to).toContain('suggest_text');
  });

  it('stores price as a scaled_float for currency-safe values', () => {
    expect(properties.price.type).toBe('scaled_float');
    expect(properties.price.scaling_factor).toBe(100);
  });

  it('defines the suggest_text corpus with a trigram shingle sub-field', () => {
    expect(properties.suggest_text.fields.trigram.analyzer).toBe('shingle_analyzer');
  });
});
