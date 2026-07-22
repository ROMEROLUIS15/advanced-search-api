import type { estypes } from '@elastic/elasticsearch';

/**
 * Index settings + mappings (design D2). Pure data: multi-field mapping so each
 * field serves matching (analyzed `text`), filtering/faceting (`keyword`), and
 * dedicated autocomplete/suggestion sub-fields. `name`/`category`/`subcategories`
 * `copy_to` the `suggest_text` corpus feeding the term/phrase suggesters.
 *
 * 1 shard / 0 replicas keeps trial clusters green and scoring deterministic (D1).
 */
export function productIndexDefinition(): {
  settings: estypes.IndicesIndexSettings;
  mappings: estypes.MappingTypeMapping;
} {
  return { settings: indexSettings(), mappings: indexMappings() };
}

function indexSettings(): estypes.IndicesIndexSettings {
  return {
    analysis: {
      analyzer: {
        text_std: { type: 'custom', tokenizer: 'standard', filter: ['lowercase', 'asciifolding'] },
        text_en: {
          type: 'custom',
          tokenizer: 'standard',
          filter: ['lowercase', 'asciifolding', 'english_stop', 'english_stemmer'],
        },
        shingle_analyzer: {
          type: 'custom',
          tokenizer: 'standard',
          filter: ['lowercase', 'asciifolding', 'shingle_2_3'],
        },
      },
      filter: {
        english_stop: { type: 'stop', stopwords: '_english_' },
        english_stemmer: { type: 'stemmer', language: 'light_english' },
        shingle_2_3: { type: 'shingle', min_shingle_size: 2, max_shingle_size: 3 },
      },
    },
  };
}

function indexMappings(): estypes.MappingTypeMapping {
  return {
    properties: {
      id: { type: 'keyword' },
      name: {
        type: 'text',
        analyzer: 'text_en',
        copy_to: ['suggest_text'],
        fields: {
          std: { type: 'text', analyzer: 'text_std' },
          kw: { type: 'keyword' },
          suggest: { type: 'search_as_you_type', analyzer: 'text_std' },
        },
      },
      description: { type: 'text', analyzer: 'text_en' },
      category: {
        type: 'keyword',
        copy_to: ['suggest_text'],
        fields: { text: { type: 'text', analyzer: 'text_en' } },
      },
      subcategories: {
        type: 'keyword',
        copy_to: ['suggest_text'],
        fields: { text: { type: 'text', analyzer: 'text_en' } },
      },
      location: { type: 'keyword', fields: { text: { type: 'text', analyzer: 'text_std' } } },
      price: { type: 'scaled_float', scaling_factor: 100 },
      popularity: { type: 'integer' },
      createdAt: { type: 'date' },
      suggest_text: {
        type: 'text',
        analyzer: 'text_std',
        fields: { trigram: { type: 'text', analyzer: 'shingle_analyzer' } },
      },
    },
  };
}
