/**
 * Shared workload definitions for the k6 battery.
 *
 * Every value below comes from the seeded dataset (`src/seed/dataset/products.seed.json`):
 * 24 products, 7 categories, 6 locations. Requests are derived deterministically from the
 * (VU, iteration) pair rather than sampled at random, so two runs of the same scenario issue
 * the same sequence of requests and their numbers are comparable.
 */

export const TERMS = [
  'drill',
  'hammer',
  'wrench',
  'grinder',
  'headphones',
  'monitor',
  'keyboard',
  'chair',
  'desk',
  'knife',
  'pan',
  'coffee',
  'mower',
  'hose',
  'yoga',
  'helmet',
  'camera',
  'speaker',
  'printer',
  'cordless',
];

/** Misspellings that force the term/phrase suggesters to do real work. */
export const TYPOS = [
  'driil',
  'hammar',
  'wrenc',
  'grindar',
  'headfones',
  'moniter',
  'keybord',
  'cofee',
];

/** Type-ahead prefixes, short enough to match several documents each. */
export const PREFIXES = ['co', 'cor', 'dri', 'ham', 'wre', 'hea', 'mon', 'key', 'des', 'kni', 'yog'];

export const CATEGORIES = [
  'Electronics',
  'Furniture',
  'Garden',
  'Kitchen',
  'Office',
  'Sports',
  'Tools',
];
export const LOCATIONS = ['Berlin', 'Cologne', 'Frankfurt', 'Hamburg', 'Munich', 'Stuttgart'];
export const SUBCATEGORIES = [
  'Power Tools',
  'Drills',
  'Hand Tools',
  'Audio',
  'Computing',
  'Chairs',
  'Desks',
  'Cookware',
  'Knives',
  'Fitness',
  'Cycling',
  'Watering',
];
export const SORTS = ['relevance', 'popularity', 'created_at'];

/** Deterministic, well-spread counter from the (VU, iteration) pair. */
export function seq(vu, iter, salt) {
  return Math.abs((vu * 2654435761 + iter * 40503 + salt * 97) % 1000000);
}

export function pick(list, n) {
  return list[n % list.length];
}

/**
 * A `/search` that deliberately MISSES the Redis cache.
 *
 * The API rejects unknown query params (`forbidNonWhitelisted` => 400), so a junk
 * cache-buster is not available: the variation has to ride on a real parameter.
 * `minPrice` moves in cent steps, so each request normalizes to its own cache key
 * (`search:v1:<sha1>`) and the full Elasticsearch round-trip — hits + facet
 * aggregations + suggest in one request body — is what gets measured.
 */
export function coldSearchQuery(n) {
  return {
    q: pick(TERMS, n),
    minPrice: (n % 4000) / 100,
    sort: pick(SORTS, n >> 2),
    page: 1 + (n % 2),
  };
}

/** The same `/search` every time: after the first request this is served by Redis. */
export function warmSearchQuery() {
  return { q: 'drill', category: 'Tools', sort: 'relevance', page: 1 };
}

/**
 * Multi-dimension filtering: the facet path where each aggregation re-applies every
 * other selected filter except its own dimension (design D4) — the most expensive
 * aggregation shape the service can be asked for.
 */
export function facetSearchQuery(n) {
  return {
    q: pick(TERMS, n),
    category: pick(CATEGORIES, n),
    subcategory: pick(SUBCATEGORIES, n >> 1),
    location: pick(LOCATIONS, n >> 2),
    minPrice: (n % 3000) / 100,
    maxPrice: 500,
  };
}

/** Browse mode: no `q`, so `match_all` + sort, walking pages. */
export function browseQuery(n) {
  return {
    category: pick(CATEGORIES, n),
    sort: pick(SORTS, n >> 1),
    order: n % 2 === 0 ? 'desc' : 'asc',
    page: 1 + (n % 3),
    pageSize: 10,
  };
}

export function autocompleteQuery(n) {
  return { q: pick(PREFIXES, n), limit: 10 };
}

export function suggestQuery(n) {
  return { q: pick(TYPOS, n) };
}

/** `?a=1&b=2` from a plain object, skipping undefined values. */
export function qs(params) {
  const parts = [];
  for (const key of Object.keys(params)) {
    const value = params[key];
    if (value !== undefined && value !== null) {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts.join('&');
}
