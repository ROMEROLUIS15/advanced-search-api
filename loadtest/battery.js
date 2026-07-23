import http from 'k6/http';
import {
  autocompleteQuery,
  browseQuery,
  coldSearchQuery,
  facetSearchQuery,
  qs,
  seq,
  suggestQuery,
  warmSearchQuery,
} from './lib/workload.js';
import { checkAutocomplete, checkSearch, checkSuggest } from './lib/checks.js';

/**
 * Load-test battery for the Advanced Product Search API.
 *
 * Read-only: it only issues GETs against the public contract, so it cannot mutate
 * the index or the service. Nothing here is imported by the application — the
 * harness lives entirely outside `src/`.
 *
 * The scenarios run ONE AT A TIME (staggered `startTime`, five seconds apart) so a
 * scenario's latency describes its own code path instead of contention with the
 * others. `search_warm` is the deliberate exception to the cache rule: it repeats a
 * single query to measure the Redis hot path, while every other search scenario
 * varies its parameters so the request reaches Elasticsearch.
 *
 * Run: `k6 run loadtest/battery.js` (override with `-e BASE_URL=...`).
 */

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

const STEADY_VUS = Number(__ENV.VUS || 10);

export const options = {
  // p(99) is not in k6's default set, and the tail is the interesting part.
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  // Fail the run on a body that does not honour the contract, not just on a 5xx.
  thresholds: {
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
    // Declaring a threshold per scenario is also what makes k6 emit the
    // per-scenario latency breakdown in the end-of-run summary.
    'http_req_duration{scenario:search_cold}': ['p(95)<400'],
    'http_req_duration{scenario:search_warm}': ['p(95)<60'],
    'http_req_duration{scenario:facets_cold}': ['p(95)<400'],
    'http_req_duration{scenario:browse_paged}': ['p(95)<300'],
    'http_req_duration{scenario:autocomplete}': ['p(95)<150'],
    'http_req_duration{scenario:suggest}': ['p(95)<200'],
    'http_req_duration{scenario:mixed_ramp}': ['p(95)<800'],
  },
  scenarios: {
    search_cold: {
      executor: 'constant-vus',
      vus: STEADY_VUS,
      duration: '30s',
      startTime: '0s',
      exec: 'searchCold',
    },
    search_warm: {
      executor: 'constant-vus',
      vus: STEADY_VUS,
      duration: '20s',
      startTime: '35s',
      exec: 'searchWarm',
    },
    facets_cold: {
      executor: 'constant-vus',
      vus: STEADY_VUS,
      duration: '30s',
      startTime: '60s',
      exec: 'facetsCold',
    },
    browse_paged: {
      executor: 'constant-vus',
      vus: STEADY_VUS,
      duration: '20s',
      startTime: '95s',
      exec: 'browsePaged',
    },
    autocomplete: {
      executor: 'constant-vus',
      vus: STEADY_VUS,
      duration: '20s',
      startTime: '120s',
      exec: 'autocomplete',
    },
    suggest: {
      executor: 'constant-vus',
      vus: STEADY_VUS,
      duration: '20s',
      startTime: '145s',
      exec: 'suggest',
    },
    // Ramp to find where the service bends, using a realistic blend of traffic.
    mixed_ramp: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '20s', target: 10 },
        { duration: '20s', target: 25 },
        { duration: '20s', target: 50 },
      ],
      startTime: '170s',
      exec: 'mixed',
    },
  },
};

/**
 * Every request carries an explicit `name` tag. The workload varies `minPrice` per
 * request on purpose, so tagging by raw URL would make each request its own metric
 * series (k6 warns past 100k of them); the name tag groups them by endpoint, which
 * is k6's documented URL-grouping remedy.
 */
function get(path, params, name) {
  return http.get(`${BASE_URL}${path}?${qs(params)}`, { tags: { name: name || path } });
}

export function searchCold() {
  checkSearch(get('/search', coldSearchQuery(seq(__VU, __ITER, 1)), 'GET /search (varied)'));
}

export function searchWarm() {
  checkSearch(get('/search', warmSearchQuery(), 'GET /search (repeated)'));
}

export function facetsCold() {
  checkSearch(get('/search', facetSearchQuery(seq(__VU, __ITER, 2)), 'GET /search (faceted)'));
}

export function browsePaged() {
  checkSearch(get('/search', browseQuery(seq(__VU, __ITER, 3)), 'GET /search (browse)'));
}

export function autocomplete() {
  checkAutocomplete(get('/autocomplete', autocompleteQuery(seq(__VU, __ITER, 4)), 'GET /autocomplete'));
}

export function suggest() {
  checkSuggest(get('/suggest', suggestQuery(seq(__VU, __ITER, 5)), 'GET /suggest'));
}

/** Roughly the shape of real traffic: mostly search, a slice of type-ahead. */
export function mixed() {
  const n = seq(__VU, __ITER, 6);
  const roll = n % 10;
  if (roll < 5) {
    checkSearch(get('/search', coldSearchQuery(n), 'GET /search (varied)'));
  } else if (roll < 7) {
    checkSearch(get('/search', facetSearchQuery(n), 'GET /search (faceted)'));
  } else if (roll < 9) {
    checkAutocomplete(get('/autocomplete', autocompleteQuery(n), 'GET /autocomplete'));
  } else {
    checkSuggest(get('/suggest', suggestQuery(n), 'GET /suggest'));
  }
}
