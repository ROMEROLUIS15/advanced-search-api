import { createKeyIdentifier } from './api-key.identity';

describe('createKeyIdentifier (design D33)', () => {
  const identify = createKeyIdentifier(['key-one', 'key-two']);

  it('resolves a configured key to a stable client id', () => {
    expect(identify('key-one')).toBe(identify('key-one'));
    expect(identify('key-one')).toMatch(/^key:[0-9a-f]{16}$/);
  });

  it('gives different keys different ids', () => {
    expect(identify('key-one')).not.toBe(identify('key-two'));
  });

  it('never returns the key itself, since the id reaches the counter store', () => {
    expect(identify('key-one')).not.toContain('key-one');
  });

  it.each([
    ['an unknown key', 'nope'],
    ['an empty string', ''],
    ['nothing at all', undefined],
    // A prefix of a real key must not pass: comparison is over full digests.
    ['a prefix of a real key', 'key-'],
    ['a real key with trailing space', 'key-one '],
  ])('rejects %s', (_name, presented) => {
    expect(identify(presented)).toBeUndefined();
  });

  it('rejects everything when no key is configured', () => {
    const none = createKeyIdentifier([]);

    expect(none('key-one')).toBeUndefined();
  });

  it('compares keys of different lengths without throwing', () => {
    // timingSafeEqual requires equal-length buffers — hashing first is what
    // makes a guess of any length safe to compare at all.
    expect(() => identify('x'.repeat(5000))).not.toThrow();
    expect(identify('x'.repeat(5000))).toBeUndefined();
  });
});
