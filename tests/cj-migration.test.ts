/**
 * CJ Affiliate migration audit (20261121_cj_affiliate_offers.sql).
 *
 * SQL-shape tests: these read the migration FILE and pin its
 * structure. No DB, no network, no migration is ever applied by
 * this suite. The file is intentionally NOT applied yet
 * (DO NOT APPLY YET — owner step, after the 035–058 backlog).
 *
 * What is pinned here:
 * - the merchant_offers table shape + CHECK constraints
 * - the duplicate-prevention UNIQUE key
 * - the lookup + full-text indexes
 * - the updated_at trigger (the upsert helper never sets
 *   updated_at itself, so the trigger is what keeps it truthful)
 * - RLS enabled with exactly one public SELECT policy
 *   (is_public_live = true) and no write policy
 * - the deliberate NO-FK design (offers match by GTIN/MPN;
 *   an FK to products would block feed rows for products not
 *   yet in the catalog)
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CJ_MIGRATION = 'supabase/migrations/20261121_cj_affiliate_offers.sql';

function migration(): string {
  return fs.readFileSync(path.join(REPO_ROOT, CJ_MIGRATION), 'utf8');
}

describe('CJ migration — merchant_offers table', () => {
  it('is a new unapplied migration (DO NOT APPLY YET)', () => {
    const sql = migration();
    expect(sql).toContain('DO NOT APPLY YET');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.merchant_offers');
  });

  it('has the duplicate-prevention UNIQUE key and money/status CHECKs', () => {
    const sql = migration();
    expect(sql).toContain('UNIQUE (network, advertiser_id, external_product_id)');
    expect(sql).toContain("CHECK (network IN ('cj', 'amazon'))");
    expect(sql).toContain('CHECK (price > 0)');
    expect(sql).toContain('CHECK (sale_price IS NULL OR sale_price > 0)');
    expect(sql).toContain('CHECK (char_length(currency) = 3)');
    expect(sql).toContain(
      "CHECK (availability IN ('in_stock', 'out_of_stock', 'preorder', 'backorder'))",
    );
  });

  it('has the lookup indexes for the comparison query', () => {
    const sql = migration();
    expect(sql).toContain('merchant_offers_gtin_idx');
    expect(sql).toContain('merchant_offers_mpn_idx');
    expect(sql).toContain('merchant_offers_live_availability_price_idx');
    expect(sql).toContain('merchant_offers_title_fts_idx');
    expect(sql).toContain("USING gin (to_tsvector('english'");
  });

  it('bumps updated_at on UPDATE via the shared trigger function', () => {
    const sql = migration();
    expect(sql).toContain('update_merchant_offers_updated_at');
    expect(sql).toContain('BEFORE UPDATE ON public.merchant_offers');
    expect(sql).toContain('EXECUTE FUNCTION public.update_updated_at_column()');
  });

  it('enables RLS with exactly one public SELECT policy (live rows only)', () => {
    const sql = migration();
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('merchant_offers_select_public_live');
    expect(sql).toContain('FOR SELECT');
    expect(sql).toContain('USING (is_public_live = true)');
    // No write policy exists: writes are service-role only.
    expect(sql).not.toContain('FOR INSERT');
    expect(sql).not.toContain('FOR UPDATE');
    expect(sql).not.toContain('FOR DELETE');
  });

  it('has no foreign key to products (deliberate — GTIN/MPN matching)', () => {
    const sql = migration();
    expect(sql).not.toContain('REFERENCES');
  });

  it('documents the rollback path', () => {
    const sql = migration();
    expect(sql).toContain('ROLLBACK: DROP TABLE IF EXISTS public.merchant_offers;');
  });
});
