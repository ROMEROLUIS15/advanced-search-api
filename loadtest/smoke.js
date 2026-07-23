import http from 'k6/http';
import { sleep } from 'k6';
import {
  autocompleteQuery,
  coldSearchQuery,
  facetSearchQuery,
  qs,
  seq,
  suggestQuery,
} from './lib/workload.js';
import { checkAutocomplete, checkHealth, checkSearch, checkSuggest } from './lib/checks.js';

/**
 * Production smoke run — deliberately NOT a capacity test.
 *
 * The deployed service sits on Render's free instance type in front of an Elastic
 * Cloud Serverless project and an Upstash Redis, all metered. Hammering it would
 * spend real quota and would mostly measure the free tier, so this run is capped at
 * a low, constant arrival rate: it answers "is the deployment healthy and correct
 * end to end, and what does a user actually wait?" — not "how much can it take?".
 * Capacity questions belong to `battery.js` against the local stack.
 *
 * Run: `k6 run loadtest/smoke.js`
 */

const BASE_URL = __ENV.BASE_URL || 'https://advanced-search-api-chet.onrender.com';

export const options = {
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  scenarios: {
    smoke: {
      executor: 'constant-arrival-rate',
      rate: 2,
      timeUnit: '1s',
      duration: '30s',
      preAllocatedVUs: 5,
      maxVUs: 10,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.02'],
    checks: ['rate>0.99'],
    // Internet round-trip + a shared free instance: judged on user-visible latency,
    // not on the local-stack budget.
    http_req_duration: ['p(95)<1500'],
  },
};

/**
 * The free instance spins down when idle and the first request after a pause can
 * take about a minute. That wake-up is a property of the hosting tier, not of the
 * service, so it happens in setup() where it is not part of the measurements.
 */
export function setup() {
  const started = Date.now();
  const res = http.get(`${BASE_URL}/health`, { timeout: '120s' });
  const wakeMs = Date.now() - started;
  if (res.status !== 200) {
    throw new Error(`Deployment is not healthy: GET /health returned ${res.status}`);
  }
  return { wakeMs, coldStart: wakeMs > 5000 };
}

/** Grouped by `name` so varied query strings stay one metric series per endpoint. */
function get(path, params, name) {
  return http.get(`${BASE_URL}${path}?${qs(params)}`, { tags: { name } });
}

export default function () {
  const n = seq(__VU, __ITER, 7);
  const roll = n % 8;
  if (roll < 3) {
    checkSearch(get('/search', coldSearchQuery(n), 'GET /search (varied)'));
  } else if (roll < 5) {
    checkSearch(get('/search', facetSearchQuery(n), 'GET /search (faceted)'));
  } else if (roll < 6) {
    checkAutocomplete(get('/autocomplete', autocompleteQuery(n), 'GET /autocomplete'));
  } else if (roll < 7) {
    checkSuggest(get('/suggest', suggestQuery(n), 'GET /suggest'));
  } else {
    checkHealth(get('/health', {}, 'GET /health'));
  }
  sleep(0.1);
}
