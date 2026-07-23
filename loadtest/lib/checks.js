import { check } from 'k6';

/**
 * Response validators.
 *
 * A load test that only asserts `status === 200` happily reports a fast, healthy
 * service while it returns empty or malformed bodies. Every scenario therefore
 * validates the payload contract too, and a failed check counts against the
 * `checks` threshold that decides whether the run passed.
 */

function body(res) {
  try {
    return res.json();
  } catch (_error) {
    return null;
  }
}

export function checkSearch(res) {
  const json = body(res);
  return check(res, {
    'search: 200': (r) => r.status === 200,
    'search: data is an array': () => Array.isArray(json && json.data),
    'search: meta.total is a number': () => typeof (json && json.meta && json.meta.total) === 'number',
    'search: facets present': () => Boolean(json && json.facets && json.facets.categories),
    'search: suggestions block present': () => Boolean(json && json.suggestions),
  });
}

export function checkAutocomplete(res) {
  const json = body(res);
  return check(res, {
    'autocomplete: 200': (r) => r.status === 200,
    'autocomplete: data is an array': () => Array.isArray(json && json.data),
  });
}

export function checkSuggest(res) {
  const json = body(res);
  return check(res, {
    'suggest: 200': (r) => r.status === 200,
    'suggest: didYouMean key present': () => Boolean(json && json.data && 'didYouMean' in json.data),
  });
}

export function checkHealth(res) {
  const json = body(res);
  return check(res, {
    'health: 200': (r) => r.status === 200,
    'health: elasticsearch up': () =>
      Boolean(json && json.info && json.info.elasticsearch && json.info.elasticsearch.status === 'up'),
  });
}
