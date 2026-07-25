# Hardening — 2026-07-25

Observability, process resilience, and a four-layer security scanning pipeline, added on top of the audited
deliverable (see [`AUDIT-2026-07-23.md`](AUDIT-2026-07-23.md)). Like the audit, **every number below was
produced by running the command or scan named next to it**, not by reading the code and inferring — measured
locally, in CI, and against the live deployment.

Seven commits, all on `main` and pushed:

| Commit | Type | What |
|---|---|---|
| `66206f6` | feat(errors) | Log 4xx responses as warnings, not only 5xx |
| `7bb53e0` | docs | Refresh `CLAUDE.md` (design record, commands, 4xx logging) |
| `241ce94` | feat(resilience) | Catch failures outside the HTTP request cycle |
| `dc78e72` | feat(openapi) | Publish the OpenAPI contract at `/docs` and `/docs-json` |
| `2e7ede1` | ci(security) | Add SAST, SCA, secret and DAST scanning |
| `551c10b` | docs | Document the security pipeline and OpenAPI in `CLAUDE.md` |
| `5370f84` | ci(security) | Rename the DAST job to api-scan, matching its command |

Net change: **14 files, +585 / −22**. Three new source files, four new CI/security config files, one new
dependency (`@nestjs/swagger`).

---

## 1 · Error observability — 4xx responses now leave a trace (`66206f6`)

**Problem (measured, not assumed).** The request pipeline had a blind spot: `AllExceptionsFilter` logged only
`>= 500`, and `LoggingInterceptor` uses `tap()`, which fires only on the success path. So a request that ended
in a 4xx — a validation 400, a deep-pagination 422, a rate-limit 429 — left **no trace at all** in the logs. A
client looping on 400s or someone hitting the limiter was invisible in production.

**Change.** The filter is the single place an errored request is logged (the interceptor never sees the error
path), so the fix went there: `logException()` splits by resolved status — `>= 500` logs as `error` with the
stack (client still gets a generic message), `>= 400` logs as `warn` with a compact reason (validation details,
else the message). Numeric bounds (`>= 500`, `>= 400`), not `HttpStatus` members, because comparing a `number`
against the enum trips `no-unsafe-enum-comparison` (a comment records this so nobody "improves" it back).

**Verified.** Three new specs in `all-exceptions.filter.spec.ts` (4xx → warn with reason; validation details
summarized; 5xx still error). Confirmed live during the local run:

```
WARN [AllExceptionsFilter] GET /search?q=drill&pageSize=999 -> 400 pageSize must not exceed 100
```

---

## 2 · Process resilience — a safety net outside the request cycle (`241ce94`)

**Problem.** `AllExceptionsFilter` only covers Nest's per-request exception zone. A failure *outside* a request
— an unhandled promise rejection, an uncaught exception (e.g. from a client event listener) — bypassed it
entirely, leaving no log and an indeterminate process. `grep` confirmed there were **no** `process.on(...)`
handlers anywhere in `src/`.

**Change.** `src/process-safety-net.ts`: `installProcessSafetyNet(app)` registers `unhandledRejection` and
`uncaughtException` handlers that log the failure, close the app (so shutdown hooks release the ES/Redis
connections), then `process.exit(1)` for the orchestrator to restart a clean process. A re-entry guard stops a
second event starting a concurrent shutdown. Wired from `main.ts` **only**, never `configureApp` — otherwise
every e2e boot would stack another listener.

**Safe for the Redis fail-open (D8), verified before writing it.** The concern was that killing the process on
error could break Redis's non-critical status. Reading the code settled it: the ioredis client already
registers its own `'error'` listener (`redis.client.factory.ts:21`) and cache operations go through
`cacheAside`, so a Redis outage is handled there and never reaches these process-level handlers.

**Verified in two ways.** Four new specs in `process-safety-net.spec.ts` (logs + closes + exits; still exits
when close fails; registers both handlers; shuts down once on repeated events). And **validated live by
accident**: during the DAST setup a stale process held port 3000, so `node dist/main.js` failed its
`app.listen` with `EADDRINUSE` — the safety net caught it, logged
`[ProcessSafetyNet] Unhandled promise rejection: listen EADDRINUSE`, and exited. Exactly the intended
behaviour.

---

## 3 · Security scanning pipeline — four layers (`2e7ede1`, `5370f84`)

The goal was to combine static and dynamic analysis. It became four layers, not two — all free on a public
repo, all in GitHub Actions alongside the existing CI. The **GitHub-native stack** was chosen over Snyk/Sonar:
zero external accounts, and for the static axis Snyk's real strength (SCA) is covered by Dependabot while the
code-quality Sonar would add is already covered by the strict type-aware ESLint.

### 3.1 · SAST — CodeQL (`codeql.yml`)

CodeQL over `javascript-typescript` with `security-extended` queries, on push/PR/weekly. No build step (CodeQL
reads TS sources directly). **Repo visibility measured first** — `gh repo view` returned `PUBLIC`, so results
upload to the Security tab for free (private repos would need GitHub Advanced Security).

