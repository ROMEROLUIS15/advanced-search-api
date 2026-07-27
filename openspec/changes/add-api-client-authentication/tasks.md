## 1. Configuration

- [x] 1.1 Add `API_AUTH_ENABLED` (default **true**) and `API_KEYS` (comma-separated) to `env.schema.ts`, with a cross-field rule that fails startup when authentication is enabled and no key is configured (design D31)
- [x] 1.2 Map them into an `apiAuth` namespace on `AppConfiguration`, parsing the key list the same way `CORS_ORIGINS` is parsed
- [x] 1.3 Extend the config specs: defaults, the fail-fast rule, list parsing, and that an explicitly disabled service needs no keys
- [x] 1.4 Document both variables in `.env.example` with the reason the local default is `false`

## 2. The guard

- [x] 2.1 Add `presentation/auth/api-key.guard.ts` registered through `APP_GUARD`, rejecting with 401 in the standard error envelope (design D30)
- [x] 2.2 Compare keys with `timingSafeEqual` over SHA-256 digests computed once at construction (design D33)
- [x] 2.3 Exempt `GET /health` and nothing else; `/docs` and `/docs-json` are protected (design D32)
- [x] 2.4 Pass through untouched when authentication is disabled
- [x] 2.5 Unit-spec it: no key, unknown key, valid key, second valid key, `/health` open, `/docs-json` protected, disabled pass-through, and that the presented key never appears in the response

## 3. Rate limiting per consumer

- [x] 3.1 `RateLimitGuard.getTracker` returns a short digest of the API key when present, the address otherwise (design D34)
- [x] 3.2 Extend the guard spec: two keys from one address are counted apart, no key still counts by address, and the raw key never reaches the tracker string

## 4. Contract and documentation

- [x] 4.1 Declare the security scheme in the OpenAPI document so `/docs` shows the header and its "Authorize" box
- [x] 4.2 Document authentication in `README.md`: the header, obtaining a key, rotation, and that `/health` is the only open endpoint
- [ ] 4.3 Update `postman/` and `api.http` to send the header from a variable
- [x] 4.4 Add `API_AUTH_ENABLED` and `API_KEYS` to `render.yaml` (`sync: false` for the keys)
- [x] 4.5 Record the non-obvious parts in `CLAUDE.md` — on by default, the single exemption, and that DAST and the e2e suites disable it deliberately

## 5. Pipeline

- [x] 5.1 Set `API_AUTH_ENABLED=false` in the CI integration job, with the reason in a comment
- [x] 5.2 Set `API_AUTH_ENABLED=false` in the DAST job, for the same reason rate limiting is already disabled there
- [x] 5.3 Confirm the ZAP scan still reaches the endpoints and stays at 0 findings

## 6. End-to-end

- [x] 6.1 Add `test/api-auth.e2e-spec.ts` that enables authentication via `overrideProvider(APP_CONFIG)` and asserts 401 without a key, 200 with, and `/health` open regardless
- [x] 6.2 Keep the existing e2e suites running with authentication off, so they keep testing what they were written to test

## 7. Verification and rollout

- [ ] 7.1 Run the full local gate: `lint:ci`, `test:cov`, `build`, plus e2e and integration against the live stack
- [ ] 7.2 Deploy, then generate a key and set `API_KEYS` on the service before authentication takes effect
- [ ] 7.3 Verify against production: `/health` 200 with no key, `/search` and `/docs-json` 401 without, 200 with
- [ ] 7.4 Write the rollout note into `docs/`, including the key handover and the rollback switch
