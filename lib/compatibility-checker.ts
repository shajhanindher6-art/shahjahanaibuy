/**
 * AI Accessory Compatibility Checker — pure helpers for
 * /tools/compatibility-checker.
 *
 * The user picks a device + an accessory from the catalog and gets
 * a verdict. The verdict comes ONLY from services/compatibility.ts
 * (gradeCompatibility) — this file adds the param parsing and the
 * same-product guard, no new grading of its own.
 *
 * HONESTY RULES (audit §2 T10 — do not weaken):
 * - "Exact" is NEVER assigned: no compatibility data source exists
 *   (no connector/interface fields, no compatibility table). The
 *   engine can only return 'Likely' | 'Possible' | 'Unknown'.
 * - Same brand + same category → "Likely — same brand and category,
 *   verify connector/specs before buying".
 * - Same category only → "Possible — same category, verify".
 * - Otherwise → "Unknown — no compatibility data recorded".
 * - Every verdict carries COMPATIBILITY_VERIFY_NOTE.
 * - The connector note comes only from a real spec field; the
 *   catalog records none, so it is always the honest fallback
 *   ("Connector info not recorded…") — never an invented
 *   connector, voltage or wattage.
 * - Picking the same product twice is not a compatibility check:
 *   it is rejected (same-product), never graded "Likely".
 */

import {
  connectorNote,
  gradeCompatibility,
  type CompatibilityGrade,
  type GradedCandidate,
} from '@/services/compatibility';

/** Carried on every verdict (audit §2 T10). */
export const COMPATIBILITY_VERIFY_NOTE =
  'Verify before buying — check the connector and specs on the manufacturer’s site.';

/** Minimal product shape the checker needs (from getProducts + prices). */
export interface CompatibilityProductInput {
  id: string;
  slug: string;
  name: string;
  brand: string | null;
  /** Category TEXT field from the products row (may be null). */
  category: string | null;
  /** Lowest recorded in-stock price, or null when unpriced. */
  priceUsd: number | null;
}

export interface CompatibilityCheck {
  device: CompatibilityProductInput;
  accessory: CompatibilityProductInput;
  grade: CompatibilityGrade;
  gradeNote: string;
  /** Always the honest fallback today (no spec field recorded). */
  connectorNote: string;
}

export type CompatibilityCheckResult =
  | { ok: true; check: CompatibilityCheck }
  | { ok: false; reason: 'same-product' };

export interface CompatibilityParams {
  deviceSlug: string | null;
  accessorySlug: string | null;
  /** True when the visitor submitted the form at all. */
  hasQuery: boolean;
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Parse ?device=<slug>&accessory=<slug> from the page's GET form. */
export function parseCompatibilityParams(searchParams: {
  device?: string | string[];
  accessory?: string | string[];
}): CompatibilityParams {
  const rawDevice = firstParam(searchParams.device);
  const rawAccessory = firstParam(searchParams.accessory);
  return {
    deviceSlug: rawDevice === '' || rawDevice === undefined ? null : rawDevice,
    accessorySlug: rawAccessory === '' || rawAccessory === undefined ? null : rawAccessory,
    hasQuery: rawDevice !== undefined || rawAccessory !== undefined,
  };
}

/**
 * Grade one device + accessory pair. Pure and deterministic.
 * Returns { ok: false, reason: 'same-product' } when both picks
 * are the same product — a product is not "compatible with itself".
 * The graded candidate is the accessory (the product being checked
 * against the device), with its real recorded price.
 */
export function checkCompatibility(
  device: CompatibilityProductInput,
  accessory: CompatibilityProductInput
): CompatibilityCheckResult {
  if (device.slug === accessory.slug) {
    return { ok: false, reason: 'same-product' };
  }
  const graded: GradedCandidate = gradeCompatibility(
    { brand: device.brand, category: device.category },
    {
      slug: accessory.slug,
      name: accessory.name,
      brand: accessory.brand,
      category: accessory.category,
      priceUsd: accessory.priceUsd,
    }
  );
  return {
    ok: true,
    check: {
      device,
      accessory,
      grade: graded.grade,
      gradeNote: graded.gradeNote,
      // No spec field is recorded for any product, so the note is
      // the engine's honest fallback — never a guessed connector.
      connectorNote: connectorNote(null),
    },
  };
}
