import type { BulkResult } from './bulk-result';
import type { IndexPreparation, IndexPublication } from './index-migration';

/**
 * What one seed run did. `publication` is absent when the load was incomplete:
 * a partial catalogue is never published, so the alias keeps serving the previous
 * version (design D46).
 */
export interface SeedOutcome {
  bulk: BulkResult;
  preparation: IndexPreparation;
  publication: IndexPublication | undefined;
}
