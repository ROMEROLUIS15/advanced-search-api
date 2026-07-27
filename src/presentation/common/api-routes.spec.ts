import { PATH_METADATA } from '@nestjs/common/constants';
import { AutocompleteController } from '@presentation/autocomplete/autocomplete.controller';
import { HealthController } from '@presentation/health/health.controller';
import { MetricsController } from '@presentation/metrics/metrics.controller';
import { SearchController } from '@presentation/search/search.controller';
import { ServiceIndexController } from '@presentation/service-index/service-index.controller';
import { SuggestionController } from '@presentation/suggestion/suggestion.controller';
import { API_PATHS, isAllowedMethod, isApiPath } from './api-routes';

const CONTROLLERS = [
  ServiceIndexController,
  SearchController,
  AutocompleteController,
  SuggestionController,
  HealthController,
  MetricsController,
];

describe('API_PATHS', () => {
  it('lists exactly what the controllers register — a drift guard, not a copy', () => {
    // Arrange & Act: read the prefix each @Controller() declares.
    const registered = CONTROLLERS.map((controller) => {
      const prefix = Reflect.getMetadata(PATH_METADATA, controller) as string;
      return prefix === '/' || prefix === '' ? '/' : `/${prefix}`;
    });

    // Assert: adding a controller without adding it here fails right here.
    expect([...API_PATHS].sort()).toEqual(registered.sort());
  });
});

describe('isApiPath', () => {
  it.each([
    ['/search', true],
    ['/search?q=drill', true],
    ['/', true],
    ['/metrics', true],
    // Not a known path with the wrong verb — just unknown, so it stays a 404.
    ['/searching', false],
    ['/search/extra', false],
    ['/nope', false],
  ])('%s -> %s', (path, expected) => {
    expect(isApiPath(path)).toBe(expected);
  });
});

describe('isAllowedMethod', () => {
  it.each([
    ['GET', true],
    ['head', true],
    ['OPTIONS', true],
    ['POST', false],
    ['DELETE', false],
    ['PATCH', false],
  ])('%s -> %s', (method, expected) => {
    expect(isAllowedMethod(method)).toBe(expected);
  });
});
