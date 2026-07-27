import { z } from 'zod';
import type { AutocompleteItem } from '../models/autocomplete-item';
import type { SearchOutcome } from '../models/search-outcome';

/**
 * Shapes a cached entry must still have to be served (design D27).
 *
 * The keys are namespaced and versioned, so in theory a shape change comes with
 * a namespace bump — but that is a discipline, and a discipline is not a
 * property of the code. Validating on read makes a stale or half-written entry
 * a miss instead of a response, at the cost of a parse on the fastest path.
 *
 * `satisfies z.ZodType<T>` is what keeps these honest: if a model gains a field
 * and the schema does not, the build fails here rather than at runtime in a
 * container.
 */
const productSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  category: z.string(),
  subcategories: z.array(z.string()),
  location: z.string(),
  price: z.number(),
  currency: z.string(),
  popularity: z.number(),
  createdAt: z.string(),
  score: z.number().optional(),
});

const facetBucketSchema = z.object({ key: z.string(), count: z.number() });

const priceRangeBucketSchema = z.object({
  from: z.number().optional(),
  to: z.number().optional(),
  count: z.number(),
});

export const searchOutcomeSchema = z.object({
  items: z.array(productSummarySchema),
  total: z.number(),
  facets: z.object({
    categories: z.array(facetBucketSchema),
    subcategories: z.array(facetBucketSchema),
    locations: z.array(facetBucketSchema),
    priceRanges: z.array(priceRangeBucketSchema),
  }),
  suggestions: z.object({
    didYouMean: z.string().nullable(),
    related: z.array(z.string()),
  }),
}) satisfies z.ZodType<SearchOutcome>;

export const autocompleteItemsSchema = z.array(
  z.object({ text: z.string(), score: z.number() }),
) satisfies z.ZodType<AutocompleteItem[]>;
