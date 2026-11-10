/**
 * Personal AI shopping agent — memory + autonomous rules (S5#1).
 *
 * Pure logic + guest (localStorage) storage for the agent. The
 * signed-in path stores the same shapes in Supabase (migration
 * 027: `agent_memory` + `agent_rules`); this module never imports
 * Supabase, so it is safe to use from client components and from
 * unit tests in plain Node.
 *
 * HONESTY RULES (hard):
 * - Memory exists ONLY with the user's permission. Consent is an
 *   explicit toggle with a delete option; turning memory off clears
 *   the stored record. Nothing here infers preferences the user
 *   did not state, and no preference is ever invented.
 * - A rule ("alert me under $800") is a user-stated target price.
 *   It triggers through the EXISTING alert chain: creating a rule
 *   for a signed-in user also creates a `price_drop` alert with
 *   the same target (see app/api/v1/agent/rules/route.ts), so the
 *   6-hour cron check is the only thing that ever fires it. No
 *   second alert chain is built here.
 * - The deal summary is computed ONLY from real recorded prices
 *   passed in by the caller. A product with no recorded price
 *   reports "Price not recorded" — never a guessed figure, never
 *   a demo/seed price presented as live.
 * - Guest (logged-out) memory and rules live on the device only
 *   (localStorage, same pattern as lib/local-alerts.ts). Nothing
 *   checks them in the background and no email/push is ever sent
 *   for them — the UI must say so on every guest render.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** User-stated shopping preferences. Every field is opt-in. */
export interface AgentPreferences {
  /** Max price the agent should treat as in-budget, in USD. */
  maxBudgetUsd?: number | null;
  /** Categories the user is interested in (user-chosen). */
  categories?: string[];
  /** Brands the user prefers (user-typed, free text). */
  preferredBrands?: string[];
  /** User said they want lightweight products. */
  lightweightOnly?: boolean;
}

