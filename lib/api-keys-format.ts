/**
 * Public API key format helpers (Section 4, item 18). BROWSER-SAFE —
 * pure constants and string checks only, no Node imports, no Supabase.
 * Import this from client components; the server-only generation and
 * validation live in `lib/api-keys.ts` (which re-exports these).
 *
 * Key format: `sbk_live_` + 32 base64url characters. The prefix is
 * part of the key, not a secret; the random tail is.
 */

export const API_KEY_PREFIX = 'sbk_live_';
export const API_KEY_RANDOM_CHARS = 32;

/** Scopes a public key may carry. Keep in sync with migration 032. */
export const API_KEY_SCOPES = ['products:read', 'prices:read', 'deals:read'] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

/** Shape check only — says nothing about whether the key exists. */
export function isValidApiKeyFormat(key: string): boolean {
  if (!key.startsWith(API_KEY_PREFIX)) return false;
  const tail = key.slice(API_KEY_PREFIX.length);
  return tail.length === API_KEY_RANDOM_CHARS && /^[A-Za-z0-9_-]+$/.test(tail);
}

/**
 * Safe display form: the stored prefix plus an ellipsis. Accepts a full
 * key or an already-stored prefix — either way the secret tail is never
 * exposed.
 */
export function redactApiKey(keyOrPrefix: string): string {
  const prefix = keyOrPrefix.startsWith(API_KEY_PREFIX)
    ? keyOrPrefix.slice(0, API_KEY_PREFIX.length + 8)
    : keyOrPrefix;
  return `${prefix}…`;
}
