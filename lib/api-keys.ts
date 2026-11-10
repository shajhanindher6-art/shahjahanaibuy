/**
 * Public API keys (Section 4, item 18). SERVER ONLY — never import from
 * a client component.
 *
 * Security rules:
 * - Only the SHA-256 hash of a key is ever stored (migration 032).
 *   The full key is generated here, returned to its owner exactly
 *   once at creation, and never logged, never stored, never readable
 *   again. `redactApiKey` is the only safe way to display one.
 * - Validation uses the service-role client (RLS would otherwise hide
 *   other users' rows, and the hash lookup must not depend on the
 *   caller's session). A key that cannot be validated is invalid —
 *   fail closed, never fail open.
 * - Key format: `sbk_live_` + 32 base64url characters. The prefix is
 *   part of the key, not a secret; the random tail is.
 * - Format constants and pure string helpers live in the browser-safe
 *   `lib/api-keys-format.ts` (re-exported below so existing server
 *   imports keep working); this file adds only the Node-only parts.
 */

import { createHash, randomBytes } from 'node:crypto';
import { createSupabaseServiceClient } from '@/lib/supabase/service';

export {
  API_KEY_PREFIX,
  API_KEY_RANDOM_CHARS,
  API_KEY_SCOPES,
  isValidApiKeyFormat,
  redactApiKey,
  type ApiKeyScope,
} from './api-keys-format';
import { API_KEY_PREFIX, API_KEY_RANDOM_CHARS, isValidApiKeyFormat } from './api-keys-format';

export interface GeneratedApiKey {
  /** Full key — show once, then forget. Never log or persist. */
  key: string;
  /** First characters, safe to display and to use as a lookup label. */
  keyPrefix: string;
  /** SHA-256 hex of the full key — the only form ever stored. */
  keyHash: string;
}

/** Generate a fresh key. The caller must return `key` to the owner once. */
export function generateApiKey(): GeneratedApiKey {
  const random = randomBytes(24).toString('base64url').slice(0, API_KEY_RANDOM_CHARS);
  const key = `${API_KEY_PREFIX}${random}`;
  return {
    key,
    keyPrefix: key.slice(0, API_KEY_PREFIX.length + 8),
    keyHash: hashApiKey(key),
  };
}

/** SHA-256 hex digest. Deterministic — the same key always hashes the same. */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

/** Read the key a caller sent, if any. Header only — never a query param. */
export function extractApiKey(headers: Headers): string | null {
  const value = headers.get('x-api-key')?.trim();
  return value ? value : null;
}

export interface ValidatedApiKey {
  userId: string;
  keyPrefix: string;
  scopes: string[];
}

/**
 * Validate a presented key against the stored hashes.
 * Returns null for a malformed key, an unknown key, a revoked key, or
 * when the service client is unavailable (fail closed). Best-effort
 * updates `last_used_at`; a failure there never invalidates the key.
 */
export async function validateApiKey(key: string): Promise<ValidatedApiKey | null> {
  if (!isValidApiKeyFormat(key)) return null;

  const service = createSupabaseServiceClient();
  if (!service) return null;

  const keyHash = hashApiKey(key);
  const { data } = await service
    .from('api_keys')
    .select('user_id, key_prefix, scopes, revoked_at')
    .eq('key_hash', keyHash)
    .maybeSingle();

  const row = data as
    | { user_id: string; key_prefix: string; scopes: string[] | null; revoked_at: string | null }
    | null;
  if (!row || row.revoked_at) return null;

  // Best-effort usage stamp — never blocks the request.
  void service
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('key_hash', keyHash)
    .then(
      () => undefined,
      () => undefined
    );

  return {
    userId: row.user_id,
    keyPrefix: row.key_prefix,
    scopes: Array.isArray(row.scopes) ? row.scopes : [],
  };
}
