## Context

`ProductIndexAdapter` names its physical index `<alias>_v1` from a module-level constant and short-circuits
`ensureIndex()` the moment `existsAlias` returns true. On a cluster provisioned once — which is every
long-lived deployment — the mapping in the code and the mapping in Elasticsearch are free to diverge with no
signal at all. `bulkIndex` compounds it by writing through the alias and upserting by `id`, so the indexed
set is the *union* of every dataset ever seeded rather than the current one.

Nothing about this is hypothetical: the alias was introduced by D1 precisely to make a zero-downtime
reindex possible, and the reindex half was never built. What follows keeps D1's shape and fills in the
missing half.

Three constraints shape the design more than anything else:

- **Readiness is the deploy gate.** `/health/ready` reports the service down when the configured index is
  missing, and Render polls it every ~4.2 s (measured). If the alias is absent for even one poll during a
  migration, a deploy can fail on a healthy cluster.
- **Production is Elastic Cloud Serverless** (verified against the endpoint: `build_flavor: serverless`,
  9.6.0). The mapping already omits `number_of_shards`/`number_of_replicas` because Serverless rejects
  them; anything this design relies on must be checked against a real cluster rather than assumed from the
  self-managed API surface.
- **The seed is a separate composition root** — a Nest standalone context over `SeedModule`, run in
  production as `npm run seed:prod` (`node dist/seed/seed.command.js`, since ts-node does not exist in the
  runtime image).

## Goals / Non-Goals

**Goals:**

- A mapping change in the code reaches an already-provisioned cluster, without anyone having to remember a
  version number.
- A product removed from `products.seed.json` is gone from the served index after the next seed.
- The alias resolves to a complete, queryable index at every instant, including mid-migration.
- A rollback is an alias move, not a reindex.

**Non-Goals:**

- **Automating the seed at deploy time.** It stays the manual pre-boot step it is today; that gap is
  tracked in `docs/PENDING-2026-07-28.md` and is a different decision with a different failure mode.
- **Rollback beyond one version.** Two physical indices at most.
- **Cache invalidation on migration** — see D49; TTL bounds it and the alternative costs more than it buys.
- **Live re-mapping of an index in place.** Elasticsearch does not offer it for analyzer changes; that is
  the whole reason the alias exists.

## Decisions

### D43 — The migration trigger is a fingerprint of the definition, stored in the index's `_meta`

`productIndexDefinition()` returns `{ settings, mappings }`. The seed hashes a canonical serialization of
that object (keys sorted, SHA-256, hex) and writes the digest into the new index's `mappings._meta`. On the
next run it reads the digest back and migrates when — and only when — the two differ.

The hash is computed over the definition **excluding `_meta`**, then `_meta` is attached; hashing the
object that contains its own hash is not a fixed point.

One call does double duty: `indices.getMapping({ index: alias })` returns the mapping keyed by the *physical*
index name, so a single request yields both the live fingerprint and the current physical index — which D44
needs anyway.

*Alternatives considered.* An explicit `ELASTICSEARCH_INDEX_VERSION` env var puts a human in the loop, which
sounds safer until you notice the failure mode is identical to today's — forget to bump it and the new
mapping never lands, only now with more moving parts to inspect before you notice. A standalone
`npm run reindex` keeps the destructive operation deliberate but leaves drift possible and silent, which is
the defect being closed. The fingerprint makes drift *unreachable*: the two can only disagree in the window
between deploying code and running the seed.

*Consequence to state plainly:* `products_v1` in production carries no `_meta`, so the first seed after this
ships reads an absent fingerprint, treats it as a mismatch, and migrates to `products_v2`. That is intended
and is exercised by the integration test, but it is a real one-time reindex of production, not a no-op.

### D44 — The physical version is resolved from the live alias target, never from configuration

The next index is `<alias>_v<n+1>`, where `n` is parsed from the index the alias currently points at. With
no alias at all, `n+1` is 1 — the current name, so an existing `products_v1` is not orphaned by adopting
this. An unparseable target (someone pointed the alias at a hand-made index) is an error, not a guess.

*Alternative considered.* A timestamp suffix (`products_20260729T0134`) needs no parsing and cannot
collide. It was rejected because it orphans the `_v1` naming already in production and makes "which is
newer" a string-comparison exercise rather than an integer one. Collisions are not a real risk here: the
name is derived from the live cluster state at the moment of migration, and D45's concurrency rule handles
the only case where two writers could pick the same name.

### D45 — Load into the new physical index directly, then move the alias in one `updateAliases` call

While a migration is in flight the alias still points at the *old* index, so `bulkIndex` must address the
new physical index by name — writing through the alias would load documents into the index being replaced.
When the load is complete and refreshed, a single call flips it:

```
POST /_aliases
{ "actions": [ { "remove": { "index": "products_v1", "alias": "products" } },
               { "add":    { "index": "products_v2", "alias": "products" } } ] }
```

Elasticsearch applies the action list atomically, which is the only reason readiness cannot observe a
missing alias. A remove-then-add as two requests would open exactly the window this design exists to
avoid — at a 4.2 s poll and a deploy gate on the other end, that window is not theoretical.

