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
import {
  recordProviderHealth,
  recordSyncHistory,
  type ProviderHealthUpdate,
  type SyncHistoryEntry,
} from '@/services/monitoring';

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

/**
 * Sections 21–25, Stage B (B4) — best-effort `recordSyncHistory`
 * reporting for real provider calls. `recordSyncHistory` had ZERO
 * callers, so `sync_history` was never written. Same contract as
 * reportAiProviderHealth: never throws, never blocks the call it
 * reports on — a missing table (migration unapplied), an RLS
 * denial, or a null client degrades to a debug log.
 */
export async function reportProviderSyncHistory(
  supabase: AnySupabaseClient | null | undefined,
  entry: SyncHistoryEntry
): Promise<void> {
  if (!supabase) return;
  try {
    await recordSyncHistory(supabase, entry);
  } catch (err) {
    logger.debug('provider sync history failed (best-effort)', {
      provider: entry.providerKey,
      error: String(err),
    });
  }
}
