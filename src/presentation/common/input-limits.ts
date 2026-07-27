/**
 * Upper bounds for the free-text query parameters, applied by the DTOs (design D11).
 *
 * These are not cosmetic. `/search` builds a `multi_match` with `fuzziness: AUTO`
 * (design D3), and Lucene refuses to build the fuzzy automaton for a single token
 * past roughly 2 KB. Elasticsearch then answers 400, which reached the client as a
 * **502** — an upstream failure reported for what is really bad input, logged with
 * a stack and pointing monitoring at a healthy cluster. Measured against the
 * deployment before the fix: 2000 characters answered 200, 3000 answered 502.
 *
 * Capping at the edge turns that into a plain validation 400 and keeps the
 * oversized term from reaching Elasticsearch at all.
 */
export const MAX_QUERY_LENGTH = 256;

/** Filter values are matched as keywords; the indexed vocabulary is far shorter. */
export const MAX_TERM_LENGTH = 128;

/** A facet dimension holds a handful of values; a longer list is not a real filter. */
export const MAX_SUBCATEGORIES = 20;
