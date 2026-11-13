import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Sections 21–25, Stage I (Worker W10) — migration files only.
// SQL-shape tests: these read the migration FILES and pin their
// shape. No DB, no network, no migration is ever applied by this
// suite. Every new migration (059–062) is covered here, plus the
// in-place fixes to 057 / 018 / 031, the 045 pre-flight comment,
// and the unnumbered-file conflict note.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = 'supabase/migrations';

function migration(name: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, MIGRATIONS, name), 'utf8');
}

const M057 = '20261113093000_057_price_history_source_flags.sql';
const M018 = '20261106153700_018_smartpool_v2_shipping_city.sql';
const M031 = '20261110111000_031_creator_rewards.sql';
const M045 = '20261112180000_045_catalog_verification_and_published_status.sql';
const M051 = '20261112213000_051_user_table_auth_user_fks.sql';
const M059 = '20261113110000_059_products_data_quality.sql';
const M060 = '20261113111000_060_price_history_currency_code.sql';
const M061 = '20261113112000_061_merchant_reliability.sql';
const M062 = '20261113113000_062_log_table_user_fks.sql';

// ---------------------------------------------------------------------------
// I-P1-6 — migration 057 fixed in place (DO-block guard + seed-instant
// scoped backfill)
// ---------------------------------------------------------------------------

describe('057 fixed in place (I-P1-6)', () => {
  it('wraps ADD CONSTRAINT in a pg_constraint-guarded DO block (re-runnable)', () => {
    const sql = migration(M057);
    expect(sql).toContain('DO NOT APPLY');
    expect(sql).toContain("conname = 'price_history_source_check'");
    expect(sql).toContain('pg_constraint');
    expect(sql).toContain('ADD CONSTRAINT price_history_source_check');
    // The unguarded bare statement is gone: the only ADD CONSTRAINT
    // occurrence sits inside the DO block (no top-level statement
    // starting the file's constraint section outside a DO block).
    const bareConstraint = /^ALTER TABLE price_history\n  ADD CONSTRAINT price_history_source_check/m;
    expect(sql).not.toMatch(bareConstraint);
  });

  it('scopes the seed backfill to the seed instant only', () => {
    const sql = migration(M057);
    expect(sql).toContain("SET source = 'seed'");
    expect(sql).toContain("recorded_at < DATE '2026-11-03'");
    // Post-seed rows keep NULL: the UPDATE still requires source IS NULL.
    expect(sql).toContain('WHERE source IS NULL');
    // Apply-time report of labelled vs unlabelled rows.
    expect(sql).toContain('labelled seed');
  });
});

// ---------------------------------------------------------------------------
// I-P1-3 — migrations 018 / 031 guard-wrapped (applied status UNKNOWN)
// ---------------------------------------------------------------------------

describe('018 / 031 guard-wrapped (I-P1-3)', () => {
  it('018 no-ops with a NOTICE when public.pools was never created', () => {
    const sql = migration(M018);
    expect(sql).toContain("to_regclass('public.pools')");
    expect(sql).toContain('add-smartpools.sql');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS shipping_estimate_usd');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS city text');
    // The old trailing verification SELECT is gone — it would fail
    // on a database without the pools table.
    expect(sql).not.toContain('SELECT column_name, data_type');
    expect(sql).toContain('018: skipped');
  });

  it('031 creates creator_rewards unconditionally, guards creator_reward_events on community_deals', () => {
    const sql = migration(M031);
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS creator_rewards');
    expect(sql).toContain("to_regclass('public.community_deals')");
    expect(sql).toContain('add-community-deals.sql');
    expect(sql).toContain('creator_reward_events');
    expect(sql).toContain('REFERENCES community_deals(id)');
    expect(sql).toContain('031: skipped creator_reward_events');
    // The events ledger is created inside the guard, not at top level.
    expect(sql).not.toMatch(/^CREATE TABLE IF NOT EXISTS creator_reward_events \(/m);
  });
});

// ---------------------------------------------------------------------------
// I-P2-6 — 045 duplicate-guard: pre-flight comment + in-file guard
// ---------------------------------------------------------------------------

describe('045 duplicate-guard (I-P2-6)', () => {
  it('carries the pre-flight duplicate check as a comment and keeps the in-file guard', () => {
    const sql = migration(M045);
    // Pre-flight query the owner runs before applying.
    expect(sql).toContain('HAVING count(*) > 1');
    expect(sql).toContain('price_history_product_retailer_recorded_uidx');
    // The in-file guard itself: duplicate check -> NOTICE -> skip.
    expect(sql).toContain('UNIQUE index NOT created');
    expect(sql).toContain('RAISE NOTICE');
  });
});

// ---------------------------------------------------------------------------
// New migrations 059–062 (DO NOT APPLY, numeric apply order)
// ---------------------------------------------------------------------------

