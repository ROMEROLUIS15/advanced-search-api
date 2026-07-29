import { createHash } from 'node:crypto';
import type { estypes } from '@elastic/elasticsearch';

/** Key under `mappings._meta` where the digest of the definition is recorded. */
export const FINGERPRINT_META_KEY = 'definitionFingerprint';

export interface IndexDefinition {
  settings: estypes.IndicesIndexSettings;
  mappings: estypes.MappingTypeMapping;
}

/**
 * Digest of an index definition (design D43). The seed compares this against the
 * value recorded on the live index to decide whether a migration is due, so it
 * must change when — and only when — the definition really changes.
 *
 * `_meta` is stripped before hashing because the digest is written back into it:
 * hashing an object that carries its own digest has no fixed point.
 */
export function fingerprintDefinition(definition: IndexDefinition): string {
  const canonical = JSON.stringify(
    canonicalize({ settings: definition.settings, mappings: withoutMeta(definition.mappings) }),
  );
  return createHash('sha256').update(canonical).digest('hex');
}

/** The same definition with its own digest recorded under `mappings._meta`. */
export function withFingerprint(definition: IndexDefinition): IndexDefinition {
  return {
    settings: definition.settings,
    mappings: {
      ...definition.mappings,
      _meta: {
        ...definition.mappings._meta,
        [FINGERPRINT_META_KEY]: fingerprintDefinition(definition),
      },
    },
  };
}

/**
 * The digest recorded on a live index, or `undefined` when it carries none —
 * which is the case for any index provisioned before D43 shipped, and is treated
 * as a mismatch so that index migrates once.
 */
export function readFingerprint(
  mappings: estypes.MappingTypeMapping | undefined,
): string | undefined {
  // `_meta` is `Record<string, any>` in estypes; narrowing its values to `unknown`
  // right here is what stops that `any` leaking into the rest of the module.
  const meta: Record<string, unknown> | undefined = mappings?._meta;
  const recorded = meta?.[FINGERPRINT_META_KEY];
  return typeof recorded === 'string' ? recorded : undefined;
}

function withoutMeta(mappings: estypes.MappingTypeMapping): estypes.MappingTypeMapping {
  const copy: estypes.MappingTypeMapping = { ...mappings };
  delete copy._meta;
  return copy;
}

/**
 * Object keys are sorted so that a reordered definition hashes equal; array order
 * is preserved because it is semantic in Elasticsearch — an analyzer's filter
 * chain applies in the order given, so `[lowercase, asciifolding]` and its reverse
 * are different definitions, not different spellings of one.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (typeof value === 'object' && value !== null) {
    const entries = value as Record<string, unknown>;
    return Object.keys(entries)
      .sort()
      .reduce<Record<string, unknown>>((canonical, key) => {
        canonical[key] = canonicalize(entries[key]);
        return canonical;
      }, {});
  }
  return value;
}
