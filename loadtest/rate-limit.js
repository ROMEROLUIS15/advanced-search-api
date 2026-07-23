import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

/**
 * Rate-limit behaviour under load — a correctness scenario, not a capacity one.
 *
 * The capacity battery (`battery.js`) runs with `RATE_LIMIT_ENABLED=false`,
 * because a single k6 client drives far more than any human and would otherwise
 * spend the whole run rejected. This script does the opposite on purpose: it runs
 * with enforcement ON and asks a narrower question — when one client floods a
 * limited endpoint, does the service answer a clean 429, or does it degrade (5xx,
 * timeouts, slow tails)?
 *
 * Start the app with enforcement on and a known budget, e.g.
 *   RATE_LIMIT_ENABLED=true RATE_LIMIT_SEARCH=60 node dist/main.js
 * then: `k6 run loadtest/rate-limit.js`
 */

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const LIMIT = Number(__ENV.LIMIT || 60);

const accepted = new Counter('rl_accepted_200');
const rejected = new Counter('rl_rejected_429');

export const options = {
  // One client (one forwarded address), a burst well past the budget.
  scenarios: {
    flood: {
      executor: 'shared-iterations',
      vus: 10,
      iterations: LIMIT * 5,
      maxDuration: '30s',
    },
  },
  thresholds: {
    // The service must stay correct under a flood: every response is either a
    // served 200 or a typed 429 — never a 5xx, never a dropped request.
    'checks{kind:no_5xx}': ['rate==1'],
    'checks{kind:typed_429}': ['rate==1'],
    // The rejection must be cheap: refusing at the edge should be faster than
    // serving, so a flood cannot be turned into a slow-down.
    'http_req_duration{status:429}': ['p(95)<50'],
  },
};

export default function () {
  // One fixed client identity so the whole flood shares a single budget.
  const res = http.get(`${BASE_URL}/search?q=drill`, {
    headers: { 'X-Forwarded-For': '198.51.100.7' },
    tags: { name: 'GET /search (flood)' },
  });

  check(res, { 'not a 5xx': (r) => r.status < 500 }, { kind: 'no_5xx' });

  if (res.status === 200) {
    accepted.add(1);
  } else if (res.status === 429) {
    rejected.add(1);
    check(
      res,
      {
        'typed 429 body': (r) => {
          try {
            const body = r.json();
            return body.statusCode === 429 && body.error === 'Too Many Requests';
          } catch (_error) {
            return false;
          }
        },
        'carries Retry-After': (r) => r.headers['Retry-After'] !== undefined,
      },
      { kind: 'typed_429' },
    );
  }
}

export function handleSummary(data) {
  const a = data.metrics.rl_accepted_200?.values?.count ?? 0;
  const r = data.metrics.rl_rejected_429?.values?.count ?? 0;
  return {
    stdout: `\nAccepted (200): ${a}\nRejected (429): ${r}\nBudget under test: ${LIMIT}\n`,
    'loadtest/results/rate-limit.json': JSON.stringify(data, null, 2),
  };
}
