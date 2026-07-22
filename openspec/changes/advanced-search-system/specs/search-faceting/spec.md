## ADDED Requirements

### Requirement: Facet counts alongside results
The system SHALL return facet aggregations for category, subcategory, location, and price ranges in
every `/search` response. Each facet SHALL be a list of buckets, and each bucket SHALL include a key
(or range boundaries) and a document count.

#### Scenario: Facets present in the response
- **WHEN** a client requests `GET /search?q=drill`
- **THEN** `facets.categories`, `facets.subcategories`, `facets.locations`, and `facets.priceRanges` are present
- **AND** each bucket includes a key (or range) and a count

### Requirement: Combined-filter facet semantics
Facet counts SHALL reflect all currently active filters EXCEPT the filter on the facet's own dimension,
so that a user can broaden a dimension they have already narrowed. The returned hits SHALL respect all
active filters.

#### Scenario: A facet does not narrow its own dimension
- **WHEN** a client filters with `category=Tools`
- **THEN** `facets.categories` still lists other categories with their counts, as if the category filter were not applied
- **AND** `data` contains only products in category "Tools"

#### Scenario: Other dimensions constrain the facet
- **WHEN** a client filters with `location=Berlin`
- **THEN** the counts in `facets.categories` reflect only products located in "Berlin"

#### Scenario: Facets respect the text query
- **WHEN** a client requests `GET /search?q=drill`
- **THEN** facet counts are computed over products matching "drill" only

### Requirement: Price range facets
The system SHALL compute price-range facet buckets over a configurable set of ranges and SHALL return
each bucket's boundaries and document count.

#### Scenario: Price buckets returned
- **WHEN** a client requests `GET /search`
- **THEN** `facets.priceRanges` contains buckets, each with `from`/`to` boundaries and a count
