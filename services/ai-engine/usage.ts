/**
 * Section 19, Phase 1 (§12 #5, #7, #9, #13) — AI usage / quota /
 * latency tracking (in-memory) + the global provider budgets.
 *
 * STORAGE LIMITATION (read before relying on these numbers): every
 * counter here is per-instance in-memory state. It resets on
 * deploy / instance recycle and is NOT shared between Vercel
 * instances — the same limitation as the existing in-memory rate
 * limits (`lib/api/middleware.ts`) and the public-API quota
 * fallback (`lib/api-quota.ts`). Durable per-user AI usage needs
 * an owner-applied migration for a usage table; no such migration
 * is written here (the audit authorises migration files only for
 * duplicate-deal + outcomes/032). Provider-level durability DOES
 * exist: `reportAiProviderHealth` (health-report.ts) writes
 * success/failure counts + avg latency to `provider_health` via
 * `recordProviderHealth` (`services/monitoring.ts`), which the
 * admin pages can read. Treat the in-memory numbers as a live
 * guardrail, not an audited ledger.
 *
 * Numbers (all documented with their justification):
 * - AI_USER_DAILY_QUOTA = 300 calls/day per signed-in user across
 *   AI routes. A human doing one AI call every 2 minutes for 10
 *   hours makes 300; the quota binds abuse (e.g. a scripted loop),
 *   not real use. Anonymous users keep the per-IP per-minute
 *   limits as their floor (they have no identity to budget).
 * - Anon per-minute caps on the quota-spending routes (tightened
 *   12 Nov 2026 — the audit §1 #9 found 20 distinct queries/min
 *   could exhaust a month of SerpAPI free quota in minutes):
 *   ai-search 20 → 10/min, visual-search 10 → 5/min, scan 10 →
 *   5/min. The caps are per IP per minute; the global daily
 *   provider budget below is the second line of defence.
 * - SERPAPI_DAILY_BUDGET = 5 live calls/day/instance. SerpAPI's
 *   free plan is ~100–250 searches/month; 5/day ≈ 150/month sits
 *   inside that band. Cached hits (24h memory / 7d DB) spend
 *   NOTHING and do not count. When exhausted, callers serve the
 *   deterministic/catalog fallback with an honest
 *   "web results unavailable today" label instead of spending more.
 * - HF_DAILY_BUDGET = 50 live calls/day/instance. Hugging Face's
 *   free Inference API is rate-limited rather than monthly-capped,
 *   so this is a guardrail against a burst, not a quota claim.
 * - Circuit: open after 5 consecutive provider failures, 60 s
 *   cooldown — the SAME threshold as the durable circuit in
 *   `services/monitoring.ts` (circuit_open at >= 5 consecutive
 *   failures). The in-memory circuit is the live gate the engine
 *   consults before trying a provider; the DB row is the durable
 *   record. Both must stay at 5.
 */

import { logger } from '@/lib/config/logger';
import {
  isSharedAiQuotaConfigured,
  checkSharedUserQuota,
  readSharedProviderBudget,
  spendSharedProviderBudget,
} from './quota-store';

// ---------------------------------------------------------------------------
// Constants (the numbers above, in one place for tests + routes)
// ---------------------------------------------------------------------------

/** Signed-in user AI budget: calls/day across all AI routes. */
export const AI_USER_DAILY_QUOTA = 300;

/** Anonymous per-minute caps on the provider-quota-spending routes (§12 #7). */
export const AI_SEARCH_ANON_PER_MIN = 10;
export const VISUAL_SEARCH_ANON_PER_MIN = 5;
export const SCAN_ANON_PER_MIN = 5;

/** Global daily live-call budgets per provider key (§12 #7). */
export const PROVIDER_DAILY_BUDGETS: Record<string, number> = {
  serpapi: 5,
  huggingface: 50,
};

/** Consecutive failures before the in-memory circuit opens (mirrors monitoring.ts). */
export const AI_CIRCUIT_FAILURE_THRESHOLD = 5;
/** How long an open circuit stays open before a retry is allowed. */
export const AI_CIRCUIT_COOLDOWN_MS = 60_000;

// ---------------------------------------------------------------------------
// State (per-instance, in-memory — see the header limitation)
// ---------------------------------------------------------------------------

export interface AiProviderUsage {
  key: string;
  calls: number;
  success: number;
  failure: number;
  totalLatencyMs: number;
  consecutiveFailures: number;
  circuitOpenedAt: number | null;
  lastCalledAt: string | null;
}

export interface AiCapabilityUsage {
  capability: string;
  calls: number;
  success: number;
  failure: number;
  totalLatencyMs: number;
}

