/**
 * Buying considerations — Section 19, §12 #18.
 *
 * One consolidated "Before you buy" section for the product detail
 * page, built ONLY from signals the page already holds — no new
 * fetch, no invented advice:
 *
 *   - Price freshness: the latest recorded price-check date
 *     (lib/price-freshness). Fresh (≤ STALE_PRICE_DAYS) is a
 *     positive; older, or no recorded date at all, is a caution
 *     that says so plainly.
 *   - Discount validation: the cheapest listing's compare-at price
 *     (lib/deal-math discountPercent). A discount is listed only
 *     when a real compare-at price is recorded and above the
 *     price; a missing compare-at says no discount can be
 *     verified, never a 0%.
 *   - Price position: the spread across the priced merchants —
 *     how many list the product and how far the cheapest sits
 *     below the most expensive. One merchant means no second
 *     price to compare against, said as such.
 *   - Trust signals: the recorded review count / average rating /
 *     verified-purchase count, only when at least one review
 *     exists. Zero reviews is not a signal — it contributes
 *     nothing, so a product with no merchants, no check date and
 *     no reviews yields NO considerations and the component
 *     renders the honest "not enough data" line instead.
 *
 * Pure: plain data in, consideration list out. `now` exists only
 * so tests can pin the freshness math; callers omit it.
 */

import { discountPercent } from '@/lib/deal-math';
import { formatLastChecked, STALE_PRICE_DAYS } from '@/lib/price-freshness';

export type BuyingConsiderationTone = 'ok' | 'caution' | 'info';

export interface BuyingConsideration {
  tone: BuyingConsiderationTone;
  text: string;
}

/** One priced merchant listing, as the product page already holds it. */
export interface BuyingConsiderationMerchant {
  merchantName: string | null;
  price: number;
  compareAtPrice: number | null;
}

export interface BuyingConsiderationInput {
  /** Latest recorded price-check date (ISO), or null when none is recorded. */
  lastCheckedAt: string | null;
  merchants: BuyingConsiderationMerchant[];
  totalReviews: number;
  averageRating: number | null;
  verifiedReviews: number;
}

function formatUsd(value: number): string {
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

function wholeDaysAgo(iso: string, nowMs: number): number | null {
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return null;
  const diff = nowMs - ms;
  if (diff < 0) return 0;
  return Math.floor(diff / 86_400_000);
}

/**
 * The buying considerations earned by the recorded signals, in a
 * fixed order (freshness, discount, price position, trust).
 * Returns [] when no signal exists at all — the component then
 * renders the honest "not enough data" line, never an invented
 * consideration.
 */
export function buildBuyingConsiderations(
  input: BuyingConsiderationInput,
  now: Date = new Date()
): BuyingConsideration[] {
  const items: BuyingConsideration[] = [];
  const nowMs = now.getTime();
  const priced = (input.merchants ?? []).filter(
    (m) => Number.isFinite(m.price) && m.price > 0
  );
  const hasCheckDate = formatLastChecked(input.lastCheckedAt) !== null;
  const hasReviewSignal =
    input.totalReviews > 0 &&
    input.averageRating !== null &&
    Number.isFinite(input.averageRating);

  // No signal at all (no priced merchant, no recorded check date,
  // no reviews) → no considerations: the component renders the
  // honest "not enough data" line instead of inventing one.
  if (priced.length === 0 && !hasCheckDate && !hasReviewSignal) {
    return [];
  }

  // --- Price freshness -------------------------------------------------
  const checkedLabel = formatLastChecked(input.lastCheckedAt);
  if (checkedLabel === null) {
    items.push({
      tone: 'caution',
      text: 'No price-check date is recorded for this product, so the prices shown may be out of date — check the retailer\u2019s page before buying.',
    });
  } else {
    const days = wholeDaysAgo(input.lastCheckedAt as string, nowMs);
    if (days !== null && days > STALE_PRICE_DAYS) {
      items.push({
        tone: 'caution',
        text: `Prices were last checked on ${checkedLabel} (${days} days ago) — the price may have moved since, so check the retailer\u2019s page before buying.`,
      });
    } else {
      items.push({
        tone: 'ok',
        text: `Prices were last checked on ${checkedLabel} — within the last ${STALE_PRICE_DAYS} days.`,
      });
    }
  }

  // --- Discount validation + price position -----------------------------
  if (priced.length > 0) {
    const cheapest = priced.reduce((a, b) => (b.price < a.price ? b : a));
    const mostExpensive = priced.reduce((a, b) => (b.price > a.price ? b : a));
    const pct = discountPercent(cheapest.price, cheapest.compareAtPrice);
    if (pct !== null && cheapest.compareAtPrice !== null) {
      items.push({
        tone: 'ok',
        text: `The lowest price is ${formatUsd(cheapest.price)}${cheapest.merchantName ? ` at ${cheapest.merchantName}` : ''} — ${pct}% below its recorded compare-at price of ${formatUsd(cheapest.compareAtPrice)}.`,
      });
    } else {
      items.push({
        tone: 'info',
        text: 'No compare-at price is recorded for the cheapest listing, so no discount percentage can be verified for it.',
      });
    }

    if (priced.length === 1) {
      items.push({
        tone: 'info',
        text: 'Only one retailer lists this product, so there is no second price to compare against.',
      });
    } else if (mostExpensive.price > cheapest.price) {
      items.push({
        tone: 'info',
        text: `${priced.length} retailers list this product, from ${formatUsd(cheapest.price)} to ${formatUsd(mostExpensive.price)} — the cheapest is ${formatUsd(mostExpensive.price - cheapest.price)} lower than the most expensive.`,
      });
    } else {
      items.push({
        tone: 'info',
        text: `${priced.length} retailers list this product at the same price (${formatUsd(cheapest.price)}) — no saving from switching retailer.`,
      });
    }
  }

  // --- Trust signals (only when at least one review is recorded) -------
  if (hasReviewSignal) {
    // hasReviewSignal narrows averageRating to a finite number.
    const ratingValue = input.averageRating as number;
    const rating = ratingValue.toFixed(1);
    const verified =
      input.verifiedReviews > 0
        ? `, including ${input.verifiedReviews} verified purchase${input.verifiedReviews === 1 ? '' : 's'}`
        : '';
    items.push({
      tone: ratingValue >= 4 ? 'ok' : 'info',
      text: `Rated ${rating} out of 5 from ${input.totalReviews} review${input.totalReviews === 1 ? '' : 's'}${verified}.`,
    });
  }

  return items;
}