describe('059 products data-quality persistence', () => {
  it('adds nullable score / dimensions / computed_at, no backfill, no grade column', () => {
    const sql = migration(M059);
    expect(sql).toContain('DO NOT APPLY');
    expect(sql).toContain('035–058 backlog clears in numeric');
    expect(sql).toContain('then 059–062');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS data_quality_score integer');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS data_quality_dimensions jsonb');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS data_quality_computed_at timestamptz');
    expect(sql).toContain('data_quality_score >= 0 AND data_quality_score <= 100');
    expect(sql).toContain('idx_products_data_quality_score');
    // No backfill: no UPDATE, no invented score.
    expect(sql).not.toMatch(/^\s*UPDATE /m);
    expect(sql).toContain('NO BACKFILL');
    // Grade is derived at read time, never stored.
    expect(sql).not.toContain('data_quality_grade');
    // No dependence on the banned 035 / dead 053 ledger.
    expect(sql).not.toContain('api_key_usage');
  });
});

describe('060 price_history.currency_code', () => {
  it('pre-flights on non-USD rows and backfills from the recorded currency verbatim', () => {
    const sql = migration(M060);
    expect(sql).toContain('DO NOT APPLY');
    expect(sql).toContain('035–058 backlog clears in numeric');
    expect(sql).toContain('then 059–062');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS currency_code text');
    expect(sql).toContain('char_length(currency_code) = 3');
    // Pre-flight: aborts safely when a non-USD row exists.
    expect(sql).toContain("currency IS DISTINCT FROM 'USD'");
    expect(sql).toContain('RAISE EXCEPTION');
    // Backfill copies the recorded value; never a blind USD stamp.
    expect(sql).toContain("SET currency_code = COALESCE(currency, 'USD')");
    expect(sql).not.toContain("SET currency_code = 'USD'");
    // Default attaches only after the backfill, for future rows.
    expect(sql).toContain('ALTER COLUMN currency_code SET DEFAULT');
    expect(sql).not.toContain('api_key_usage');
  });
});

describe('061 merchant_reliability table', () => {
  it('creates one durable row per merchant, scored/insufficient-data, service-role writes only', () => {
    const sql = migration(M061);
    expect(sql).toContain('DO NOT APPLY');
    expect(sql).toContain('035–058 backlog clears in numeric');
    expect(sql).toContain('then 059–062');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.merchant_reliability');
    expect(sql).toContain('REFERENCES public.merchants(id) ON DELETE CASCADE');
    expect(sql).toContain('UNIQUE (merchant_id)');
    expect(sql).toContain("status IN ('scored', 'insufficient-data')");
    expect(sql).toContain('merchant_reliability_select_admin');
    // No anon/authenticated INSERT/UPDATE/DELETE: service-role only.
    expect(sql).not.toContain('FOR INSERT');
    expect(sql).not.toContain('FOR UPDATE');
    expect(sql).not.toContain('FOR DELETE');
    // No backfill: no score is computed or written here.
    expect(sql).toContain('NO BACKFILL');
    expect(sql).not.toContain('api_key_usage');
  });
});

describe('062 log-table user_id FKs', () => {
  it('adds DO-guarded FKs: error_log SET NULL, digest_failures CASCADE (NOT NULL)', () => {
    const sql = migration(M062);
    expect(sql).toContain('DO NOT APPLY');
    expect(sql).toContain('035–058 backlog clears in numeric');
    expect(sql).toContain('then 059–062');
    expect(sql).toContain('error_log_user_id_fkey');
    expect(sql).toContain('REFERENCES auth.users(id) ON DELETE SET NULL');
    expect(sql).toContain('digest_failures_user_id_fkey');
    expect(sql).toContain('REFERENCES auth.users(id) ON DELETE CASCADE');
    // Guards: table-exists NOTICE skips when 048/050 are unapplied.
    expect(sql).toContain("to_regclass('public.error_log')");
    expect(sql).toContain("to_regclass('public.digest_failures')");
    // Orphan check documented (FK add fails on orphans; guards
    // protect re-runs only).
    expect(sql).toContain('orphan check');
    expect(sql).not.toContain('api_key_usage');
  });

  it('was NOT folded into 051 — 051 still covers exactly its 12 tables', () => {
    const sql051 = migration(M051);
    expect(sql051).not.toContain('error_log');
    expect(sql051).not.toContain('digest_failures');
    const sql062 = migration(M062);
    expect(sql062).toContain('WHY NOT FOLDED INTO 051');
  });
});

// ---------------------------------------------------------------------------
// Unnumbered-file conflict note (audit §1 P1 #41)
// ---------------------------------------------------------------------------

describe('unnumbered-migration conflict note', () => {
  it('states the decision (fix-public wins) and the order (unnumbered first, fix-public last)', () => {
    const note = fs.readFileSync(
      path.join(REPO_ROOT, MIGRATIONS, 'NOTES_unnumbered_conflict.md'),
      'utf8'
    );
    expect(note).toContain('fix-public-catalog-rls.sql');
    expect(note).toContain('20260718060823_fix_anonymous_access_policies.sql');
    expect(note).toContain('read_deals');
    expect(note).toContain('TO anon, authenticated');
    expect(note).toContain('Never re-run the unnumbered file after step 2');
    // Neither conflicting file was renamed or edited for this:
    // the note is the only new file for the conflict.
    expect(note).toContain('do not rename');
  });
});