export interface AiProviderBudgetState {
  key: string;
  used: number;
  budget: number;
  remaining: number;
  exhausted: boolean;
}

export interface AiUsageSummary {
  generatedAt: string;
  note: string;
  /**
   * Final 100%, F-P2-56 — machine-readable enforcement labelling.
   * 'shared' = Upstash counters active (cross-instance, real
   * enforcement). 'per-instance' = in-memory counters only: a user
   * can exceed the daily quota by hitting different Vercel
   * instances. Never claim shared enforcement when this is
   * 'per-instance'.
   */
  enforcement: 'shared' | 'per-instance';
  providers: Array<{
    key: string;
    calls: number;
    success: number;
    failure: number;
    avgLatencyMs: number | null;
    consecutiveFailures: number;
    circuitOpen: boolean;
    lastCalledAt: string | null;
  }>;
  capabilities: Array<{
    capability: string;
    calls: number;
    success: number;
    failure: number;
    avgLatencyMs: number | null;
  }>;
  budgets: AiProviderBudgetState[];
}

const IN_MEMORY_NOTE =
  'In-memory per-instance counters (reset on deploy; not shared across instances). ' +
  'Durable per-user usage needs an owner-applied migration — none is written for this. ' +
  'Provider-level counts are also written to provider_health (durable) via recordProviderHealth.';

const providerUsage = new Map<string, AiProviderUsage>();
const capabilityUsage = new Map<string, AiCapabilityUsage>();
const userDayBuckets = new Map<string, { day: string; count: number }>();
const providerDaySpend = new Map<string, { day: string; used: number }>();

function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

function nextUtcMidnightIso(): string {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return next.toISOString();
}

function getOrCreateProvider(key: string): AiProviderUsage {
  let entry = providerUsage.get(key);
  if (!entry) {
    entry = {
      key,
      calls: 0,
      success: 0,
      failure: 0,
      totalLatencyMs: 0,
      consecutiveFailures: 0,
      circuitOpenedAt: null,
      lastCalledAt: null,
    };
    providerUsage.set(key, entry);
  }
  return entry;
}

// ---------------------------------------------------------------------------
// Per-provider calls + latency (§12 #5, #9)
// ---------------------------------------------------------------------------

export function recordAiCall(
  providerKey: string,
  outcome: { success: boolean; latencyMs: number }
): void {
  const entry = getOrCreateProvider(providerKey);
  entry.calls += 1;
  entry.totalLatencyMs += Math.max(0, Math.round(outcome.latencyMs));
  entry.lastCalledAt = new Date().toISOString();
  if (outcome.success) {
    entry.success += 1;
    entry.consecutiveFailures = 0;
    entry.circuitOpenedAt = null;
  } else {
    entry.failure += 1;
    entry.consecutiveFailures += 1;
    if (entry.consecutiveFailures >= AI_CIRCUIT_FAILURE_THRESHOLD && entry.circuitOpenedAt === null) {
      entry.circuitOpenedAt = Date.now();
      logger.warn('ai-engine: circuit opened for provider', {
        providerKey,
        consecutiveFailures: entry.consecutiveFailures,
      });
    }
  }
}

/**
 * True when the provider's in-memory circuit is open: 5+
 * consecutive failures and still inside the 60 s cooldown. After
 * the cooldown the circuit half-opens (one trial call allowed);
 * `recordAiCall` closes it again on success.
 */
export function isAiCircuitOpen(providerKey: string): boolean {
  const entry = providerUsage.get(providerKey);
  if (!entry || entry.circuitOpenedAt === null) return false;
  if (Date.now() - entry.circuitOpenedAt >= AI_CIRCUIT_COOLDOWN_MS) {
    // Half-open: clear the timestamp so the engine tries once.
    // A fresh failure re-opens it immediately (consecutive count
    // is still >= threshold); a success closes it via recordAiCall.
    entry.circuitOpenedAt = null;
    return false;
  }
  return true;
}

export function recordAiCapabilityCall(
  capability: string,
  latencyMs: number,
  success: boolean
): void {
  let entry = capabilityUsage.get(capability);
  if (!entry) {
    entry = { capability, calls: 0, success: 0, failure: 0, totalLatencyMs: 0 };
    capabilityUsage.set(capability, entry);
  }
  entry.calls += 1;
  entry.totalLatencyMs += Math.max(0, Math.round(latencyMs));
  if (success) entry.success += 1;
  else entry.failure += 1;
}

// ---------------------------------------------------------------------------
// Global daily provider budgets (§12 #7b)
// ---------------------------------------------------------------------------

