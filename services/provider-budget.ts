/**
 * Sections 21–25, Stage B (B12) — per-provider daily call budgets.
 *
 * Only eBay had a budget (4,500/day, Redis/DB-backed). CSV, Apify,
 * Amazon and Best Buy were unthrottled: a runaway loop could call
 * them without limit. Every registry provider now gets a daily
 * budget, enforced in the shared call guard
 * (services/providers/call-guard.ts) before any provider is called.
 *
 * Shape (deliberately simpler than eBay's, which guards a paid
 * free tier with a shared counter):
 *   - In-memory per-instance counters, one per provider key per
 *     UTC date — the same per-instance limitation the repo's
 *     rate limiter and AI usage counters already carry, stated
 *     here instead of hidden. A shared (Redis/DB) counter needs
 *     owner-confirmed Upstash + a migration, and is NOT claimed.
 *   - FAIL-CLOSED when unconfigured: there is no unlimited
 *     provider. With no env override a provider gets the
 *     conservative default cap (100 calls/day). Setting
 *     `PROVIDER_DAILY_BUDGET_<KEY>=0` disables that provider
 *     outright. A provider is never silently unthrottled.
 *   - A spent reservation is never refunded (the call was made);
 *     a call refused at the cap spends nothing.
 *   - Never throws: a bad env value falls back to the default
 *     cap and logs a warning.
 */

import { logger } from '@/lib/config/logger';
import { ProviderBudgetExhaustedError } from './providers/errors';

/** Conservative default: no registry provider may be called more than this per day without an explicit owner override. */
export const PROVIDER_DEFAULT_DAILY_BUDGET = 100;

/**
 * Per-provider default daily caps (official API limits, not
 * guesses): a provider listed here gets its documented limit
 * instead of the conservative default. An explicit env override
 * (`PROVIDER_DAILY_BUDGET_<KEY>`) still wins over both.
 *   - Best Buy Products API terms: 5 calls/second, 50,000/day.
 *     The 100/day default would throttle the first real Best
 *     Buy client to a standstill, so the documented limit is
 *     the default here. The 5/second pace is enforced separately
 *     by the client's own 200ms throttle.
 */
export const PROVIDER_DEFAULT_DAILY_BUDGETS: Record<string, number> = {
  bestbuy: 50_000,
};

export interface ProviderBudgetState {
  providerKey: string;
  /** Calls already spent today (UTC date). */
  used: number;
  limit: number;
  remaining: number;
  /** False only when the cap is reached. */
  allowed: boolean;
  /** UTC date the counter belongs to (`YYYY-MM-DD`). */
  dateKey: string;
  /** True when the limit came from an explicit env override. */
  fromEnv: boolean;
  /** True when this reservation actually spent one call (false when refused at the cap). */
  spent: boolean;
}

function utcDateKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function envVarName(providerKey: string): string {
  return `PROVIDER_DAILY_BUDGET_${providerKey.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
}

/** Resolve the daily cap for a provider: env override, else the provider's documented default, else the conservative default. */
export function getProviderDailyBudgetLimit(
  providerKey: string,
  env: NodeJS.ProcessEnv = process.env
): { limit: number; fromEnv: boolean } {
  const raw = env[envVarName(providerKey)];
  if (raw === undefined || raw.trim() === '') {
    const documented = PROVIDER_DEFAULT_DAILY_BUDGETS[providerKey.toLowerCase()];
    if (typeof documented === 'number') {
      return { limit: documented, fromEnv: false };
    }
    return { limit: PROVIDER_DEFAULT_DAILY_BUDGET, fromEnv: false };
  }
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    logger.warn('provider-budget: invalid daily-budget env value — using default cap', {
      provider: providerKey,
      envVar: envVarName(providerKey),
    });
    return { limit: PROVIDER_DEFAULT_DAILY_BUDGET, fromEnv: false };
  }
  return { limit: parsed, fromEnv: true };
}

// In-memory counters: `${providerKey}:${dateKey}` -> calls spent.
const counters = new Map<string, number>();

/** Read-only usage for a provider (never reserves, never throws). */
export function getProviderBudgetUsage(
  providerKey: string,
  now: Date = new Date()
): ProviderBudgetState {
  const dateKey = utcDateKey(now);
  const { limit, fromEnv } = getProviderDailyBudgetLimit(providerKey);
  const used = counters.get(`${providerKey}:${dateKey}`) ?? 0;
  return {
    providerKey,
    used,
    limit,
    remaining: Math.max(0, limit - used),
    allowed: used < limit,
    dateKey,
    fromEnv,
    spent: false,
  };
}

/**
 * Reserve one call from the provider's daily budget. Returns the
 * state AFTER the reservation; when the cap is already reached it
 * returns `allowed: false` WITHOUT spending. Throws
 * ProviderBudgetExhaustedError via `checkProviderBudget` — this
 * function itself never throws.
 */
export function reserveProviderBudgetCall(
  providerKey: string,
  now: Date = new Date()
): ProviderBudgetState {
  const state = getProviderBudgetUsage(providerKey, now);
  if (!state.allowed) return state;
  counters.set(`${providerKey}:${state.dateKey}`, state.used + 1);
  return {
    ...state,
    used: state.used + 1,
    remaining: Math.max(0, state.limit - (state.used + 1)),
    allowed: state.used + 1 < state.limit,
    spent: true,
  };
}

/**
 * Enforce the budget before a provider call: reserve one call, or
 * throw ProviderBudgetExhaustedError when the cap is reached.
 * A denied call spends nothing. A reservation that exactly hits
 * the cap IS allowed (it spent the last call); only the next call
 * is refused.
 */
export function checkProviderBudget(providerKey: string, now: Date = new Date()): ProviderBudgetState {
  const state = reserveProviderBudgetCall(providerKey, now);
  if (!state.spent) {
    throw new ProviderBudgetExhaustedError(providerKey, state.limit, state.used);
  }
  return state;
}

/** Test-only reset of the in-memory counters. */
export function resetProviderBudgets(): void {
  counters.clear();
}
