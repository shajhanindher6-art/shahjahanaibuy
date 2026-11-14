/**
 * Smart AI Gift & Occasion Recommender — deterministic engine.
 *
 * "Prompt-based" here means a STRUCTURED prompt: the user fills a
 * form (occasion, budget, country, recipient interests) and the
 * engine matches it against the real catalog. There is NO LLM and
 * NO key in this codebase, so the UI must never claim a live AI
 * wrote the picks — the "why this pick" line is computed from the
 * match itself (budget fit + interest keywords + real deal).
 *
 * Hard rules (mirroring services/personal-assistant.ts):
 * - Budget is a HARD filter: a pick over budget is never returned.
 * - Sample Laptop ('sample-laptop') and unpriced products are
 *   NEVER recommended.
 * - Interests are matched against name/brand/category/description
 *   keywords. When interests are given and nothing matches, the
 *   result is honestly empty — never a forced irrelevant pick.
 * - Occasion is display context only (birthday, wedding, ...): the
 *   catalog has no occasion tagging, and inventing an occasion →
 *   product mapping would be fake personalization. It shapes the
 *   heading and the "why" wording, not the filter.
 * - Shipping: no live shipping costs exist anywhere in this codebase,
 *   so the route/page show a plain note that shipping/taxes are
 *   confirmed at the retailer's checkout. No fee or date is invented.
 */

import { discountPercent } from '@/lib/deal-math';
import { EXCLUDED_SLUGS } from '@/lib/public-products';

/** Alias of the shared EXCLUDED_SLUGS (Stage 2, S2-1) — kept so existing importers keep working. */
export const GIFT_EXCLUDED_SLUGS = EXCLUDED_SLUGS;

/**
 * Shipping honesty note (shown by the route + page): no live shipping
 * costs exist anywhere in this codebase, so no fee or date is invented.
 */
export const SHIPPING_NOTE =
  'Shipping costs, taxes, and delivery dates are not shown because SmartBuy has no live shipping data — please confirm them at the retailer\u2019s checkout before ordering.';

export interface GiftCandidate {
  id: string;
  name: string;
  slug: string;
  brand: string | null;
  category: string | null;
  description: string | null;
  bestPriceUsd: number | null;
  compareAtUsd: number | null;
  merchantName: string | null;
  couponLabel: string | null;
}

export interface GiftPick extends GiftCandidate {
  matchedInterests: string[];
  savingPct: number | null;
  why: string[];
}

export interface GiftEngineInput {
  budgetUsd: number | null;
  interests: string[];
  limit?: number;
}

function tokenizeInterests(interests: string[]): string[] {
  const out: string[] = [];
  for (const raw of interests) {
    for (const token of raw.toLowerCase().split(/[^a-z0-9]+/)) {
      if (token.length >= 2 && !out.includes(token)) out.push(token);
    }
  }
  return out;
}

export function findGiftPicks(candidates: GiftCandidate[], input: GiftEngineInput): GiftPick[] {
  const limit = input.limit ?? 12;
  const keywords = tokenizeInterests(input.interests);
  const picks: GiftPick[] = [];

  for (const c of candidates) {
    if ((GIFT_EXCLUDED_SLUGS as readonly string[]).includes(c.slug)) continue;
    if (c.bestPriceUsd === null || c.bestPriceUsd <= 0) continue;
    // Budget is a HARD filter — never soften it to fill the list.
    if (input.budgetUsd !== null && c.bestPriceUsd > input.budgetUsd) continue;

    const haystack = [c.name, c.brand ?? '', c.category ?? '', c.description ?? '']
      .join(' ')
      .toLowerCase();
    const matched = keywords.filter((k) => haystack.includes(k));
    // Interests given but nothing matched → not a pick, never forced.
    if (keywords.length > 0 && matched.length === 0) continue;

    const savingPct = discountPercent(c.bestPriceUsd, c.compareAtUsd);
    const why: string[] = [];
    if (input.budgetUsd !== null) {
      why.push(`Fits your budget at $${c.bestPriceUsd.toFixed(2)} of $${input.budgetUsd.toFixed(2)}`);
    } else {
      why.push(`Priced at $${c.bestPriceUsd.toFixed(2)}`);
    }
    if (matched.length > 0) why.push(`Matches your interests: ${matched.join(', ')}`);
    if (savingPct !== null) why.push(`Save ${savingPct}% vs $${(c.compareAtUsd as number).toFixed(2)}`);
    if (c.couponLabel) why.push(`Coupon available: ${c.couponLabel}`);

    picks.push({ ...c, matchedInterests: matched, savingPct, why });
  }

  picks.sort((a, b) => {
    if (b.matchedInterests.length !== a.matchedInterests.length) {
      return b.matchedInterests.length - a.matchedInterests.length;
    }
    const sa = a.savingPct ?? -1;
    const sb = b.savingPct ?? -1;
    if (sb !== sa) return sb - sa;
    return (a.bestPriceUsd as number) - (b.bestPriceUsd as number);
  });
  return picks.slice(0, limit);
}
