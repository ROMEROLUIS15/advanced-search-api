// Needed because this spec drives the decorators directly, without the Nest
// testing module that would otherwise pull reflect-metadata in.
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { SearchQueryDto } from './search-query.dto';
import { MAX_QUERY_LENGTH, MAX_SUBCATEGORIES, MAX_TERM_LENGTH } from '../../common/input-limits';

/** Mirrors the global ValidationPipe options set in `app.setup.ts`. */
function rejectedProperties(query: Record<string, unknown>): string[] {
  const dto = plainToInstance(SearchQueryDto, query);
  return validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }).map((e) => e.property);
}

const times = (length: number): string => 'a'.repeat(length);

describe('SearchQueryDto — length limits', () => {
  // A term long enough to make Lucene's fuzzy automaton too complex used to reach
  // Elasticsearch and come back as a 502. These bounds stop it at the edge.
  const cases: Array<[string, Record<string, unknown>, string[]]> = [
    ['accepts a realistic query', { q: 'cordless drill', category: 'Tools' }, []],
    ['accepts q exactly at the limit', { q: times(MAX_QUERY_LENGTH) }, []],
    ['rejects q one character over', { q: times(MAX_QUERY_LENGTH + 1) }, ['q']],
    ['rejects the 3000-character term that produced a 502', { q: times(3000) }, ['q']],
    ['rejects an over-long category', { category: times(MAX_TERM_LENGTH + 1) }, ['category']],
    ['rejects an over-long location', { location: times(MAX_TERM_LENGTH + 1) }, ['location']],
    [
      'rejects an over-long subcategory value',
      { subcategory: ['Power Tools', times(MAX_TERM_LENGTH + 1)] },
      ['subcategory'],
    ],
    [
      'rejects more subcategories than a facet dimension holds',
      { subcategory: Array.from({ length: MAX_SUBCATEGORIES + 1 }, (_, i) => `sub-${i}`) },
      ['subcategory'],
    ],
    [
      'accepts subcategories exactly at the count limit',
      { subcategory: Array.from({ length: MAX_SUBCATEGORIES }, (_, i) => `sub-${i}`) },
      [],
    ],
  ];

  it.each(cases)('%s', (_name, query, expected) => {
    expect(rejectedProperties(query)).toEqual(expected);
  });
});

describe('SearchQueryDto — price range', () => {
  const cases: Array<[string, Record<string, unknown>, string[]]> = [
    ['accepts a normal range', { minPrice: 10, maxPrice: 500 }, []],
    ['accepts equal bounds', { minPrice: 50, maxPrice: 50 }, []],
    ['accepts a lone lower bound', { minPrice: 500 }, []],
    ['accepts a lone upper bound', { maxPrice: 10 }, []],
    // Used to answer 200 with an empty list, indistinguishable from a genuinely
    // empty catalogue — a typo the client could not detect.
    ['rejects an inverted range', { minPrice: 500, maxPrice: 10 }, ['maxPrice']],
  ];

  it.each(cases)('%s', (_name, query, expected) => {
    expect(rejectedProperties(query)).toEqual(expected);
  });
});