### 3.2 · SCA — Dependabot (`dependabot.yml`)

Weekly PRs for three ecosystems: `npm`, `github-actions`, `docker` (the Dockerfile base image). Grouped
minor/patch to cut noise; majors arrive individually. **`npm audit` measured the real state**: 28 "high" over
the full tree, but `--omit=dev` returned **0** — every finding was in the jest toolchain, which the
`npm ci --omit=dev` runtime never ships. This is exactly why the tool must distinguish prod/dev, or 28 phantom
"highs" become alert fatigue. Dependabot was already opening PRs minutes after the push (a `js-yaml` security
update among them).

### 3.3 · Secrets — gitleaks (`security.yml` → `secrets` job)

gitleaks over the **full** history (`fetch-depth: 0`), run from the official Docker image (avoids the
org-license path of the action), **blocking** (`--exit-code=1`). It can be blocking because the history was
**measured clean first**: `gitleaks detect` over **51 commits → "no leaks found"**. The Render key from audit
F1 never entered git, so no `.gitleaksignore` allowlist is needed.

### 3.4 · DAST — OWASP ZAP (`security.yml` → `dast` job)

The API is booted the same way Render does — `build` + `seed:prod` + `node dist/main.js`, never `start:dev` —
with `RATE_LIMIT_ENABLED=false` so ZAP doesn't scan its own 429s. The pivotal finding was **baseline vs
api-scan**:

| Scan | URLs reached | Result |
|---|---|---|
| `zap-baseline.py` (initial) | **3** (`/`, `/robots.txt`, `/sitemap.xml`) | 67 PASS · 3 WARN · 0 FAIL |
| `zap-api-scan.py` (final) | **128** (every endpoint + params) | **118 PASS · 0 WARN · 0 FAIL** |

The passive baseline spider follows HTML links, so on a JSON API it never discovered the endpoints — it only
scanned `/`. Feeding ZAP the **OpenAPI contract** (§4) with `zap-api-scan.py -f openapi` fixed that: it now
imports the spec and actively fuzzes each endpoint's parameters. The active rules that matter for this
surface all passed against `q` & co.: **SQL injection** (+ MySQL/PostgreSQL/Oracle/MsSQL time-based), **XSS**
(reflected/persistent/DOM), **remote OS command injection**, **SSTI/XPath/XSLT**, **path traversal**,
**Log4Shell**, **Spring4Shell**, **Billion Laughs**, **`.env` leak**, **cloud-metadata exposure**. This
empirically corroborates the design: params flow into typed ES query builders (no string concatenation), the
`ValidationPipe` whitelist rejects unknown params, and the error filter leaks no internals.

The 3 baseline WARNs (Cacheable content, Base64 disclosure, Sec-Fetch-Dest) were all informational; two
design-decision false positives (CSP off for a JSON API, the ISO `timestamp` in error bodies) are silenced in
`.zap/rules.tsv`. ZAP runs with `-I` (non-blocking) for now — drop `-I` to make findings fail the build once
they're triaged; today there are none to triage.

**Local vs CI networking (measured, they differ):** on Linux runners the ZAP container uses `--network host` +
`http://localhost:3000`; on Docker Desktop (local) that doesn't reach the host, so `http://host.docker.internal:3000`
is used instead — verified with a throwaway `curlimages/curl` container returning HTTP 200 before the scan.

---

## 4 · OpenAPI contract (`dc78e72`)

Added `@nestjs/swagger` (a **production** dependency — it generates the spec at runtime) with its CLI plugin in
`nest-cli.json`, which derives the parameter schema from the existing `class-validator` DTOs, so there is **no
per-field `@ApiProperty`**. `setupOpenApi()` (`src/swagger.setup.ts`) publishes Swagger UI at `/docs` and the
raw spec at `/docs-json`.

Wired from `main.ts` **only**, not `configureApp`: it is documentation, not part of the security edge the e2e
suites exercise, and a per-boot doc route in every e2e app would be waste. It also joins `installProcessSafetyNet`
as the second thing deliberately in `main.ts` rather than the shared setup.

Confirmed the plugin produces a usable spec — `/docs-json` lists all five paths and `/search` exposes its ten
query params (`q`, `category`, `subcategory`, `location`, `minPrice`, `maxPrice`, `sort`, `order`, `page`,
`pageSize`). Note the plugin runs during `nest build`, **not** under `start:dev`'s `--transpile-only`, so the
full spec exists in `dist/` but not in watch mode.

**Exposure decision:** `/docs` is public in production too. For a read-only public API with no hidden endpoints
or secrets, it adds interactive documentation at no real security cost (everything is already public), and the
DAST job always has the spec.

---

## 5 · Documentation refresh (`7bb53e0`, `551c10b`)

