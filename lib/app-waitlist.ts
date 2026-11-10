/**
 * Native-app waitlist (Section 6 item 18 — trimmed, in-repo only).
 *
 * There is NO native app in the App Store / Google Play yet, and no
 * launch date is promised anywhere. This waitlist only records an
 * email + platform (ios | android) so interested visitors can be told
 * when a native app exists. No emails are sent (Resend is not wired
 * for this), and the row is deduped by UNIQUE(email, platform).
 *
 * Inserts go through the rate-limited API route with the service-role
 * client: the app_waitlist table (migration 033) has NO client insert
 * policy. Until migration 033 runs, joins fail-safe with a 503 and an
 * honest message — never a silent success.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import { isMissingTableError } from '@/lib/live-sessions';

export type WaitlistPlatform = 'ios' | 'android';

export interface WaitlistInput {
  email: string;
  platform: string;
}

export interface WaitlistValidation {
  ok: boolean;
  /** Normalised (trimmed, lower-cased) email when valid. */
  email: string | null;
  platform: WaitlistPlatform | null;
  error: string | null;
}

// Same shape as the CHECK constraint in migration 033, so the API
// rejects exactly what the database would reject (and no earlier).
const EMAIL_PATTERN = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

/** Pure validation — no DB, no network (unit-tested). */
export function validateWaitlistInput(input: WaitlistInput): WaitlistValidation {
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  const platform = typeof input.platform === 'string' ? input.platform.trim().toLowerCase() : '';

  if (!email || !EMAIL_PATTERN.test(email)) {
    return { ok: false, email: null, platform: null, error: 'Enter a valid email address.' };
  }
  if (platform !== 'ios' && platform !== 'android') {
    return { ok: false, email: null, platform: null, error: "Platform must be 'ios' or 'android'." };
  }
  return { ok: true, email, platform, error: null };
}

export type WaitlistJoinResult =
  | { status: 'joined' }
  | { status: 'already_joined' }
  | { status: 'unavailable' };

/**
 * Insert a validated waitlist row. `already_joined` on the
 * UNIQUE(email, platform) violation (23505) — joining twice is not
 * an error. `unavailable` when the table does not exist yet
 * (migration 033 not run) or the insert otherwise fails at the
 * database level.
 */
export async function joinAppWaitlist(
  supabase: AnySupabaseClient,
  input: WaitlistInput
): Promise<WaitlistJoinResult> {
  const validated = validateWaitlistInput(input);
  if (!validated.ok || !validated.email || !validated.platform) {
    return { status: 'unavailable' };
  }
  try {
    const { error } = await supabase.from('app_waitlist').insert({
      email: validated.email,
      platform: validated.platform,
    });
    if (error) {
      if (error.code === '23505') return { status: 'already_joined' };
      if (isMissingTableError(error)) return { status: 'unavailable' };
      logger.warn('joinAppWaitlist: insert failed', { error: error.message });
      return { status: 'unavailable' };
    }
    return { status: 'joined' };
  } catch (err) {
    logger.error('joinAppWaitlist: unexpected error', { error: String(err) });
    return { status: 'unavailable' };
  }
}
