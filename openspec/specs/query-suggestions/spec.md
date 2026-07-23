# query-suggestions Specification

## Purpose

Query rescue for unproductive searches: a validated "did you mean" correction and related terms, served
by `GET /suggest` and surfaced inside the `/search` response only when recall is low.

## Requirements

### Requirement: "Did you mean" correction
The system SHALL provide a corrected-query suggestion ("did you mean") for misspelled input using a
phrase suggester. The suggested phrase SHALL correspond to a query that returns at least one result
(validated via a collate query).

#### Scenario: Misspelled query is corrected
- **WHEN** a client requests `GET /suggest?q=drill` with a misspelling
- **THEN** `data.didYouMean` contains a corrected query such as "drill"

#### Scenario: Correctly spelled query has no correction
- **WHEN** the query is already valid and common
- **THEN** `data.didYouMean` is null

### Requirement: Related query suggestions
The system SHALL provide related/alternative query terms using a term suggester.

#### Scenario: Related terms returned
- **WHEN** a client requests `GET /suggest?q=drill`
- **THEN** `data.related` contains zero or more alternative query strings

### Requirement: Suggestions surfaced on low-recall search
The `/search` response SHALL include a suggestions block that is populated only when the search returns
zero or few results, guiding the user toward a productive query.

#### Scenario: Low-recall search offers a suggestion
- **WHEN** a search for a misspelled `q` returns zero results
- **THEN** `suggestions.didYouMean` is populated with a corrected query

#### Scenario: High-recall search omits suggestion noise
- **WHEN** a search returns many results
- **THEN** `suggestions.didYouMean` is null
