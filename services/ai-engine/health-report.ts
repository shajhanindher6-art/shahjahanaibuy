/**
 * Section 19, Phase 1 (§12 #8) — best-effort `recordProviderHealth`
 * reporting for AI + refresh providers.
 *
 * `recordProviderHealth` (`services/monitoring.ts`) had ZERO live
 * callers, so `provider_health` was never written (§1 #25). This
 * helper is the one place callers report through: it never throws
 * and never blocks a response — a missing table, an RLS denial, or
 * a null client degrades to a debug log, never an error page.
 * In-memory usage/latency is recorded separately in usage.ts
 * (`recordAiCall`), which needs no client at all.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import { recordProviderHealth, type ProviderHealthUpdate } from '@/services/monitoring';

export async function reportAiProviderHealth(
  supabase: AnySupabaseClient | null | undefined,
  providerKey: string,
  update: Omit<ProviderHealthUpdate, 'providerKey'>
): Promise<void> {
  if (!supabase) return;
  try {
    await recordProviderHealth(supabase, { providerKey, ...update });
  } catch (err) {
    // Best effort only: health reporting must never break the
    // provider call it reports on. (Field is named `provider`,
    // not `providerKey`: the logger redacts any field whose name
    // contains "key".)
    logger.debug('ai-engine: recordProviderHealth failed (best-effort)', {
      provider: providerKey,
      error: String(err),
    });
  }
}
