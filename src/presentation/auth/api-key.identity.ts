import { createHash, timingSafeEqual } from 'node:crypto';

/** The header a client presents its key in. Not `Authorization`: `/metrics` uses that for another secret. */
export const API_KEY_HEADER = 'x-api-key';

/**
 * Resolves a presented key to a stable, non-reversible client id, or `undefined`
 * when the key is not one of the configured ones.
 */
export type KeyIdentifier = (presented: string | undefined) => string | undefined;

/**
 * Builds the key check once, at startup (design D33).
 *
 * Comparison runs over SHA-256 digests rather than the strings themselves for
 * two reasons: `timingSafeEqual` requires equal lengths, and comparing raw keys
 * would leak the length of the real one. Every candidate is compared against
 * every configured digest without an early exit on mismatch.
 *
 * The identifier it returns is a truncated digest, never the key: it travels
 * into the rate-limit counter and may be read by an operator debugging a
 * budget, and a credential has no business in either place (design D34).
 */
export function createKeyIdentifier(keys: readonly string[]): KeyIdentifier {
  const known = keys.map(toDigest);

  return (presented) => {
    if (presented === undefined || presented.length === 0) {
      return undefined;
    }
    const candidate = toDigest(presented);
    // reduce, not `some`: no short-circuit, so the work does not depend on
    // which position a matching key occupies.
    const matched = known.reduce(
      (found, digest) => (timingSafeEqual(digest, candidate) ? true : found),
      false,
    );
    return matched ? toClientId(candidate) : undefined;
  };
}

function toDigest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

function toClientId(digest: Buffer): string {
  return `key:${digest.toString('hex').slice(0, 16)}`;
}
