/**
 * Refurbished Buying Checklist — safety checklist for buying
 * certified refurbished (T9).
 *
 * HONESTY RULES (do not weaken them):
 * - No refurbished listings exist in the SmartBuy catalog. This
 *   tool NEVER shows a refurbished offer, price, or condition
 *   grade for any specific listing. It links out to retailer
 *   search pages (like /find) where refurbished offers appear
 *   when the retailer has them.
 * - Condition grades (A/B/C) are a GENERAL decoder only. Grades
 *   are not standardized — every seller defines its own grades —
 *   so the decoder says what a grade USUALLY means and always
 *   tells the shopper to check the seller's own definition.
 * - The benchmark is the RECORDED new price only (lowest
 *   in-stock merchant listing), labeled with its price state
 *   (STALE where applicable). It is a ceiling to compare
 *   against, never a refurbished price.
 * - This tool does NOT duplicate /tools/trade-in-finder: no
 *   trade-in directory, no resale projection. Its job is buying
 *   refurbished safely.
 */

import type { PriceStateResult } from '@/lib/verification/price-state';
import { PRICE_STATE_LABELS } from '@/lib/verification/price-state';

/** One condition grade in the general (non-standard) A/B/C decoder. */
export interface ConditionGrade {
  /** Grade letter. */
  grade: 'A' | 'B' | 'C';
  /** Short label, e.g. "Like new". */
  label: string;
  /** What the grade usually means. */
  meaning: string;
  /** What to check before trusting the grade. */
  watchOutFor: string;
}

/**
 * General condition-grade decoder. Grades are NOT standardized:
 * one seller's "A" is another seller's "B". Treat this as a
 * starting point and always read the seller's own grade
 * definition on the listing.
 */
export const CONDITION_GRADES: ConditionGrade[] = [
  {
    grade: 'A',
    label: 'Like new / Excellent',
    meaning:
      'Usually means minimal to no visible wear — the device looks close to new and works fully. May still be a used device, not a new one.',
    watchOutFor:
      'Ask for photos of the actual unit (not stock photos) and confirm the battery health and warranty — "like new" does not guarantee a new battery.',
  },
  {
    grade: 'B',
    label: 'Good / Light wear',
    meaning:
      'Usually means light visible wear — small scratches or scuffs, typically on the body rather than the screen — with everything working.',
    watchOutFor:
      'Check whether the screen is included in the wear, and whether the listing shows the actual scratches. Confirm the return window before buying.',
  },
  {
    grade: 'C',
    label: 'Fair / Noticeable wear',
    meaning:
      'Usually means noticeable cosmetic wear — visible scratches, dents or scuffs — while the device still works. The cheapest grade, and the one where the saving has to be worth the wear.',
    watchOutFor:
      'Inspect the screen and ports closely on arrival, test every function inside the return window, and compare the price against the recorded new price — a small saving is rarely worth heavy wear.',
  },
];

/** One item of the 10-point inspection checklist. */
export interface InspectionChecklistItem {
  /** Stable id, e.g. "battery-health". */
  id: string;
  /** Short title. */
  title: string;
  /** What to check and why, in plain language. */
  detail: string;
}

/**
 * The 10-point inspection list. Every item is a check the buyer
 * does themselves — none of them needs data SmartBuy does not
 * have, and none of them claims anything about a specific
 * listing.
 */
