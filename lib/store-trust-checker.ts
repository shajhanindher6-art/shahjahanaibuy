/**
 * Store Trust Checker — pure helpers for /tools/store-trust-checker
 * (Section 16, E5 / item 23).
 *
 * The trust grade itself lives in lib/merchant-trust.ts
 * (computeTrustGrade, from recorded policy data only). This module
 * only answers the directory question: which of the 84 directory
 * stores did the visitor pick, and what does the lookup behind it
 * mean for the grade?
 *
 * Honesty rules:
 * - The 84 stores are the directory stores (lib/stores.ts:
 *   80 local + 4 global). Only the priced merchants in the
 *   `merchants` table (Amazon, Best Buy) can have a policy record
 *   at all — every other directory store has no merchant row, so
 *   it honestly renders "Not enough data", never a guessed grade.
 * - Even a matched merchant usually has no grade: the policy
 *   columns are NULL until the owner verifies the real policy
 *   facts (lib/merchant-trust.ts). A null grade is "Not enough
 *   data" with the missing facts listed, never a partial score.
 * - Store keys are `slug|countryCode`: several slugs repeat
 *   across countries (e.g. ebay in US and GLOBAL), so the slug
 *   alone does not identify a store.
 */

import { GLOBAL_STORES, LOCAL_STORES, type LocalStore } from '@/lib/stores';
import type { TrustGradeResult } from '@/lib/merchant-trust';

/** All 84 directory stores, sorted by name then country. */
export const ALL_DIRECTORY_STORES: LocalStore[] = [...LOCAL_STORES, ...GLOBAL_STORES].sort(
  (a, b) =>
    a.name.localeCompare(b.name) || a.countryCode.localeCompare(b.countryCode)
);

export function directoryStoreKey(store: LocalStore): string {
  return `${store.slug}|${store.countryCode}`;
}

export function findDirectoryStore(key: string | null | undefined): LocalStore | null {
  if (!key) return null;
  return ALL_DIRECTORY_STORES.find((s) => directoryStoreKey(s) === key) ?? null;
}

export type StoreTrustStatus =
  | 'no-store-selected'
  | 'unknown-store'
  | 'no-merchant-record'
  | 'insufficient-policy'
  | 'graded';

export interface StoreTrustDisplay {
  status: StoreTrustStatus;
  heading: string;
  lines: string[];
}

/**
 * Describe what the trust lookup found, in plain language. The
 * page supplies the facts (store picked, merchant row found?,
 * grade result); this function only turns them into display copy.
 */
export function describeStoreTrust(input: {
  store: LocalStore | null;
  storeKey: string | null;
  merchantFound: boolean;
  grade: TrustGradeResult | null;
}): StoreTrustDisplay {
  if (input.storeKey === null || input.storeKey.trim().length === 0) {
    return {
      status: 'no-store-selected',
      heading: 'Pick a store to check',
      lines: [
        'Choose any of the 84 stores in the directory and this page shows its trust grade — or says plainly when there is not enough recorded data to grade it.',
      ],
    };
  }
  if (input.store === null) {
    return {
      status: 'unknown-store',
      heading: 'Unknown store',
      lines: [
        'That store is not in the SmartBuy store directory, so there is nothing to check. Pick a store from the list.',
      ],
    };
  }
  if (!input.merchantFound) {
    return {
      status: 'no-merchant-record',
      heading: 'Not enough data',
      lines: [
        `${input.store.name} (${input.store.countryCode}) is a directory store only — it has no merchant record with recorded policy facts, so no trust grade can be computed.`,
        'A trust grade needs recorded return-window, warranty-length, and reputation facts. None have been recorded for this store.',
      ],
    };
  }
  if (input.grade === null || input.grade.grade === null) {
    const missing =
      input.grade?.missing.map((m) =>
        m === 'returnWindowDays'
          ? 'return window'
          : m === 'warrantyMonths'
            ? 'warranty length'
            : 'reputation score'
      ) ?? ['return window', 'warranty length', 'reputation score'];
    return {
      status: 'insufficient-policy',
      heading: 'Not enough data',
      lines: [
        `${input.store.name} is a priced merchant, but no trust grade can be computed yet — still needed: ${missing.join(', ')}.`,
        'No policy values have been recorded for this store yet, so no trust grade is shown. Policy facts are recorded only after the owner verifies them against the store’s own published policy.',
      ],
    };
  }
  return {
    status: 'graded',
    heading: `Trust grade ${input.grade.grade}`,
    lines: [
      `Score ${input.grade.score}/100 from recorded policy data only.`,
      ...input.grade.reasons,
    ],
  };
}

/** Parse the page's GET params: ?store=<slug|countryCode>. */
export function parseStoreTrustParams(searchParams: {
  store?: string | string[];
}): { storeKey: string | null; hasQuery: boolean } {
  const raw = Array.isArray(searchParams.store) ? searchParams.store[0] : searchParams.store;
  return {
    storeKey: raw !== undefined && raw.trim().length > 0 ? raw.trim() : null,
    hasQuery: raw !== undefined,
  };
}
