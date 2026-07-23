# Load-test harness

A [k6](https://k6.io) battery for the Advanced Product Search API, plus a low-rate smoke run for the
deployed service. Results from the 2026-07-23 execution are written up in
[`docs/LOAD-TEST-2026-07-23.md`](../docs/LOAD-TEST-2026-07-23.md).

## What is here

| File | Purpose |
|---|---|
| `battery.js` | Seven scenarios against a local stack — the capacity test |
| `smoke.js` | Low-rate correctness run against the deployment — **not** a capacity test |
| `lib/workload.js` | Query pools and request builders, derived from the seeded dataset |
| `lib/checks.js` | Response validators (status **and** payload contract) |
| `report.mjs` | Renders `results/*.json` into a Markdown table |
| `results/` | `--summary-export` output plus the generated `REPORT.md` |

The harness is deliberately **outside `src/`** and written in plain JavaScript: it adds no npm dependency, is
not part of the TypeScript build, and nothing in the application imports it. It only issues `GET`s against the
public contract, so it cannot mutate the index.

## Running it

Prerequisites: k6 on `PATH`, and for the local battery the stack up **and seeded**.

```bash
docker compose up -d elasticsearch redis
npm run seed
npm run build && npm start          # measure the compiled app, not ts-node-dev

npm run loadtest                    # local battery  (~4 min)
npm run loadtest:smoke              # production smoke (~30 s)
node loadtest/report.mjs --out loadtest/results/REPORT.md
```

Overrides: `-e BASE_URL=http://localhost:3000` to retarget, `-e VUS=20` to change the steady load.

## Method

**Scenarios run one at a time.** Each has a staggered `startTime` five seconds after the previous one ends, so
a scenario's latency describes its own code path rather than contention with the others.

**The cache is addressed head-on.** `/search` is cache-aside with a 300 s TTL, so repeating one query measures
Redis and says nothing about Elasticsearch. The battery therefore separates the two deliberately:

- `search_cold`, `facets_cold`, `browse_paged` vary their parameters so each request normalizes to a distinct
  cache key and reaches the engine. The API rejects unknown query params (`forbidNonWhitelisted` ⇒ 400), so a
  junk cache-buster is not available — the variation rides on `minPrice` in cent steps.
- `search_warm` repeats a single query on purpose, to measure the cache hot path.

That split was verified against Redis rather than assumed — 50 varied requests produced **0 keyspace hits, 50
misses and 50 keys**, while 50 identical ones produced **49 hits, 1 miss and 1 key**.

**Checks validate the contract, not just the status code.** A run that only asserts `200` reports a happy
service while it returns empty bodies; every response is checked for its documented shape, and a failed check
fails the run through the `checks` threshold.

**Thresholds are declared up front** as pass/fail SLOs, per scenario. Declaring them is also what makes k6
emit the per-scenario latency breakdown in the summary.

**Production gets a smoke run only.** The deployment is a free Render instance in front of metered Elastic
Cloud and Upstash: load-testing it would spend real quota and mostly measure the hosting tier. The smoke run
is capped at 2 req/s for 30 s and wakes the instance in `setup()`, so the free tier's spin-up (up to a minute)
is not counted as service latency.

## Limitations to read before quoting the numbers

- **One machine.** k6, the API, Elasticsearch and Redis share the same laptop, so the load generator competes
  with the server for CPU. Absolute figures would improve with a dedicated generator; the comparison *between*
  scenarios is the meaningful part.
- **A 24-document index.** The seeded corpus is tiny, so retrieval is nearly free and what the battery really
  measures is the service's own overhead — HTTP pipeline, validation, query assembly, aggregation handling and
  serialization. Scaling the corpus changes Elasticsearch's contribution, not the shape of this code.
- **Closed-loop model.** `constant-vus` measures latency at a fixed concurrency; it does not simulate an
  arrival rate that keeps coming when the service slows down. `smoke.js` uses `constant-arrival-rate` instead.