Two shapes differ between the paths and it is worth being explicit: **creation** installs the alias inline
on `indices.create` (as today), so a first-ever deployment has an alias the instant the index exists;
**migration** creates the index *without* the alias and adds it only at the flip.

The port grows a second verb so the use-case can express "load, then publish":

```ts
ensureIndex(): Promise<IndexPreparation>;   // { action: 'unchanged' | 'created' | 'migrating', version }
publishIndex(): Promise<IndexPublication>;  // flips + prunes; a no-op unless a migration is pending
```

The pending write target is held as adapter state rather than passed through the port. *Alternative
considered:* returning an opaque handle from `ensureIndex` and passing it to `bulkIndex`. That handle is
the physical index name — an Elasticsearch detail travelling through the application layer in a paper bag.
Adapter-held state keeps the port free of index names, and its lifetime is one short-lived standalone
context, not the API process.

### D46 — Publish only a complete load; any failure leaves the alias where it was

`publishIndex()` is called only when every document indexed. If any document failed, the alias keeps
pointing at the previous index, the seed exits 1 as it already does, and the half-filled index is left for
the next run to prune. The failure mode is therefore "the catalogue is stale", never "the catalogue is
partial" — the old data keeps serving and `/health/ready` never notices.

### D47 — Retain exactly one previous version; rollback is an alias move

After a successful flip, the just-replaced index is kept and anything older is deleted, so the cluster
holds at most two physical indices. Rollback is the same atomic call in reverse and takes seconds:

```
POST /_aliases
{ "actions": [ { "remove": { "index": "products_v2", "alias": "products" } },
               { "add":    { "index": "products_v1", "alias": "products" } } ] }
```

*Trade-off accepted:* double storage. At 24 documents that is noise; the retention rule is worth revisiting
if this ever points at a real catalogue, and the design says so rather than pretending the number is free.

### D48 — Rebuild from the dataset, not `_reindex` from the old index

The seed JSON is the source of truth. `_reindex` would be cheaper on a large catalogue but would faithfully
carry forward every retired product — the second defect this change closes. Rebuilding makes "the index
equals the dataset" true by construction instead of by a compensating delete.

### D49 — Cache invalidation is left to TTL

Cache scopes digest the alias plus the relevance config, and neither changes across a migration, so cached
entries written before a flip remain servable after it: up to `CACHE_TTL_SEARCH` (300 s) for search and
`CACHE_TTL_AUTOCOMPLETE` (60 s) for prefixes.

*Alternatives considered.* Adding the physical version to the cache scope would invalidate naturally, but
the scope is computed in the API process from configuration, so it would have to read the live physical
index at boot — coupling cache-key derivation to cluster state and adding an ES round-trip to startup.
Flushing the cache from the seed would wire Redis into `SeedModule`, which today needs no cache at all.
Both cost more than 5 minutes of staleness on a manually-run migration step. Recorded as a deliberate
choice so the next reader does not mistake it for an oversight.

## Risks / Trade-offs

- **Serverless may not support something this depends on** (`_meta` on mappings, `updateAliases`,
  `indices.delete`) → verify each against a real cluster in the integration spec before the adapter relies
  on it. Not assumed from the self-managed API surface; this is the same class of assumption that produced
  the shard-settings rejection.
- **The first production run migrates for real** (`products_v1` has no fingerprint) → expected, stated in
  D43, and the reason the migration path must be exercised end to end before it ships.
- **Fingerprint churn**: an incidental edit to the definition triggers a reindex → hashing the *produced
  object* rather than the source text means comments and formatting cannot move the digest; only a real
  definition change can. Cost when it does happen is seconds and 24 documents.
- **Two seeds at once** could both resolve the same next version → the loser's `indices.create` fails with
  `resource_already_exists_exception`; treat that as "a migration is already in flight" and abort with a
  clear error rather than loading into someone else's index. Deliberately not a distributed lock: the seed
  is a manual operator step, not a scheduled job.
- **A process killed between create and flip** leaves an orphan index → harmless (the alias never moved)
  and pruned on the next successful run.
- **Stale cache for up to 5 minutes after a flip** → accepted, D49.
- **`max-lines: 250`** — fingerprinting and version resolution go in their own modules beside the adapter
  rather than growing it.

## Migration Plan

1. Ship the code. Nothing changes on the cluster until a seed runs.
2. Run `npm run seed:prod`. It reads an absent fingerprint on `products_v1`, creates `products_v2`, loads
   the dataset into it, refreshes, flips the alias atomically, and keeps `products_v1`.
3. Verify: the alias resolves to `products_v2`, `/health/ready` stayed 200 throughout, and `/search`
   returns the expected 24 products across three pages.
4. Rollback if needed: the reverse `_aliases` call from D47. `products_v1` is still there and still
   complete.

## Open Questions

- Does Serverless preserve `mappings._meta` verbatim across `indices.create`? Expected yes, must be seen
  before the trigger depends on it (first task of the implementation).
- Should `publishIndex()` prune eagerly at flip time or at the *start* of the next migration? Flip-time
  pruning is simpler to reason about; start-of-next-run pruning keeps two versions available slightly
  longer for a rollback. Deferred to implementation, where the integration test makes the difference
  concrete.
