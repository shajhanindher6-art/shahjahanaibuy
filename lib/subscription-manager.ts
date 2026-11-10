/**
 * AI Subscription Manager — Section 7, item 3.
 *
 * CONSUMER subscriptions (Netflix, Spotify, …) — renewal reminders,
 * duplicate / rarely-used flags, and cheaper alternatives ONLY from
 * real recorded data. This is a separate feature from the Stripe
 * Premium-plan API at `app/api/v1/subscriptions` — that route is
 * never touched or reused here.
 *
 * Pure, deterministic helpers over the caller's own recorded
 * subscriptions (migration contract: `consumer_subscriptions`).
 * Nothing here invents a price: when no cheaper alternative is
 * recorded, there is simply no suggestion.
 */

export type BillingInterval = 'monthly' | 'yearly';

export interface ConsumerSubscription {
  id: string;
  userId: string;
  name: string;
  priceUsd: number;
  billingInterval: BillingInterval;
  /** ISO date (YYYY-MM-DD) of the next renewal, or null when unknown. */
  renewalDate: string | null;
  category: string | null;
  isActive: boolean;
  /** ISO date (YYYY-MM-DD) the service was last used, or null when unknown. */
  lastUsedAt: string | null;
  createdAt: string;
}

/** A subscription is "rarely used" when it has not been used for > 90 days. */
export const RARELY_USED_DAYS = 90;

/** A renewal within this many days counts as "renewing soon". */
export const RENEWAL_SOON_DAYS = 7;

export function roundToCents(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Monthly equivalent of a subscription price (yearly ÷ 12). */
export function monthlyCost(priceUsd: number, billingInterval: BillingInterval): number {
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) return 0;
  return roundToCents(billingInterval === 'yearly' ? priceUsd / 12 : priceUsd);
}

/** Total monthly cost of all ACTIVE subscriptions. Inactive ones cost $0. */
export function totalMonthlyCost(subscriptions: ConsumerSubscription[]): number {
  let total = 0;
  for (const sub of subscriptions) {
    if (!sub.isActive) continue;
    total = roundToCents(total + monthlyCost(sub.priceUsd, sub.billingInterval));
  }
  return total;
}

function parseIsoDate(value: string | null): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDayUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Whole days until the renewal date from `now` (defaults to today).
 * Negative when the renewal date has passed, null when no renewal
 * date is recorded — never a guessed date.
 */
export function daysUntilRenewal(
  renewalDate: string | null,
  now: Date = new Date()
): number | null {
  const renewal = parseIsoDate(renewalDate);
  if (!renewal) return null;
  const today = startOfDayUtc(now);
  const diffMs = renewal.getTime() - today.getTime();
  return Math.round(diffMs / 86_400_000);
}

export type RenewalStatus = 'overdue' | 'due-soon' | 'upcoming' | 'no-date';

export function renewalStatus(
  subscription: ConsumerSubscription,
  now: Date = new Date()
): RenewalStatus {
  const days = daysUntilRenewal(subscription.renewalDate, now);
  if (days === null) return 'no-date';
  if (days < 0) return 'overdue';
  if (days <= RENEWAL_SOON_DAYS) return 'due-soon';
  return 'upcoming';
}

/** Active subscriptions whose renewal is due within 7 days (or overdue), soonest first. */
export function renewalReminders(
  subscriptions: ConsumerSubscription[],
  now: Date = new Date()
): ConsumerSubscription[] {
  return subscriptions
    .filter((sub) => sub.isActive)
    .filter((sub) => {
      const status = renewalStatus(sub, now);
      return status === 'due-soon' || status === 'overdue';
    })
    .sort((a, b) => {
      const daysA = daysUntilRenewal(a.renewalDate, now) ?? Number.POSITIVE_INFINITY;
      const daysB = daysUntilRenewal(b.renewalDate, now) ?? Number.POSITIVE_INFINITY;
      return daysA - daysB;
    });
}

/**
 * Normalised name for overlap matching: lowercase, punctuation and
 * extra whitespace removed. "Netflix" and "netflix " are the same
 * service; "Netflix" and "Netflix Premium" are not — the match is
 * exact after normalisation, never fuzzy, so two different services
 * are never flagged as duplicates on a guess.
 */
export function normalizeSubscriptionName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface OverlapGroup {
  normalizedName: string;
  subscriptions: ConsumerSubscription[];
}

/**
 * Groups of ACTIVE subscriptions that share a normalised name — the
 * user is paying twice for what looks like the same service. Only
 * groups of 2+ are returned. Inactive subscriptions never flag.
 */
export function findOverlaps(subscriptions: ConsumerSubscription[]): OverlapGroup[] {
  const groups = new Map<string, ConsumerSubscription[]>();
  for (const sub of subscriptions) {
    if (!sub.isActive) continue;
    const key = normalizeSubscriptionName(sub.name);
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push(sub);
    groups.set(key, list);
  }
  return [...groups.entries()]
    .filter(([, list]) => list.length >= 2)
    .map(([normalizedName, list]) => ({ normalizedName, subscriptions: list }));
}

/** True when the subscription was last used more than 90 days ago. Unknown last-use is never flagged. */
export function isRarelyUsed(subscription: ConsumerSubscription, now: Date = new Date()): boolean {
  const lastUsed = parseIsoDate(subscription.lastUsedAt);
  if (!lastUsed) return false;
  const today = startOfDayUtc(now);
  const diffDays = Math.round((today.getTime() - lastUsed.getTime()) / 86_400_000);
  return diffDays > RARELY_USED_DAYS;
}

export interface RecordedAlternative {
  name: string;
  monthlyPriceUsd: number;
}

/**
 * Cheaper alternative — ONLY from a caller-supplied list of REAL
 * recorded alternatives (e.g. a recorded competitor price). Returns
 * the cheapest strictly-cheaper recorded alternative, or null when
 * none is recorded. When the caller passes no alternatives, the
 * answer is always null: no suggestion is ever invented.
 */
export function findCheaperAlternative(
  subscription: ConsumerSubscription,
  recordedAlternatives: RecordedAlternative[]
): RecordedAlternative | null {
  const currentMonthly = monthlyCost(subscription.priceUsd, subscription.billingInterval);
  if (currentMonthly <= 0) return null;
  let best: RecordedAlternative | null = null;
  for (const alt of recordedAlternatives) {
    if (!Number.isFinite(alt.monthlyPriceUsd) || alt.monthlyPriceUsd <= 0) continue;
    if (alt.monthlyPriceUsd >= currentMonthly) continue;
    if (best === null || alt.monthlyPriceUsd < best.monthlyPriceUsd) best = alt;
  }
  return best;
}
