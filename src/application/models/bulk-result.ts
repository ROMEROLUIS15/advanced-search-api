export interface BulkFailure {
  id: string;
  reason: string;
}

/** Outcome of a bulk index operation; per-document failures are surfaced, not swallowed. */
export interface BulkResult {
  total: number;
  indexed: number;
  failed: number;
  failures: BulkFailure[];
}
