/**
 * A migration could not proceed safely (design D44/D45). Thrown by the seed path
 * only — `ensureIndex`/`publishIndex` have no HTTP caller — so it deliberately
 * does not extend `ApplicationError`: were it ever to reach the exception filter,
 * a 500 is the honest answer, not the 400 that base class carries.
 */
export class IndexMigrationError extends Error {
  readonly code = 'INDEX_MIGRATION_FAILED';

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