`CLAUDE.md` was also corrected and extended:
- **Design record** — the intro claimed one archive with decisions D1–D13; it now spans two archives (D1–D13
  core, D14–D19 rate limiting) plus D20 (ES timeouts) which lives only in code + README. Added the `docs/`
  reports and the loadtest/coverage scripts that were referenced but never listed.
- **Error mapping / logging** — the 4xx-warning behaviour and that the filter is the only place an errored
  request is logged.
- **Security & OpenAPI** — the four scanning layers, api-scan-over-baseline, the CI-vs-local networking split,
  and that `setupOpenApi`/`installProcessSafetyNet` sit in `main.ts` on purpose.

---

## 6 · Dependency upgrades and a fully clean audit

Cleared the Dependabot backlog with judgement, not blind merges. Every upgrade was validated with
`build` + `lint:ci` + the unit suite before committing:

| Dependency | Decision | Why |
|---|---|---|
| **zod 3 → 4** | upgraded | build + 187 tests green with **no code change** — the `z.string().url()` / `.refine()` usage is 4-compatible |
| **eslint 9 → 10** (+ `@eslint/js`) | upgraded | the two must move together: `@eslint/js` 10 alone (PR #8) failed CI against eslint 9; installed as a pair, lint is clean |
| **node 22 → 26** | upgraded | bumped both Dockerfile stages **and** `NODE_VERSION` in ci.yml/security.yml (CI runs on the runner's node, not the image); validated by building the image on `node:26-alpine` |
| **typescript 5 → 6/7** | **deferred** | TS 7.0 ships without the programmatic compiler API `nest build`/`ts-jest`/`typescript-eslint` need (returns in 7.1); TS 6 deprecates `baseUrl` + `moduleResolution=node10`, whose migration touches resolution entangled with `tsc-alias`/`tsconfig-paths`. Pinned on 5.x like the ES 9 pin |
| **@elastic/elasticsearch 8 → 9** | **closed** | a 9.x client is unsupported against the 8.17 server; PR closed and majors ignored in `dependabot.yml` |

**Audit to zero.** The `@nestjs/swagger` addition had pulled `js-yaml 5.2.1` into the *production* tree
(GHSA-pm4m-ph32-ghv5 → 2 prod highs); the jest/eslint tooling carried `brace-expansion <=5.0.7` (a DoS → OOM
advisory → 24 dev highs). Each is a single transitive CVE, so two targeted `package.json` overrides —
`js-yaml` → `5.2.2` and `brace-expansion` → `5.0.8` — clear them all: `npm audit` now reports **0
vulnerabilities total** (down from 29 dev + 2 prod), lint/build/tests still green.

**Coverage.** `swagger.setup.ts` had shipped without a spec (0%); a `setupOpenApi` spec brings it to 100% and
statement coverage to **97.7% across 188 unit tests**.

---

## Verified green

| Area | Evidence | Result |
|---|---|---|
| Unit tests | `npm test` | 48 suites, **188 tests**, all pass (+4 safety-net, +3 filter, +1 openapi) |
| Coverage | `jest --coverage` | **97.7%** statements, no logic file left uncovered |
| Integration (real ES) | `npm run test:integration` | 1 suite, **5 tests**, all pass |
| End-to-end | `npm run test:e2e` | 7 suites, **25 tests**, all pass |
| Lint (type-aware) | `npm run lint:ci` | exit 0 |
| Build (strict + plugin) | `npm run build` | clean (zod 4 · eslint 10 · node 26) |
| Dependency vulns (dev + prod) | `npm audit` | **0 total** — js-yaml + brace-expansion overrides |
| Secret history | `gitleaks detect` | **51 commits, 0 leaks** |
| Repo visibility | `gh repo view` | PUBLIC (CodeQL free) |
| DAST | `zap-api-scan.py` (OpenAPI) | **128 URLs, 0 FAIL / 0 WARN / 118 PASS** |
| CI workflow | GitHub Actions | **success** (quality + integration) |
| CodeQL workflow | GitHub Actions | **success** |
| Security workflow | GitHub Actions | **success** (gitleaks + ZAP api-scan) |
| Production OpenAPI | `curl /docs-json` | **HTTP 200**, 5 paths, live |

---

## Deployment

The push auto-deployed to Render. Production is live and serves the OpenAPI: `GET /docs-json` → **200** with all
five paths, Swagger UI at <https://advanced-search-api-chet.onrender.com/docs>. Health remains green
(`elasticsearch: up`, `redis: up`).

## Open items (non-blocking)

1. **Make DAST blocking** — remove `-I` from the ZAP step once findings are triaged. Today there are none
   (0 FAIL / 0 WARN), so this can be flipped whenever desired.
2. ~~Merge the Dependabot PRs~~ — **done**: 8 safe PRs merged, ES 9 closed (server pin), TS 6/7 deferred, and
   the whole audit driven to 0 total (see §6).
3. ~~README link to `/docs`~~ — **done**: the README now documents OpenAPI, the security pipeline, and links
   the Swagger UI.
