/**
 * Read model returned for a search hit. This is what crosses the port boundary;
 * the presentation layer maps it to a response DTO (never the domain entity).
 */
export interface ProductSummary {
  id: string;
  name: string;
  description: string;
  category: string;
  subcategories: string[];
  location: string;
  price: number;
  currency: string;
  popularity: number;
  /** ISO-8601 timestamp. */
  createdAt: string;
  /** Relevance score, present when ranking by relevance. */
  score?: number;
}
