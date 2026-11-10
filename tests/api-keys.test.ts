import { describe, expect, it } from 'vitest';
import {
  API_KEY_PREFIX,
  extractApiKey,
  generateApiKey,
  hashApiKey,
  isValidApiKeyFormat,
  redactApiKey,
} from '@/lib/api-keys';

describe('generateApiKey', () => {
  it('generates a key with the sbk_live_ prefix and 32 random chars', () => {
    const { key } = generateApiKey();
    expect(key.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(key.length).toBe(API_KEY_PREFIX.length + 32);
    expect(isValidApiKeyFormat(key)).toBe(true);
  });

  it('generates a different key every time', () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.key).not.toBe(b.key);
    expect(a.keyHash).not.toBe(b.keyHash);
  });

  it('returns a prefix that never contains the secret tail', () => {
    const { key, keyPrefix } = generateApiKey();
    expect(key.startsWith(keyPrefix)).toBe(true);
    expect(keyPrefix.length).toBeLessThan(key.length);
    expect(keyPrefix).toBe(key.slice(0, API_KEY_PREFIX.length + 8));
  });
});

describe('hashApiKey', () => {
  it('is deterministic and produces a 64-char hex digest', () => {
    const { key, keyHash } = generateApiKey();
    expect(hashApiKey(key)).toBe(keyHash);
    expect(keyHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('never returns anything resembling the key itself', () => {
    const { key, keyHash } = generateApiKey();
    expect(keyHash).not.toContain(key.slice(API_KEY_PREFIX.length));
    expect(keyHash).not.toContain(API_KEY_PREFIX);
  });
});

describe('isValidApiKeyFormat', () => {
  it('accepts a generated key', () => {
    expect(isValidApiKeyFormat(generateApiKey().key)).toBe(true);
  });

  it('rejects wrong prefixes, short tails and illegal characters', () => {
    expect(isValidApiKeyFormat('')).toBe(false);
    expect(isValidApiKeyFormat('sk_live_FAKE')).toBe(false);
    expect(isValidApiKeyFormat(`${API_KEY_PREFIX}short`)).toBe(false);
    expect(isValidApiKeyFormat(`${API_KEY_PREFIX}abcdefghij1234567890abcdefg!`)).toBe(false);
    expect(isValidApiKeyFormat(`${API_KEY_PREFIX}abcdefghij1234567890abcdefg `)).toBe(false);
  });
});

describe('redactApiKey', () => {
  it('shows only the prefix, never the secret tail', () => {
    const { key, keyPrefix } = generateApiKey();
    const redacted = redactApiKey(key);
    expect(redacted).toBe(`${keyPrefix}…`);
    expect(redacted).not.toContain(key.slice(API_KEY_PREFIX.length + 8));
  });

  it('is idempotent on an already-stored prefix', () => {
    const { keyPrefix } = generateApiKey();
    expect(redactApiKey(keyPrefix)).toBe(`${keyPrefix}…`);
  });
});

describe('extractApiKey', () => {
  it('reads the x-api-key header and trims it', () => {
    const key = generateApiKey().key;
    expect(extractApiKey(new Headers({ 'x-api-key': `  ${key} ` }))).toBe(key);
  });

  it('returns null when no key header is present', () => {
    expect(extractApiKey(new Headers())).toBeNull();
    expect(extractApiKey(new Headers({ 'x-api-key': '   ' }))).toBeNull();
  });
});
