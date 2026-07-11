/**
 * Feature flags data access service.
 * Reads from the `feature_flags` table with env-level override support.
 */

import { FEATURE_FLAG_DEFAULTS, type FeatureFlagKey } from '@/lib/config/feature-flags';
import { env } from '@/lib/config/env';
import type { AnySupabaseClient } from '@/lib/supabase/types';

export async function isFeatureEnabled(
  supabase: AnySupabaseClient,
  key: FeatureFlagKey
): Promise<boolean> {
  // Env-level overrides for critical flags
  if (key === 'google_auth' && !env.enableGoogleAuth) return false;
  if (key === 'email_verification' && !env.enableEmailVerification) return false;

  const { data, error } = await supabase
    .from('feature_flags')
    .select('enabled')
    .eq('key', key)
    .maybeSingle();

  if (error || !data) {
    return FEATURE_FLAG_DEFAULTS[key] ?? false;
  }

  return data.enabled;
}

export async function getAllFeatureFlags(
  supabase: AnySupabaseClient
): Promise<Record<string, boolean>> {
  const { data, error } = await supabase
    .from('feature_flags')
    .select('key, enabled')
    .limit(100);

  if (error || !data) {
    return { ...FEATURE_FLAG_DEFAULTS };
  }

  const flags: Record<string, boolean> = {};
  for (const row of data) {
    flags[row.key] = row.enabled;
  }

  // Apply env overrides
  if (!env.enableGoogleAuth) flags['google_auth'] = false;
  if (!env.enableEmailVerification) flags['email_verification'] = false;

  return flags;
}