/** One signed-in user's agent memory row (migration 027). */
export interface AgentMemory {
  userId: string;
  preferences: AgentPreferences;
  /** Product slugs the user has viewed, most recent first. */
  seenProductSlugs: string[];
  /** When the user granted memory permission, or null. */
  consentGrantedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Notification channel for a rule. 'local' = device-only guest rule. */
export type AgentRuleChannel = 'email' | 'push' | 'both' | 'local';

export interface AgentRule {
  id: string;
  userId: string | null;
  productId: string | null;
  productSlug: string;
  productName: string | null;
  /** User-stated target price in USD — "alert me under $800". */
  targetPriceUsd: number;
  channel: AgentRuleChannel;
  /** The linked `alerts` row id, or null when no alert was created. */
  alertId: string | null;
  active: boolean;
  lastTriggeredAt: string | null;
  triggerCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AgentRuleInput {
  productId?: string;
  productSlug?: string;
  productName?: string | null;
  targetPriceUsd: unknown;
  channel?: AgentRuleChannel;
}

/** One watched product's current state, for the deal summary. */
export interface WatchedProductState {
  slug: string;
  name: string;
  /** Lowest recorded in-stock merchant price in USD, or null. */
  currentPriceUsd: number | null;
  /** The rule target for this product, or null when only watched. */
  targetPriceUsd: number | null;
}

export interface DealSummaryItem {
  slug: string;
  name: string;
  targetPriceUsd: number | null;
  currentPriceUsd: number | null;
  /** True only when a real recorded price is at or under target. */
  targetMet: boolean;
  /** True when no recorded price exists for this product. */
  priceUnknown: boolean;
}

export interface DealSummary {
  /** Plain-language summary built only from the states passed in. */
  text: string;
  items: DealSummaryItem[];
  metCount: number;
  watchedCount: number;
  unknownCount: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Categories the user can pick from — the catalog's real categories. */
export const AGENT_CATEGORIES = [
  'Laptops',
  'Phones',
  'Headphones',
  'Cameras',
  'Wearables',
  'Accessories',
] as const;

/** Max seen products kept per user (oldest dropped first). */
export const MAX_SEEN_PRODUCTS = 50;

/** Max guest rules kept on one device (oldest dropped first). */
export const MAX_GUEST_RULES = 20;

export const GUEST_MEMORY_KEY = 'sb-agent-memory';
export const GUEST_RULES_KEY = 'sb-agent-rules';

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

/** Validate a rule create/update payload. Never invents a product. */
export function validateRuleInput(input: AgentRuleInput): ValidationResult {
  const errors: string[] = [];
  if (!input.productSlug && !input.productId) {
    errors.push('A product is required — pass productSlug or productId.');
  }
  if (typeof input.productSlug === 'string' && input.productSlug.trim() === '') {
    errors.push('productSlug must not be empty.');
  }
  if (typeof input.productId === 'string' && input.productId.trim() === '') {
    errors.push('productId must not be empty.');
  }
  const target = input.targetPriceUsd;
  if (typeof target !== 'number' || !Number.isFinite(target) || target <= 0) {
    errors.push('targetPriceUsd must be a number greater than 0.');
  }
  if (input.channel && !['email', 'push', 'both', 'local'].includes(input.channel)) {
    errors.push("channel must be one of: email, push, both, local.");
  }
  return { ok: errors.length === 0, errors };
}

/** Validate a preferences patch. Budget must be a positive number when set. */
export function validatePreferences(prefs: AgentPreferences): ValidationResult {
  const errors: string[] = [];
  if (
    prefs.maxBudgetUsd !== undefined &&
    prefs.maxBudgetUsd !== null &&
    (typeof prefs.maxBudgetUsd !== 'number' ||
      !Number.isFinite(prefs.maxBudgetUsd) ||
      prefs.maxBudgetUsd <= 0)
  ) {
    errors.push('maxBudgetUsd must be a number greater than 0.');
  }
  if (prefs.categories !== undefined && !Array.isArray(prefs.categories)) {
    errors.push('categories must be an array.');
  }
  if (prefs.preferredBrands !== undefined && !Array.isArray(prefs.preferredBrands)) {
    errors.push('preferredBrands must be an array.');
  }
  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Rules — pure logic
// ---------------------------------------------------------------------------

/**
 * True only when a REAL recorded price exists and is at or under
 * the rule target. A null price never matches — an unpriced product
 * must never fire an alert.
 */
export function ruleMatchesPrice(rule: AgentRule, currentPriceUsd: number | null): boolean {
  if (currentPriceUsd === null || !Number.isFinite(currentPriceUsd)) return false;
  return currentPriceUsd <= rule.targetPriceUsd;
}

/** Dedupe key: one active target per user + product + price. */
export function ruleDedupeKey(userId: string, productSlug: string, targetPriceUsd: number): string {
  return `${userId}::${productSlug.toLowerCase()}::${targetPriceUsd}`;
}

/**
 * Map an agent rule onto the EXISTING alert chain's input shape
 * (services/alerts.ts CreateAlertInput). The rule fires through a
 * normal `price_drop` alert with the rule's target as the
 * condition value — no new trigger mechanism.
 */
export function ruleToAlertInput(rule: AgentRule): {
  productId: string;
  alertType: 'price_drop';
  conditionValue: number;
  channel: 'email' | 'push' | 'both';
} | null {
  if (!rule.productId) return null;
  return {
    productId: rule.productId,
    alertType: 'price_drop',
    conditionValue: rule.targetPriceUsd,
    channel: rule.channel === 'local' ? 'email' : rule.channel,
  };
}

/** One-line honest status for a rule, given its current recorded price. */
export function describeRule(rule: AgentRule, currentPriceUsd: number | null): string {
  if (!rule.active) return `Paused — ${rule.productSlug} under $${rule.targetPriceUsd}.`;
  if (currentPriceUsd === null) {
    return `${rule.productSlug}: price not recorded yet — watching for under $${rule.targetPriceUsd}.`;
  }
  if (currentPriceUsd <= rule.targetPriceUsd) {
    return `${rule.productSlug}: $${currentPriceUsd} is under your $${rule.targetPriceUsd} target.`;
  }
  return `${rule.productSlug}: $${currentPriceUsd} — still above your $${rule.targetPriceUsd} target.`;
}

// ---------------------------------------------------------------------------
// Memory — pure logic
// ---------------------------------------------------------------------------

/** Empty memory for a user who has not set anything up yet. */
export function emptyMemory(userId: string): AgentMemory {
  return {
    userId,
    preferences: {},
    seenProductSlugs: [],
    consentGrantedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Merge a preferences patch over stored preferences. Explicit null
 * clears a field; undefined leaves it alone. Never invents values.
 */
export function applyPreferencesUpdate(
  current: AgentPreferences,
  patch: AgentPreferences
): AgentPreferences {
  const next: AgentPreferences = { ...current };
  if (patch.maxBudgetUsd !== undefined) next.maxBudgetUsd = patch.maxBudgetUsd;
  if (patch.categories !== undefined) {
    next.categories = patch.categories.filter((c) => typeof c === 'string' && c.trim() !== '');
  }
  if (patch.preferredBrands !== undefined) {
    next.preferredBrands = patch.preferredBrands
      .filter((b) => typeof b === 'string' && b.trim() !== '')
      .map((b) => b.trim());
  }
  if (patch.lightweightOnly !== undefined) next.lightweightOnly = patch.lightweightOnly;
  return next;
}

/**
 * Record a viewed product slug: dedupe, most-recent-first, capped.
 * Returns a new array; the input is never mutated.
 */
export function mergeSeenProducts(existing: string[], slug: string, max = MAX_SEEN_PRODUCTS): string[] {
  const clean = slug.trim();
  if (!clean) return [...existing];
  const rest = existing.filter((s) => s !== clean);
  return [clean, ...rest].slice(0, max);
}

// ---------------------------------------------------------------------------
// Deal summary — deterministic, from real recorded prices only
// ---------------------------------------------------------------------------

/**
 * Build the agent's deal summary from the watched products' real
 * recorded prices. The summary text is assembled only from the
 * states passed in — a product with no recorded price is counted
 * as unknown, never priced.
 */
export function summarizeDealsForMemory(
  watched: WatchedProductState[],
  preferences: AgentPreferences = {}
): DealSummary {
  const items: DealSummaryItem[] = watched.map((w) => ({
    slug: w.slug,
    name: w.name,
    targetPriceUsd: w.targetPriceUsd,
    currentPriceUsd: w.currentPriceUsd,
    targetMet:
      w.targetPriceUsd !== null &&
      w.currentPriceUsd !== null &&
      w.currentPriceUsd <= w.targetPriceUsd,
    priceUnknown: w.currentPriceUsd === null,
  }));

  const metCount = items.filter((i) => i.targetMet).length;
  const unknownCount = items.filter((i) => i.priceUnknown).length;
  const watchedCount = items.length;

  let text: string;
  if (watchedCount === 0) {
    text = 'You are not watching any products yet. Set a target price on a product and I will watch it for you.';
  } else if (metCount > 0) {
    const met = items.filter((i) => i.targetMet);
    const names = met.map((i) => `${i.name} ($${i.currentPriceUsd})`).join(', ');
    text =
      `${metCount} of ${watchedCount} watched product${watchedCount === 1 ? '' : 's'} ` +
      `is at or under your target price: ${names}. ` +
      `Prices are the lowest recorded in-stock merchant prices, not live retailer prices.`;
  } else if (unknownCount === watchedCount) {
    text =
      `Watching ${watchedCount} product${watchedCount === 1 ? '' : 's'}, but no recorded price ` +
      `is available for any of them yet, so there is nothing to compare against your targets.`;
  } else {
    text =
      `Watching ${watchedCount} product${watchedCount === 1 ? '' : 's'} — none is at or under ` +
      `your target price yet.`;
    if (unknownCount > 0) {
      text += ` ${unknownCount} has no recorded price yet.`;
    }
  }

  if (
    preferences.maxBudgetUsd !== undefined &&
    preferences.maxBudgetUsd !== null &&
    watchedCount > 0
  ) {
    const inBudget = items.filter(
      (i) => i.currentPriceUsd !== null && i.currentPriceUsd <= (preferences.maxBudgetUsd as number)
    ).length;
    text += ` ${inBudget} of ${watchedCount} is within your $${preferences.maxBudgetUsd} budget.`;
  }

  return { text, items, metCount, watchedCount, unknownCount };
}

// ---------------------------------------------------------------------------
// Guest (device-only) storage — same fail-safe pattern as local-alerts
// ---------------------------------------------------------------------------

function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

function newLocalId(prefix: string): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // Fall through to the non-crypto fallback below.
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface GuestMemory {
  preferences: AgentPreferences;
  seenProductSlugs: string[];
  consentGrantedAt: string | null;
}

function isValidGuestMemory(value: unknown): value is GuestMemory {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.preferences === 'object' &&
    v.preferences !== null &&
    Array.isArray(v.seenProductSlugs) &&
    (v.consentGrantedAt === null || typeof v.consentGrantedAt === 'string')
  );
}

/** Load guest memory. Missing, corrupt, or unavailable storage → null. Never throws. */
export function loadGuestMemory(): GuestMemory | null {
  try {
    const store = storage();
    if (!store) return null;
    const raw = store.getItem(GUEST_MEMORY_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isValidGuestMemory(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Save guest memory. Returns false when storage is unavailable. Never throws. */
export function saveGuestMemory(memory: GuestMemory): boolean {
  try {
    const store = storage();
    if (!store) return false;
    store.setItem(GUEST_MEMORY_KEY, JSON.stringify(memory));
    return true;
  } catch {
    return false;
  }
}

/** Delete guest memory from this device. Never throws. */
export function clearGuestMemory(): void {
  try {
    storage()?.removeItem(GUEST_MEMORY_KEY);
  } catch {
    // Deleting must never break the UI.
  }
}

function isValidGuestRule(value: unknown): value is AgentRule {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    v.id.length > 0 &&
    typeof v.productSlug === 'string' &&
    v.productSlug.length > 0 &&
    typeof v.targetPriceUsd === 'number' &&
    Number.isFinite(v.targetPriceUsd) &&
    v.targetPriceUsd > 0 &&
    v.channel === 'local' &&
    typeof v.active === 'boolean'
  );
}

/** Load guest rules. Missing, corrupt, or unavailable storage → []. Never throws. */
export function loadGuestRules(): AgentRule[] {
  try {
    const store = storage();
    if (!store) return [];
    const raw = store.getItem(GUEST_RULES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidGuestRule);
  } catch {
    return [];
  }
}

/** Save guest rules. Returns false when storage is unavailable. Never throws. */
export function saveGuestRules(rules: AgentRule[]): boolean {
  try {
    const store = storage();
    if (!store) return false;
    store.setItem(GUEST_RULES_KEY, JSON.stringify(rules.slice(0, MAX_GUEST_RULES)));
    return true;
  } catch {
    return false;
  }
}

/** Build a new guest rule (device-only, no alert link, never triggers remotely). */
export function newGuestRule(input: AgentRuleInput): AgentRule | null {
  const validation = validateRuleInput({ ...input, channel: 'local' });
  if (!validation.ok) return null;
  const now = new Date().toISOString();
  return {
    id: newLocalId('guest-rule'),
    userId: null,
    productId: typeof input.productId === 'string' ? input.productId : null,
    productSlug: (input.productSlug as string).trim(),
    productName: typeof input.productName === 'string' ? input.productName : null,
    targetPriceUsd: input.targetPriceUsd as number,
    channel: 'local',
    alertId: null,
    active: true,
    lastTriggeredAt: null,
    triggerCount: 0,
    createdAt: now,
    updatedAt: now,
  };
}
