import type { SearchSuggestions } from '@application/models/query-suggestion';

// Minimal shapes read from the suggest response.
interface SuggestOption {
  text: string;
  score?: number;
}
interface SuggestEntry {
  options?: SuggestOption[];
}
interface SuggestBlock {
  did_you_mean?: SuggestEntry[];
  related?: SuggestEntry[];
}

/** Maps the ES suggest response into the `{ didYouMean, related }` block (design D7). */
export function toSuggestions(suggest: unknown): SearchSuggestions {
  const block = suggest as SuggestBlock | undefined;
  return {
    didYouMean: firstOption(block?.did_you_mean),
    related: collectTerms(block?.related),
  };
}

function firstOption(entries: SuggestEntry[] | undefined): string | null {
  const option = entries?.[0]?.options?.[0];
  return option ? option.text : null;
}

function collectTerms(entries: SuggestEntry[] | undefined): string[] {
  const terms = new Set<string>();
  for (const entry of entries ?? []) {
    for (const option of entry.options ?? []) {
      terms.add(option.text);
    }
  }
  return [...terms];
}
