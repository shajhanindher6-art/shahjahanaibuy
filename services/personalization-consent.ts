/**
 * Personalization opt-out (Section 19, Phase 4, §12 #43).
 *
 * Until now the only consent in the repo was analytics consent
 * (lib/consent.ts): personalization ran on any signed-in user by
 * virtue of having an account, with no choice disclosed. This is
 * the choice: a per-user opt-out that `getRecommendations` and
 * the personalised feeds honour.
 *
 * STORE (no new migration — the task forbids one, and neither
 * `user_settings` (migration 001) nor `user_preferences`
 * (migration 008) has a personalization column):
 *
 * The flag lives in `agent_memory.preferences` (migration 027) as
 * the `personalizationOptOut` key — the one existing user-owned
 * jsonb blob already used for per-user shopping preferences
 * (maxBudgetUsd, categories, preferredBrands; see
 * lib/agent-memory.ts). Only that key is read or written here;
 * every other key in the blob is preserved untouched, and the
 * agent-memory consent (`consent_granted_at`) is NOT touched —
 * opting out of recommendations personalization is a separate
 * choice from opting into agent memory.
 *
 * LIMITATION (documented, not hidden): migration 027 is in the
 * owner-pending set (026–034, application status UNKNOWN), so
 * until the owner applies it the table may not exist live. The
 * reads then fail safe to "not opted out" (the current behaviour
 * — a missing table must never silently change what a user sees),
 * and the writes return `{ ok: false, unavailable: true }` so the
 * settings UI says "not available yet" instead of pretending the
 * toggle saved. The proper home is a future migration adding
 * `user_preferences.personalization_opted_out boolean NOT NULL
 * DEFAULT false`; when it exists, these two functions should move
 * there and this file becomes a thin wrapper.
 *
 * HONOURING (in services/ai-recommendations.ts): when opted out,
 * `getRecommendations` returns trending-only results WITHOUT
 * reading wishlist / search-history / product-view signals at all
 * — an opt-out that still reads the signals it claims to ignore
 * is not an opt-out. The context carries `personalizationOptOut:
 * true` and the reason is labelled "Trending — personalisation is
 * off for your account", so the UI can say so honestly. The
 * dismissals in the "Not interested" list are likewise not read
 * while opted out (they are personal signals too); a dismissed
 * product can therefore reappear in the trending fallback until
 * the user opts back in — that tradeoff is stated here, not hidden.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';

export const PERSONALIZATION_OPT_OUT_KEY = 'personalizationOptOut';

/** True only when the user explicitly opted out. Missing table / missing row / any read failure → false (opted in, current behaviour). */
export async function getPersonalizationOptOut(
  supabase: AnySupabaseClient,
  userId: string
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('agent_memory')
      .select('preferences')
      .eq('user_id', userId)
      .maybeSingle();
    if (error || !data) return false;
    const prefs = (data as Record<string, unknown>).preferences as
      | Record<string, unknown>
      | null;
    return prefs?.[PERSONALIZATION_OPT_OUT_KEY] === true;
  } catch (err) {
    logger.warn('personalization-consent: opt-out read failed, defaulting to opted-in', {
      error: String(err),
    });
    return false;
  }
}

export interface SetPersonalizationOptOutResult {
  ok: boolean;
  optedOut: boolean;
  /** True when the store is unavailable (migration 027 unapplied) — the toggle did NOT save. */
  unavailable: boolean;
}

/**
 * Set (or clear) the opt-out. Merges into the existing
 * `agent_memory.preferences` blob, preserving every other key.
 * Creates the row when the user has no agent-memory row yet — the
 * row then carries only this flag, not invented preferences.
 */
export async function setPersonalizationOptOut(
  supabase: AnySupabaseClient,
  userId: string,
  optedOut: boolean
): Promise<SetPersonalizationOptOutResult> {
  try {
    const { data: existing, error: readError } = await supabase
      .from('agent_memory')
      .select('preferences')
      .eq('user_id', userId)
      .maybeSingle();
    if (readError) {
      return { ok: false, optedOut, unavailable: true };
    }
    const current =
      existing && typeof (existing as Record<string, unknown>).preferences === 'object'
        ? ((existing as Record<string, unknown>).preferences as Record<string, unknown>)
        : {};
    const next = { ...current, [PERSONALIZATION_OPT_OUT_KEY]: optedOut };
    const { error } = await supabase
      .from('agent_memory')
      .upsert(
        { user_id: userId, preferences: next, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      );
    if (error) {
      logger.warn('personalization-consent: opt-out write failed', { error: error.message });
      return { ok: false, optedOut, unavailable: true };
    }
    return { ok: true, optedOut, unavailable: false };
  } catch (err) {
    logger.warn('personalization-consent: opt-out write failed', { error: String(err) });
    return { ok: false, optedOut, unavailable: true };
  }
}
