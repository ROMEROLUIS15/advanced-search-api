# product-indexing Specification

## Purpose

Provisioning and population of the Elasticsearch index that backs every read endpoint: an explicitly
mapped, versioned physical index behind a stable alias, plus an idempotent bulk seed of the product
dataset with document-level validation.

## Requirements

### Requirement: Idempotent index provisioning
The system SHALL provision the Elasticsearch index with an explicit mapping and analyzers when it does
not already exist, exposed as a versioned physical index behind a stable read/write alias. Provisioning
MUST be idempotent.

#### Scenario: Index created when absent
- **WHEN** the service starts and the index/alias does not exist
- **THEN** the index is created with the defined mapping and analyzers
- **AND** the alias points to the new index

#### Scenario: Provisioning is idempotent
- **WHEN** provisioning runs and the index already exists
- **THEN** no error is raised and the existing index is left intact

### Requirement: Bulk seed ingestion
The system SHALL provide a seed command that bulk-indexes a realistic, varied product dataset and
refreshes the index afterwards. Ingestion MUST be idempotent by product `id` so that re-running does not
create duplicates.

#### Scenario: Seed populates the index
- **WHEN** the seed command runs against an empty index
- **THEN** the products are bulk-indexed and become searchable after the refresh

#### Scenario: Re-running seed does not duplicate
- **WHEN** the seed command runs twice
- **THEN** documents are upserted by `id` and the total document count is unchanged after the second run

### Requirement: Indexed document integrity
Each indexed product SHALL conform to the domain model (`id`, `name`, `description`, `category`,
`subcategories`, `location`, `price`, `popularity`, `createdAt`) with valid types. Invalid documents MUST
be reported rather than silently dropped.

#### Scenario: Invalid document is reported
- **WHEN** a product in the dataset has an invalid value (e.g., a negative price)
- **THEN** the seed process reports the failure for that document instead of indexing it silently
