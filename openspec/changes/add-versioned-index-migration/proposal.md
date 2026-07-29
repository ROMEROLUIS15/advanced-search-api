## Why

The index is versioned in name only. `PHYSICAL_INDEX_SUFFIX` is hard-coded to `_v1`, and `ensureIndex()`
returns as soon as the alias exists — so on any already-provisioned deployment a mapping change is
silently ignored, forever. The alias that was introduced to make a zero-downtime reindex possible (D1) has
never had a reindex to perform.

The same early return has a second consequence: because `bulkIndex` writes through the alias and upserts by
`id`, a product deleted from the seed dataset stays in the index permanently. Today the catalogue is a
24-product JSON file, so both defects are invisible; the moment an analyzer is tuned or a product is
withdrawn, the deployed index and the code that describes it diverge with no signal.

## What Changes

- Provisioning becomes **fingerprint-driven**. The seed hashes the mapping and settings definition and
  compares it with the fingerprint recorded on the live physical index. Equal fingerprints mean the current
  index already matches the code, and provisioning stays the no-op it is today.
- A differing (or absent) fingerprint triggers a **migration**: the next physical version is created from
  the current definition, the dataset is loaded into it directly — not through the alias — and the alias is
  moved in a **single atomic `updateAliases` call** that removes the old target and adds the new one.
- Retired products disappear **by construction**: the fresh index receives exactly what the dataset
  contains, so nothing survives that the JSON no longer lists. No delete-by-query, no bookkeeping field.
- Exactly **one previous version is retained** after a successful flip, making a rollback an alias move
  rather than a reindex; older versions are removed.
- The alias is **never absent at any instant**, which readiness depends on: `/health/ready` reports the
  service down when the configured index is missing, and Render polls it every ~4.2 s as the deploy gate.
- The physical index name stops being derivable from configuration alone, so anything that assumed
  `<alias>_v1` — including the adapter's own field — is corrected.

Not breaking for API clients: no endpoint, request or response shape changes. The behavioural change is
confined to what the seed command does on a cluster whose index no longer matches the code.

## Capabilities

### New Capabilities

None. The change alters how an existing capability provisions and populates its index; it introduces no new
surface.

### Modified Capabilities

- `product-indexing`: provisioning changes from "create when absent, otherwise leave intact" to "create
  when absent, migrate when the definition has changed, otherwise leave intact". Ingestion gains the
  guarantee that the indexed set equals the dataset (retired products are removed), alongside the existing
  idempotency-by-`id` guarantee. Two requirements gain scenarios; one new requirement covers retention and
  rollback.

## Impact

- **Code**: `infrastructure/elasticsearch/index/product-index.adapter.ts` (the hard-coded suffix and the
  early return), a new fingerprint/version resolution module beside it, and
  `application/ports/product-index.port.ts` if the migration outcome needs to reach the seed's log line.
  `product-index.mapping.ts` gains no behaviour but its docstring is stale — it claims 1 shard / 0 replicas
  while the settings deliberately set neither, since Elastic Cloud Serverless rejects them.
- **Operations**: `npm run seed:prod` becomes the migration entry point as well as the seed. It stays the
  manual, pre-boot step it is today; automating it is explicitly out of scope and remains open in
  `docs/PENDING-2026-07-28.md`.
- **Runtime dependencies**: none added. `indices.updateAliases` and `indices.delete` are already available
  through the existing client.
- **Cache**: expected to need nothing. Cache scopes digest the *alias* plus the relevance config, and the
  alias does not change across a migration; whether a physical-version change must also invalidate is a
  question the design answers explicitly rather than by assumption.
- **Tests**: unit coverage for fingerprint comparison and version resolution, and a real-Elasticsearch
  integration case that migrates between two definitions and asserts the alias never dangles and that a
  removed product is gone. The e2e suites keep asserting the seeded 24-product dataset.
