/**
 * Regional curators — human deal curation per market (Section 5, item 13).
 *
 * WHAT THIS IS: curated slots (a "deal of the day" or curated pick an
 * admin placed for a real product in a real region on a real date)
 * plus the public curation guidelines every slot must pass.
 *
 * WHAT THIS IS NOT: curators themselves are people. This module
 * stores NO curator names, bios, photos, or credentials, and invents
 * none — a slot records only region + date + product + an optional
 * editorial note. Until an admin creates a slot, a region's deal of
 * the day is honestly empty ("No curated deal today").
 *
 * GUIDELINES (public, enforced by the admin workflow, not by code
 * that can verify a deal on its own): a curated deal must pass the
 * same fact-checking as any other deal — real recorded price, no
 * fake-discount pattern, retailer link verified — and upvotes never
 * verify a deal. The guidelines list is editorial policy, not data.
 *
 * Reads are fail-safe: when migration 029 has not been run, or no
 * slot exists, callers get null / [] — never an error, never a
 * placeholder deal.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import { getRegionByCountry } from '@/lib/region';

export type CuratedSlotType = 'deal_of_the_day' | 'curated_pick';

export interface CuratedSlot {
  id: string;
  regionCode: string;
  slotDate: string;
  slotType: CuratedSlotType;
  productId: string;
  productSlug: string | null;
  productName: string | null;
  note: string | null;
}

/** Markets curation starts with (Section 5, item 13). Others follow when an admin curates them. */
export const CURATION_PRIORITY_REGIONS = ['PK', 'IN', 'US'] as const;

/** Public curation guidelines — every curated slot must pass these. */
export const CURATION_GUIDELINES: { title: string; rule: string }[] = [
  {
    title: 'Never a fake deal',
    rule: 'A curated deal must come from a real recorded price. No invented discount, no inflated compare-at price, no deal without a price to check it against.',
  },
  {
    title: 'Price-match check first',
    rule: 'Before a slot goes live, the deal price is checked against the recorded merchant price. A mismatch means no slot — not a "close enough" slot.',
  },
  {
    title: 'Fake-sale pattern fails the slot',
    rule: 'If the price history shows a fake-sale pattern (a rise followed by a drop that is not below the pre-rise price), the product is not curated that day.',
  },
  {
    title: 'Retailer link must work',
    rule: 'The slot links to a real retailer search page for the product. A dead or guessed link blocks the slot.',
  },
  {
    title: 'Upvotes never verify',
    rule: 'Community upvotes are a signal, not verification. A slot is verified by an admin check or a merchant-price match — never by votes.',
  },
  {
    title: 'Say what is unknown',
    rule: 'If stock, warranty, or local availability is not recorded, the slot says so. A curated pick never claims certainty it does not have.',
  },
];

/** UTC date (YYYY-MM-DD) a slot belongs to. Defaults to today. */
export function slotDateFor(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/** True when the code is a known region in the region registry. */
export function isKnownCurationRegion(code: string | null | undefined): boolean {
  if (!code) return false;
  return getRegionByCountry(code) !== null;
}

interface CuratedSlotRow {
  id: string;
  region_code: string;
  slot_date: string;
  slot_type: string;
  product_id: string;
  note: string | null;
  products: { slug: string | null; name: string | null } | { slug: string | null; name: string | null }[] | null;
}

function mapSlot(row: CuratedSlotRow): CuratedSlot | null {
  if (row.slot_type !== 'deal_of_the_day' && row.slot_type !== 'curated_pick') return null;
  const product = Array.isArray(row.products) ? row.products[0] : row.products;
  return {
    id: row.id,
    regionCode: row.region_code,
    slotDate: row.slot_date,
    slotType: row.slot_type,
    productId: row.product_id,
    productSlug: product?.slug ?? null,
    productName: product?.name ?? null,
    note: row.note,
  };
}

const SLOT_SELECT = 'id, region_code, slot_date, slot_type, product_id, note, products(slug, name)';

/**
 * The curated deal of the day for a region. Null when no slot was
 * created for that date, when the region is unknown, or when the
 * table does not exist yet (migration 029 not run). Never throws.
 */
export async function getDealOfTheDay(
  supabase: AnySupabaseClient,
  regionCode: string,
  date: Date = new Date()
): Promise<CuratedSlot | null> {
  try {
    const { data, error } = await supabase
      .from('curated_slots')
      .select(SLOT_SELECT)
      .eq('region_code', regionCode.toUpperCase())
      .eq('slot_date', slotDateFor(date))
      .eq('slot_type', 'deal_of_the_day')
      .maybeSingle();
    if (error || !data) {
      if (error) {
        logger.warn('getDealOfTheDay: query failed (029 may not be run)', {
          error: error.message,
        });
      }
      return null;
    }
    return mapSlot(data as CuratedSlotRow);
  } catch (err) {
    logger.warn('getDealOfTheDay: unexpected error', { error: String(err) });
    return null;
  }
}

/**
 * Recent curated slots for a region, newest first. [] when none
 * exist or the table is missing. Never throws.
 */
export async function getCuratedSlots(
  supabase: AnySupabaseClient,
  regionCode: string,
  limit = 6
): Promise<CuratedSlot[]> {
  try {
    const { data, error } = await supabase
      .from('curated_slots')
      .select(SLOT_SELECT)
      .eq('region_code', regionCode.toUpperCase())
      .order('slot_date', { ascending: false })
      .limit(Math.min(20, Math.max(1, limit)));
    if (error || !data) {
      if (error) {
        logger.warn('getCuratedSlots: query failed (029 may not be run)', {
          error: error.message,
        });
      }
      return [];
    }
    const out: CuratedSlot[] = [];
    for (const row of data as CuratedSlotRow[]) {
      const mapped = mapSlot(row);
      if (mapped) out.push(mapped);
    }
    return out;
  } catch (err) {
    logger.warn('getCuratedSlots: unexpected error', { error: String(err) });
    return [];
  }
}
