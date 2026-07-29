# product-indexing Specification

## Purpose

Provisioning and population of the Elasticsearch index that backs every read endpoint: an explicitly
mapped, versioned physical index behind a stable alias, plus an idempotent bulk seed of the product
dataset with document-level validation.
## Requirements
### Requirement: Idempotent index provisioning
The system SHALL provision the Elasticsearch index with an explicit mapping and analyzers when it does
not already exist, exposed as a versioned physical index behind a stable read/write alias. Provisioning
MUST be idempotent. When the index definition carried by the code differs from the definition recorded on
the live physical index — or when no definition is recorded — the system SHALL migrate to a new physical
version rather than leaving the existing index in place. The alias MUST resolve to exactly one complete
index at every instant, including throughout a migration.

#### Scenario: Index created when absent
- **WHEN** the service starts and the index/alias does not exist
- **THEN** the index is created with the defined mapping and analyzers
- **AND** the alias points to the new index

#### Scenario: Provisioning is idempotent
- **WHEN** provisioning runs and the live index records the same definition as the code
- **THEN** no migration occurs, no index is created, and the existing index is left intact

#### Scenario: A changed definition triggers a migration
- **WHEN** provisioning runs and the live index records a different definition than the code, or records
  none at all
- **THEN** a new physical version is created from the current definition
- **AND** the dataset is loaded into that new version before the alias is moved

#### Scenario: The alias never dangles
- **WHEN** the alias is moved from the previous version to the new one
- **THEN** the removal and the addition are applied as a single atomic operation
- **AND** a reader querying the alias at any instant during the migration resolves to exactly one complete
  index

### Requirement: Bulk seed ingestion
The system SHALL provide a seed command that bulk-indexes a realistic, varied product dataset and
refreshes the index afterwards. Ingestion MUST be idempotent by product `id` so that re-running does not
create duplicates. After a successful run the index served by the alias SHALL contain exactly the products
present in the dataset: a product removed from the dataset MUST NOT remain searchable.

#### Scenario: Seed populates the index
- **WHEN** the seed command runs against an empty index
- **THEN** the products are bulk-indexed and become searchable after the refresh

#### Scenario: Re-running seed does not duplicate
- **WHEN** the seed command runs twice
- **THEN** documents are upserted by `id` and the total document count is unchanged after the second run

#### Scenario: A retired product stops being served
- **WHEN** a product is removed from the dataset and the seed command runs
- **THEN** that product is no longer returned by searches against the alias

#### Scenario: An incomplete load is never published
- **WHEN** one or more documents fail to index while loading a new version
- **THEN** the alias keeps pointing at the previous version
- **AND** the command reports the failure and exits non-zero

### Requirement: Indexed document integrity
Each indexed product SHALL conform to the domain model (`id`, `name`, `description`, `category`,
`subcategories`, `location`, `price`, `popularity`, `createdAt`) with valid types. Invalid documents MUST
be reported rather than silently dropped.

#### Scenario: Invalid document is reported
- **WHEN** a product in the dataset has an invalid value (e.g., a negative price)
- **THEN** the seed process reports the failure for that document instead of indexing it silently

### Requirement: Physical version retention and rollback
After a successful migration the system SHALL retain the physical index it replaced and SHALL delete
versions older than that, so at most two physical indices exist. Restoring the retained version MUST be
possible by moving the alias alone, without reindexing.

#### Scenario: The replaced version is retained
- **WHEN** a migration completes successfully
- **THEN** the index the alias previously pointed at still exists
- **AND** any version older than it has been deleted

#### Scenario: Rollback restores the previous catalogue without reindexing
- **WHEN** the alias is moved back to the retained previous version
- **THEN** searches serve that version's documents immediately
- **AND** no reindex is required

