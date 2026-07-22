import type { estypes } from '@elastic/elasticsearch';
import type { AutocompleteItem } from '@application/models/autocomplete-item';
import type { ProductDocument } from '../index/product-document';

type NameHit = estypes.SearchHit<Pick<ProductDocument, 'name'>>;

/** Maps hits to distinct name completions, preserving the (score-ranked) order. */
export function toAutocompleteItems(hits: NameHit[]): AutocompleteItem[] {
  const seen = new Set<string>();
  const items: AutocompleteItem[] = [];
  for (const hit of hits) {
    const name = hit._source?.name;
    if (!name || seen.has(name)) {
      continue;
    }
    seen.add(name);
    items.push({ text: name, score: hit._score ?? 0 });
  }
  return items;
}
