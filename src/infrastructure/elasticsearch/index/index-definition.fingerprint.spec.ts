import {
  FINGERPRINT_META_KEY,
  fingerprintDefinition,
  readFingerprint,
  withFingerprint,
  type IndexDefinition,
} from './index-definition.fingerprint';

function definition(overrides: Partial<IndexDefinition> = {}): IndexDefinition {
  return {
    settings: {
      analysis: {
        analyzer: {
          text_en: { type: 'custom', tokenizer: 'standard', filter: ['lowercase', 'asciifolding'] },
        },
      },
    },
    mappings: {
      properties: {
        id: { type: 'keyword' },
        name: { type: 'text', analyzer: 'text_en' },
      },
    },
    ...overrides,
  };
}

describe('fingerprintDefinition', () => {
  it('is stable across separately built but identical definitions', () => {
    expect(fingerprintDefinition(definition())).toBe(fingerprintDefinition(definition()));
  });

  it('changes when an analyzer changes', () => {
    const tuned = definition({
      settings: {
        analysis: {
          analyzer: {
            text_en: {
              type: 'custom',
              tokenizer: 'whitespace',
              filter: ['lowercase', 'asciifolding'],
            },
          },
        },
      },
    });

    expect(fingerprintDefinition(tuned)).not.toBe(fingerprintDefinition(definition()));
  });

  it('changes when a field type changes', () => {
    const retyped = definition({
      mappings: { properties: { id: { type: 'keyword' }, name: { type: 'keyword' } } },
    });

    expect(fingerprintDefinition(retyped)).not.toBe(fingerprintDefinition(definition()));
  });

  it('ignores the order object keys were written in', () => {
    const reordered = definition({
      mappings: {
        properties: {
          name: { analyzer: 'text_en', type: 'text' },
          id: { type: 'keyword' },
        },
      },
    });

    expect(fingerprintDefinition(reordered)).toBe(fingerprintDefinition(definition()));
  });

  it('does not ignore array order, which is semantic in an analyzer chain', () => {
    const swapped = definition({
      settings: {
        analysis: {
          analyzer: {
            text_en: {
              type: 'custom',
              tokenizer: 'standard',
              filter: ['asciifolding', 'lowercase'],
            },
          },
        },
      },
    });

    expect(fingerprintDefinition(swapped)).not.toBe(fingerprintDefinition(definition()));
  });

  it('is unchanged by the `_meta` it will be written into', () => {
    const stamped = withFingerprint(definition());

    expect(fingerprintDefinition(stamped)).toBe(fingerprintDefinition(definition()));
  });
});

describe('withFingerprint', () => {
  it('records the digest under _meta without disturbing the definition', () => {
    const stamped = withFingerprint(definition());

    expect(stamped.mappings._meta?.[FINGERPRINT_META_KEY]).toBe(
      fingerprintDefinition(definition()),
    );
    expect(stamped.mappings.properties).toEqual(definition().mappings.properties);
    expect(stamped.settings).toEqual(definition().settings);
  });

  it('keeps any unrelated _meta already present', () => {
    const stamped = withFingerprint(
      definition({
        mappings: { _meta: { owner: 'catalog' }, properties: { id: { type: 'keyword' } } },
      }),
    );

    expect(stamped.mappings._meta?.owner).toBe('catalog');
    expect(stamped.mappings._meta?.[FINGERPRINT_META_KEY]).toEqual(expect.any(String));
  });
});

describe('readFingerprint', () => {
  it('returns the recorded digest', () => {
    expect(readFingerprint(withFingerprint(definition()).mappings)).toBe(
      fingerprintDefinition(definition()),
    );
  });

  it('returns undefined for an index provisioned before fingerprints existed', () => {
    expect(readFingerprint(definition().mappings)).toBeUndefined();
    expect(readFingerprint(undefined)).toBeUndefined();
  });

  it('treats a non-string digest as absent rather than trusting it', () => {
    expect(readFingerprint({ _meta: { [FINGERPRINT_META_KEY]: 42 } })).toBeUndefined();
  });
});
