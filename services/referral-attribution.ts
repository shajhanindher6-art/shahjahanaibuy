/**
 * Referral signup attribution (Section 15, B13).
 *
 * Referral links themselves are Section 3 item 10 (migration 026:
 * `referral_links` maps a random `sb-…` code to its owner, and
 * `lib/referral.ts` issues the codes). Attribution was absent by
 * design until now: nothing recorded which signups came through
 * which link.
 *
 * Flow: the sign-up page carries `?ref=<code>` through signup
 * (stored in localStorage so it survives the email-confirmation
 * redirect), and after a session exists the client calls
 * POST /api/v1/referrals/attribute, which runs
 * `attributeReferralSignup` below with the service-role client:
 *
 *   1. Resolve the code in `referral_links` (migration 026).
 *      Unknown codes, guest-owned links (user_id NULL) and
 *      self-referrals are ignored silently — never an error, never
 *      a row.
 *   2. Insert one `referral_signups` row (migration 038, UNIQUE
 *      on referred_user_id) and set `profiles.referred_by` — but
 *      only when it is still NULL, so an existing attribution is
 *      never overwritten.
 *
 * Fail-safe: every function here NEVER throws. When migration 038
 * has not been applied yet, the missing table is reported as
 * `not-available` and the signup proceeds unattributed — the
 * signup itself must never fail because attribution is
 * unavailable. No signup is ever invented and no row is ever
 * backfilled: the table only gains rows for signups that actually
 * happened through a valid code.
 */

import { isValidReferralCode } from '@/lib/referral';
import type { AnySupabaseClient } from '@/lib/supabase/types';

export type AttributionOutcome =
  | { attributed: true }
  | {
      attributed: false;
      reason:
        | 'invalid-code'
        | 'unknown-code'
        | 'guest-code'
        | 'self-referral'
        | 'already-attributed'
        | 'not-available';
    };

type SupabaseErrorLike = { code?: string; message?: string };

function isMissingTableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as SupabaseErrorLike;
  // 42P01 = undefined_table (Postgres), PGRST205 = PostgREST
  // "table not found", 42703 = undefined_column (038 not applied
  // yet, e.g. profiles.referred_by does not exist).
  if (err.code === '42P01' || err.code === 'PGRST205' || err.code === '42703') return true;
  return (
    typeof err.message === 'string' &&
    /does not exist|relation .* does not exist/i.test(err.message)
  );
}

function notAvailable(): AttributionOutcome {
  return { attributed: false, reason: 'not-available' };
}

/**
 * Attribute one signup to the owner of a referral code.
 * `service` must be the service-role client (it bypasses RLS —
 * there is intentionally no INSERT policy on referral_signups).
 * Never throws; every non-attribution is a silent reason.
 */
export async function attributeReferralSignup(
  service: AnySupabaseClient,
  newUserId: string,
  code: unknown
): Promise<AttributionOutcome> {
  try {
    if (!isValidReferralCode(code)) {
      return { attributed: false, reason: 'invalid-code' };
    }

    // 1. Resolve the code to its owner (migration 026 table).
    const { data: link, error: linkError } = await service
      .from('referral_links')
      .select('user_id')
      .eq('code', code)
      .maybeSingle();
    if (linkError) {
      if (isMissingTableError(linkError)) return notAvailable();
      return { attributed: false, reason: 'unknown-code' };
    }
    if (!link) return { attributed: false, reason: 'unknown-code' };
    const referrerId = (link as { user_id?: string | null }).user_id ?? null;
    // Guest-owned links have no user to attribute to.
    if (!referrerId) return { attributed: false, reason: 'guest-code' };
    if (referrerId === newUserId) {
      return { attributed: false, reason: 'self-referral' };
    }

    // 2. Already attributed? (UNIQUE on referred_user_id, and
    // profiles.referred_by set — either one means "done".)
    const { data: existing, error: existingError } = await service
      .from('referral_signups')
      .select('id')
      .eq('referred_user_id', newUserId)
      .maybeSingle();
    if (existingError) {
      if (isMissingTableError(existingError)) return notAvailable();
      return notAvailable();
    }
    if (existing) return { attributed: false, reason: 'already-attributed' };

    const { data: profile, error: profileError } = await service
      .from('profiles')
      .select('referred_by')
      .eq('id', newUserId)
      .maybeSingle();
    if (profileError) {
      if (isMissingTableError(profileError)) return notAvailable();
      return notAvailable();
    }
    if (profile && (profile as { referred_by?: string | null }).referred_by) {
      return { attributed: false, reason: 'already-attributed' };
    }

    // 3. Record the signup first (the row is what the count reads),
    // then set profiles.referred_by — only when still NULL, so an
    // existing referrer is never overwritten.
    const { error: insertError } = await service.from('referral_signups').insert({
      referrer_user_id: referrerId,
      referred_user_id: newUserId,
      referral_code: code,
    });
    if (insertError) {
      if ((insertError as SupabaseErrorLike).code === '23505') {
        return { attributed: false, reason: 'already-attributed' };
      }
      if (isMissingTableError(insertError)) return notAvailable();
      return notAvailable();
    }

    const { error: updateError } = await service
      .from('profiles')
      .update({ referred_by: referrerId })
      .eq('id', newUserId)
      .is('referred_by', null);
    if (updateError && !isMissingTableError(updateError)) {
      // The signup row is recorded (the count is correct); a
      // failed profile update must not un-record the signup.
      // Nothing to do — the row stands on its own.
    }

    return { attributed: true };
  } catch {
    // Attribution must never break signup.
    return notAvailable();
  }
}

/**
 * The referrer's own signup count, from real `referral_signups`
 * rows only. `available: false` when migration 038 has not been
 * applied yet — the caller must show no count at all then, never
 * a guessed 0.
 */
export async function countReferralSignups(
  service: AnySupabaseClient,
  referrerUserId: string
): Promise<{ count: number; available: boolean }> {
  try {
    const { count, error } = await service
      .from('referral_signups')
      .select('id', { count: 'exact', head: true })
      .eq('referrer_user_id', referrerUserId);
    if (error) return { count: 0, available: false };
    return { count: typeof count === 'number' ? count : 0, available: true };
  } catch {
    return { count: 0, available: false };
  }
}