function getBudget(key: string): number {
  return PROVIDER_DAILY_BUDGETS[key] ?? Number.POSITIVE_INFINITY;
}

export function getProviderBudgetState(key: string): AiProviderBudgetState {
  const budget = getBudget(key);
  const day = utcDay();
  const spent = providerDaySpend.get(key);
  const used = spent && spent.day === day ? spent.used : 0;
  return {
    key,
    used,
    budget: Number.isFinite(budget) ? budget : 0,
    remaining: Number.isFinite(budget) ? Math.max(0, budget - used) : Number.POSITIVE_INFINITY,
    exhausted: Number.isFinite(budget) ? used >= budget : false,
  };
}

export function isProviderBudgetExhausted(providerKey: string): boolean {
  return getProviderBudgetState(providerKey).exhausted;
}

/**
 * Spend-alert threshold (Section 19, §12 #7): the admin AI page
 * warns when a provider has used this share of its daily budget.
 * 80% leaves one SerpAPI call (5/day) and ten HF calls (50/day)
 * of headroom after the alert fires — early enough to act, late
 * enough not to cry wolf at the first call of the day.
 */
export const SPEND_ALERT_THRESHOLD = 0.8;

export interface SpendAlertBudget {
  key: string;
  used: number;
  budget: number;
  /** Share of the daily budget used (0–1; 1 when exhausted). */
  percentUsed: number;
  exhausted: boolean;
}

/**
 * The budgets that have reached the spend-alert threshold, from a
 * usage summary's `budgets` array (or any AiProviderBudgetState
 * list). Pure — the admin AI page calls this on the payload it
 * already fetches; no new read, no counter touched. Budgets with
 * no cap (budget 0 / unbounded) never alert.
 */
export function spendAlertBudgets(
  budgets: AiProviderBudgetState[]
): SpendAlertBudget[] {
  return budgets
    .filter((b) => b.budget > 0 && b.used / b.budget >= SPEND_ALERT_THRESHOLD)
    .map((b) => ({
      key: b.key,
      used: b.used,
      budget: b.budget,
      percentUsed: b.used / b.budget,
      exhausted: b.exhausted,
    }));
}

/**
 * Spend one live call against the provider's daily budget. Returns
 * false (and spends nothing) when the budget is already exhausted
 * — callers must then serve the deterministic/catalog fallback
 * with an honest label, never call the provider anyway. Cache
 * hits must NOT call this: only real provider calls spend.
 */
