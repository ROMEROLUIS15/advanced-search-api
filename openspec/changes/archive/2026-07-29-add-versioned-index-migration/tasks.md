# Tasks

## 1. Verify the assumptions before building on them

- [x] 1.1 Against the local stack (`docker compose up -d elasticsearch redis`), confirm `mappings._meta`
      survives `indices.create` verbatim and comes back through `indices.getMapping({ index: <alias> })`,
      keyed by the physical index name. Record the observed shape — the trigger in D43 and the version
      resolution in D44 both read that one response.
      *Verified on 8.17.0: `getMapping` by alias returns `{ "<physical>": { mappings: { _meta: {...} } } }`,
      so one call yields both the fingerprint and the physical name (D43/D44 hold). The remove+add
      `updateAliases` flip moved the alias in one operation, deleting the retired index left the alias
      intact, and a concurrent `indices.create` failed with `resource_already_exists_exception` at status
      **400** — not 409, so 4.4 must key on the error type. The existing `isAlreadyExistsError` already
      does.*
- [x] 1.2 Confirm the same three operations on **Elastic Cloud Serverless**, which is what production runs
      and which already rejects settings the self-managed API accepts: `_meta` round-trip,
      `indices.updateAliases` with a remove+add action list, and `indices.delete`. Use a throwaway index
      name that no alias points at, and delete it afterwards — **this writes to the production project, so
      get an explicit go-ahead before running it.** If any of the three is unavailable, stop and revisit
      D43/D45 rather than coding around it.
      *Run with the owner's explicit go-ahead on 2026-07-29 against the Serverless project (9.6.0), using
      the throwaway alias `probe_meta`. **Serverless behaves identically to 8.17 on all four observations**
      — `_meta` round-trip, atomic remove+add flip, delete of the retired index leaving the alias intact,
      and `resource_already_exists_exception` at status 400 for a concurrent creator. D43, D45 and D47 hold
      as written. Cleanup verified afterwards: the project holds only `products_v1` (24 docs) and the
      `products` alias.*
- [x] 1.3 Confirm the stale docstring in `product-index.mapping.ts`: it claims "1 shard / 0 replicas" while
      `indexSettings()` sets neither (deliberately, since Serverless rejects them). Fix the comment.

## 2. Fingerprint and version resolution

- [x] 2.1 Add `index-definition.fingerprint.ts` beside the adapter: canonical serialization (keys sorted)
      of `{ settings, mappings }` **excluding `_meta`**, SHA-256 hex. Export both the digest function and a
      helper that attaches it to a definition.
- [x] 2.2 Unit spec: identical definitions hash equal; a changed analyzer, a changed field type and a
      reordered object all behave as designed (the first two differ, the third does not); attaching `_meta`
      does not change the digest of the definition it describes.
- [x] 2.3 Add `physical-index.version.ts`: parse `<alias>_v<n>` from a physical index name, resolve the next
      version from the live one, and return 1 when there is no alias. An unparseable name is an error, not
      a guess (D44).
- [x] 2.4 Unit spec for the parser and the resolver, including the no-alias case and the unparseable case.

## 3. Port and application models

- [x] 3.1 Add the `IndexPreparation` / `IndexPublication` models under `application/models/` — action,
      version and pruned versions only. No index names, no Elasticsearch types.
- [x] 3.2 Change `ProductIndexPort`: `ensureIndex()` returns `IndexPreparation`, and add
      `publishIndex(): Promise<IndexPublication>`. Update the docstrings to say what each guarantees.

## 4. Adapter: the migration path

- [x] 4.1 Replace the `PHYSICAL_INDEX_SUFFIX` constant and the early return in `ensureIndex()` with the
      fingerprint comparison from D43: unchanged ⇒ no-op; absent alias ⇒ create with the alias inline;
      differing or absent fingerprint ⇒ create the next version **without** the alias and hold it as the
      pending write target.
- [x] 4.2 Make `bulkIndex` and `refresh` address the pending target when a migration is in flight and the
      alias otherwise. This is the step that makes a migration load the new index instead of the one being
      replaced.
- [x] 4.3 Implement `publishIndex()`: one `indices.updateAliases` carrying remove+add (D45), then prune
      versions older than the one just replaced (D47). A no-op when nothing is pending.
- [x] 4.4 Handle the concurrency case: `resource_already_exists_exception` on the new version means another
      migration is in flight — fail with a clear typed error instead of loading into it (design risk list).
- [x] 4.5 Keep the adapter under `max-lines: 250`; if it does not fit, the fingerprint/version helpers take
      the overflow, not a raised cap.
- [x] 4.6 Extend `product-index.adapter.spec.ts` over the mocked client: unchanged fingerprint issues no
      create, changed fingerprint creates the next version without an alias, publish issues exactly one
      `updateAliases` with both actions, prune deletes only versions older than the retained one, and a
      concurrent creator raises.

## 5. Seed use-case and command

- [x] 5.1 `SeedCatalogUseCase`: prepare, load, refresh, then publish **only when zero documents failed**
      (D46). On any failure the alias stays where it is and the existing non-zero exit is kept.
- [x] 5.2 Update `seed-catalog.use-case.spec.ts` for both paths — published on a clean load, not published
      when a document fails.
- [x] 5.3 Make the seed's log line state what happened: unchanged, created, or migrated from version N to
      N+1. This is the only place an operator sees that a migration occurred.

## 6. Integration coverage against a real Elasticsearch

- [x] 6.1 New integration spec: seed a definition, change it, seed again, and assert a new physical version
      exists, the alias points at it, and the previous one is retained.
- [x] 6.2 Assert the alias resolves to exactly one index throughout — poll it during the migration, since
      an atomic flip is precisely what a single-call `updateAliases` buys and a two-call version would pass
      every other assertion here.
- [x] 6.3 Assert a product removed from the dataset is gone after the migration, and that one still present
      is served (the D48 rebuild, proved rather than argued).
- [x] 6.4 Assert an incomplete load leaves the alias untouched (D46).
- [x] 6.5 Confirm D49 empirically: cache scopes are unchanged by a migration, so a cached search can serve
      pre-migration results until its TTL. If that turns out false, the design decision is wrong and gets
      revisited, not patched over.

## 7. Documentation and close-out

- [x] 7.1 `CLAUDE.md`: the D1 index bullet describes a versioned index behind an alias — extend it with the
      fingerprint trigger, the atomic flip and the one-version retention, and add D43–D49 to the decision
      map at the top (which currently ends at D42).
- [x] 7.2 `README.md`: the seed section gains what a migration does and the rollback runbook from D47 (the
      literal `_aliases` call), plus the note that a migration is still a manual pre-boot step.
- [x] 7.3 `docs/PENDING-2026-07-28.md`: close B3, stating what shipped and what did not — the seed is still
      manual and cache invalidation is still TTL-bound by choice.
- [x] 7.4 Run the local gate — `npm run lint:ci && npm run test:cov && npm run build` — plus
      `test:integration` and `test:e2e` against the seeded stack, and record the new suite/test baseline in
      `CLAUDE.md`.
- [x] 7.5 `openspec validate add-versioned-index-migration --strict`, then archive.