export const INSPECTION_CHECKLIST: InspectionChecklistItem[] = [
  {
    id: 'battery-health',
    title: 'Battery health',
    detail:
      'For phones, laptops and tablets, ask for the battery health percentage or cycle count. Below about 80% health, a battery replacement is near — factor that cost in before you buy.',
  },
  {
    id: 'warranty',
    title: 'Warranty — who warrants it, and for how long',
    detail:
      'Find out who stands behind the device: the manufacturer, the retailer, or the seller — and for how many months. Get it in writing on the listing or receipt; "warranty included" without a length or a warrantor is not a warranty.',
  },
  {
    id: 'return-window',
    title: 'Return window',
    detail:
      'Check the return window for that store and that listing before you pay — refurbished items often have a shorter window than new ones. Know the last day you can send it back, and test everything before that day.',
  },
  {
    id: 'seller-rating',
    title: 'Seller rating and history',
    detail:
      'Check the seller\u2019s feedback score, how long they have been selling, and whether they sell refurbished items regularly. A new seller with no refurbished history is a bigger risk than an established refurbisher.',
  },
  {
    id: 'activation-lock',
    title: 'Activation lock removed',
    detail:
      'Make sure no activation lock or account lock remains — iCloud lock on Apple devices, Google lock on Android. A locked device cannot be set up as yours. Ask the seller to confirm the lock is removed and the device is factory-reset before it ships.',
  },
  {
    id: 'in-the-box',
    title: 'What is in the box',
    detail:
      'Check whether the original charger and cables are included. A generic charger may charge slower or lack fast charging, and buying the original separately eats into the saving.',
  },
  {
    id: 'cosmetic-vs-grade',
    title: 'Cosmetic condition matches the grade',
    detail:
      'Compare the actual photos against the grade the seller claims (see the decoder above). Stock photos hide wear — ask for photos of the actual unit, including the screen and corners, if the listing does not show them.',
  },
  {
    id: 'function-test',
    title: 'Function test on arrival',
    detail:
      'On arrival, test every button, port, camera, speaker, microphone, Wi-Fi and Bluetooth connection — not just power-on. Do it inside the return window, while you can still send the device back.',
  },
  {
    id: 'model-match',
    title: 'Exact model and storage match',
    detail:
      'Confirm the exact model number and storage size in the device\u2019s own settings — not just on the box or the listing title. A listing can name the right model and ship a different storage size.',
  },
  {
    id: 'price-vs-new',
    title: 'Price vs the same product new',
    detail:
      'Compare the refurbished price against the recorded new price shown below. A small saving over new is rarely worth the wear, the shorter warranty and the shorter return window — the bigger the discount, the more the risk is priced in.',
  },
];

/** Input for the recorded-new-price benchmark. */
export interface RefurbishedBenchmarkInput {
  /** Product display name. */
  name: string;
  /** Product slug (for the link to the product page). */
  slug: string;
  /**
   * Lowest recorded in-stock merchant price (new), or null when
   * no in-stock listing is recorded.
   */
  recordedPrice: number | null;
  /** Derived price state for the recorded price, or null. */
  priceState: PriceStateResult | null;
  /** Last check date of the recorded price (data_freshness), or null. */
  lastCheckedAt: string | null;
}

/** The benchmark card: recorded new price, with its honesty labels. */
export interface RefurbishedBenchmark {
  name: string;
  slug: string;
  /** Lowest recorded new price, or null when none is recorded. */
  recordedPrice: number | null;
  /** True when a recorded new price exists to compare against. */
  hasRecordedPrice: boolean;
  /** Display label for the price state ("Stale", "Unverified", …). */
  priceStateLabel: string | null;
  /** Plain-language reason behind the price state, or null. */
  priceStateReason: string | null;
  /** Last-checked date, formatted for display, or null. */
  lastCheckedLabel: string | null;
}

/**
 * Build the benchmark from recorded data only. A refurbished
 * price is NEVER part of this object: SmartBuy records no
 * refurbished prices, so there is nothing to compare against
 * except the recorded new price.
 */
export function buildRefurbishedBenchmark(
  input: RefurbishedBenchmarkInput
): RefurbishedBenchmark {
  const hasRecordedPrice =
    input.recordedPrice !== null && Number.isFinite(input.recordedPrice);
  return {
    name: input.name,
    slug: input.slug,
    recordedPrice: hasRecordedPrice ? input.recordedPrice : null,
    hasRecordedPrice,
    priceStateLabel: input.priceState
      ? PRICE_STATE_LABELS[input.priceState.state]
      : null,
    priceStateReason: input.priceState ? input.priceState.reason : null,
    lastCheckedLabel: input.lastCheckedAt
      ? new Date(input.lastCheckedAt).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })
      : null,
  };
}

/**
 * Retailer search query for refurbished offers of a product.
 * Used with the stores' own search-URL templates (lib/stores.ts)
 * — the link goes to the retailer's own search results, where
 * refurbished offers appear only when the retailer has them.
 */
export function refurbishedSearchQuery(productName: string): string {
  return `refurbished ${productName.trim()}`;
}

/**
 * Note rendered with the outbound retailer links, so the shopper
 * knows SmartBuy shows no refurbished offer itself.
 */
export const REFURBISHED_OUTBOUND_NOTE =
  'SmartBuy records no refurbished listings, so this tool shows no refurbished offer or price. These links go to each retailer\u2019s own search results for refurbished units — offers appear there only when the retailer has them.';