export function spendProviderBudget(providerKey: string): boolean {
  if (isProviderBudgetExhausted(providerKey)) return false;
  const day = utcDay();
  const spent = providerDaySpend.get(providerKey);
  if (!spent || spent.day !== day) {
    providerDaySpend.set(providerKey, { day, used: 1 });
  } else {
    spent.used += 1;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Per-user daily AI quota (§12 #13)
// ---------------------------------------------------------------------------

export interface AiUserQuotaCheck {
  allowed: boolean;
  remaining: number;
  resetAt: string;
}

/**
 * Per-user AI budget for signed-in users: AI_USER_DAILY_QUOTA
 * calls/day across AI routes (in-memory per-instance buckets —
 * same limitation as the header note). Anonymous users have no
 * identity to budget, so they keep the per-IP per-minute limits
 * as their floor. Returns allowed:false once the day's budget is
 * spent; the caller answers 429 with `resetAt` (next UTC
 * midnight). This CHECKS and INCREMENTS in one call — call it
 * once per request, after auth, before the AI work runs.
 */
export function checkAiUserQuota(userId: string): AiUserQuotaCheck {
  const day = utcDay();
  const resetAt = nextUtcMidnightIso();
  // Opportunistic prune so the map cannot grow unboundedly across
  // days (one entry per user per day; stale days dropped when the
  // map gets large).
  if (userDayBuckets.size > 10_000) {
    for (const [key, bucket] of userDayBuckets) {
      if (bucket.day !== day) userDayBuckets.delete(key);
    }
  }
  const key = `${userId}:${day}`;
  let bucket = userDayBuckets.get(key);
  if (!bucket) {
    bucket = { day, count: 0 };
    userDayBuckets.set(key, bucket);
  }
  if (bucket.count >= AI_USER_DAILY_QUOTA) {
    return { allowed: false, remaining: 0, resetAt };
  }
  bucket.count += 1;
  return { allowed: true, remaining: AI_USER_DAILY_QUOTA - bucket.count, resetAt };
}

// ---------------------------------------------------------------------------
// Admin summary (§12 #5, #9 — read by the Phase 7 /admin/ai page)
// ---------------------------------------------------------------------------

export function getAiUsageSummary(): AiUsageSummary {
  const providers = Array.from(providerUsage.values()).map((p) => ({
    key: p.key,
    calls: p.calls,
    success: p.success,
    failure: p.failure,
    avgLatencyMs: p.calls > 0 ? Math.round(p.totalLatencyMs / p.calls) : null,
    consecutiveFailures: p.consecutiveFailures,
    circuitOpen: isAiCircuitOpen(p.key),
    lastCalledAt: p.lastCalledAt,
  }));
  const capabilities = Array.from(capabilityUsage.values()).map((c) => ({
    capability: c.capability,
    calls: c.calls,
    success: c.success,
    failure: c.failure,
    avgLatencyMs: c.calls > 0 ? Math.round(c.totalLatencyMs / c.calls) : null,
  }));
  return {
    generatedAt: new Date().toISOString(),
    note: IN_MEMORY_NOTE,
    // Sync summary never consults Upstash — always per-instance.
    enforcement: 'per-instance',
    providers,
    capabilities,
    budgets: Object.keys(PROVIDER_DAILY_BUDGETS).map((key) => getProviderBudgetState(key)),
  };
}

/** Test-only reset for every in-memory counter in this module. */
export function resetAiUsage(): void {
  providerUsage.clear();
  capabilityUsage.clear();
  userDayBuckets.clear();
  providerDaySpend.clear();
}

// ---------------------------------------------------------------------------
// Shared-counter wrappers (Section 21–25, Stage J, J-P2-6)
// ---------------------------------------------------------------------------

/**
 * Async per-user quota check: tries the shared Upstash counter
 * first (see `quota-store.ts`); falls back to the in-memory
 * `checkAiUserQuota` when Upstash is unconfigured or Redis
 * errors. All AI routes call THIS, not the sync version — the
 * sync version is the in-memory fallback and the test seam.
 * The bypass is closed only when `isSharedAiQuotaConfigured()`
 * is true (Upstash confirmed in Vercel — owner-gated).
 */
export async function checkAiUserQuotaAsync(userId: string): Promise<AiUserQuotaCheck> {
  const resetAt = nextUtcMidnightIso();
  const shared = await checkSharedUserQuota(userId, AI_USER_DAILY_QUOTA);
  if (shared) {
    return {
      allowed: shared.allowed,
      remaining: shared.remaining,
      resetAt,
    };
  }
  return checkAiUserQuota(userId);
}

/** Async provider-budget state: shared first, in-memory fallback. */
export async function getProviderBudgetStateAsync(key: string): Promise<AiProviderBudgetState> {
  const budget = getBudget(key);
  if (Number.isFinite(budget)) {
    const shared = await readSharedProviderBudget(key, budget);
    if (shared) {
      return {
        key,
        used: shared.used,
        budget: shared.budget,
        remaining: shared.remaining,
        exhausted: shared.exhausted,
      };
    }
  }
  return getProviderBudgetState(key);
}

/** Async provider-budget exhaustion check: shared first, in-memory fallback. */
export async function isProviderBudgetExhaustedAsync(providerKey: string): Promise<boolean> {
  const state = await getProviderBudgetStateAsync(providerKey);
  return state.exhausted;
}

/**
 * Async provider-budget spend: shared first (denied calls spend
 * nothing), in-memory fallback. Returns false when exhausted.
 */
export async function spendProviderBudgetAsync(providerKey: string): Promise<boolean> {
  const budget = getBudget(providerKey);
  if (Number.isFinite(budget)) {
    const shared = await spendSharedProviderBudget(providerKey, budget);
    if (shared !== null) return shared;
  }
  return spendProviderBudget(providerKey);
}

/**
 * Async admin summary: same shape as `getAiUsageSummary`, but the
 * `budgets` array reads the shared counters when they are active.
 * The per-provider / per-capability call counts stay per-instance
 * in-memory (no shared ledger exists for those yet) — the summary
 * note says so.
 */
export async function getAiUsageSummaryAsync(): Promise<AiUsageSummary> {
  const summary = getAiUsageSummary();
  const sharedActive = isSharedAiQuotaConfigured();
  const budgets = await Promise.all(
    Object.keys(PROVIDER_DAILY_BUDGETS).map((key) => getProviderBudgetStateAsync(key))
  );
  return {
    ...summary,
    enforcement: sharedActive ? 'shared' : 'per-instance',
    budgets,
    note:
      summary.note +
      (sharedActive
        ? ' Shared Upstash counters are ACTIVE: budgets above are cross-instance.'
        : ' Shared Upstash counters are NOT configured: budgets above are this instance only.'),
  };
}
