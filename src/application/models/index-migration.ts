/**
 * What provisioning decided to do (design D43). `unchanged` means the live index
 * already carries the current definition; `created` is a first-ever provisioning;
 * `migrating` means a new version exists and is waiting to be loaded and published.
 */
export type IndexPreparationAction = 'unchanged' | 'created' | 'migrating';

export interface IndexPreparation {
  action: IndexPreparationAction;
  /** The version writes now land in. */
  version: number;
  /** The version still being served, absent when nothing was provisioned before. */
  replacedVersion?: number;
}

/**
 * Outcome of publishing a prepared version (design D45/D47). `published` is false
 * when there was nothing pending — publishing is idempotent, not an assertion that
 * a migration happened.
 */
export interface IndexPublication {
  published: boolean;
  /** The version the alias points at once this returns. */
  version: number;
  /** Kept for a rollback that costs an alias move rather than a reindex. */
  retainedVersion?: number;
  prunedVersions: number[];
}
