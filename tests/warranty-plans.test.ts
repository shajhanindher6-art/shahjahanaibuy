import { describe, expect, it } from 'vitest';
import {
  getWarrantyPlansByCategory,
  createWarrantyPlan,
  updateWarrantyPlan,
  validateWarrantyPlanInput,
  mapWarrantyPlanRow,
  isMissingTable,
} from '@/lib/warranty-plans';

// Minimal thenable stub for the Supabase query chain used by
// lib/warranty-plans.ts: from().select().eq().order() awaited as a
// whole, .insert().select().single() / .update().eq().select().single().
function makeChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    insert: () => chain,
    update: () => chain,
    single: async () => result,
    then: (resolve: (v: unknown) => void) => resolve(result),
  };
  return chain;
}

function makeSupabase(result: { data: unknown; error: unknown }) {
  return {
    from: () => makeChain(result),
  };
}

const ROW = {
  id: 'plan-1',
  provider_name: 'Acme Cover',
  plan_name: 'Extended 2-Year',
  coverage_summary: 'Accidental damage cover.',
  duration_months: 24,
  price_usd: 99.99,
  currency: 'USD',
  deductible_usd: 25,
  product_category: 'Laptops',
  merchant_id: null,
  source_url: 'https://example.com/plan',
  verified_at: '2026-11-10T00:00:00.000Z',
  is_active: true,
  created_at: '2026-11-10T00:00:00.000Z',
};

describe('mapWarrantyPlanRow', () => {
  it('maps snake_case rows to camelCase plans, keeping recorded nulls', () => {
    const plan = mapWarrantyPlanRow(ROW);
    expect(plan.id).toBe('plan-1');
    expect(plan.providerName).toBe('Acme Cover');
    expect(plan.planName).toBe('Extended 2-Year');
    expect(plan.priceUsd).toBe(99.99);
    expect(plan.durationMonths).toBe(24);
    expect(plan.deductibleUsd).toBe(25);
    expect(plan.productCategory).toBe('Laptops');
    expect(plan.sourceUrl).toBe('https://example.com/plan');
    expect(plan.isActive).toBe(true);
  });

  it('keeps unrecorded numeric fields null — never a guessed price', () => {
    const plan = mapWarrantyPlanRow({ ...ROW, price_usd: null, deductible_usd: null, duration_months: null });
    expect(plan.priceUsd).toBeNull();
    expect(plan.deductibleUsd).toBeNull();
    expect(plan.durationMonths).toBeNull();
  });
});

describe('validateWarrantyPlanInput', () => {
  it('accepts a minimal valid plan (names only)', () => {
    expect(validateWarrantyPlanInput({ providerName: 'Acme', planName: 'Basic' })).toBeNull();
  });

  it('requires provider and plan names', () => {
    expect(validateWarrantyPlanInput({ providerName: '', planName: 'Basic' })).toContain('providerName');
    expect(validateWarrantyPlanInput({ providerName: 'Acme', planName: '  ' })).toContain('planName');
  });

  it('rejects a zero or negative price and a negative deductible/duration', () => {
    expect(
      validateWarrantyPlanInput({ providerName: 'A', planName: 'B', priceUsd: 0 })
    ).toContain('priceUsd');
    expect(
      validateWarrantyPlanInput({ providerName: 'A', planName: 'B', priceUsd: -5 })
    ).toContain('priceUsd');
    expect(
      validateWarrantyPlanInput({ providerName: 'A', planName: 'B', deductibleUsd: -1 })
    ).toContain('deductibleUsd');
    expect(
      validateWarrantyPlanInput({ providerName: 'A', planName: 'B', durationMonths: -12 })
    ).toContain('durationMonths');
  });

  it('rejects a non-http(s) source URL', () => {
    expect(
      validateWarrantyPlanInput({ providerName: 'A', planName: 'B', sourceUrl: 'ftp://example.com' })
    ).toContain('sourceUrl');
  });
});

describe('isMissingTable', () => {
  it('treats both 42P01 and PGRST205 as "migration not run yet"', () => {
    expect(isMissingTable({ code: '42P01' })).toBe(true);
    expect(isMissingTable({ code: 'PGRST205' })).toBe(true);
    expect(isMissingTable({ code: '23505' })).toBe(false);
    expect(isMissingTable(null)).toBe(false);
  });
});

describe('getWarrantyPlansByCategory (fail-safe reads)', () => {
  it('returns mapped plans when the table exists', async () => {
    const supabase = makeSupabase({ data: [ROW], error: null });
    const plans = await getWarrantyPlansByCategory(supabase as never, 'Laptops');
    expect(plans).toHaveLength(1);
    expect(plans[0].providerName).toBe('Acme Cover');
  });

  it('returns [] when migration 033 has not been run (PGRST205)', async () => {
    const supabase = makeSupabase({
      data: null,
      error: { code: 'PGRST205', message: 'Could not find the table' },
    });
    expect(await getWarrantyPlansByCategory(supabase as never, 'Laptops')).toEqual([]);
  });

  it('returns [] when migration 033 has not been run (42P01)', async () => {
    const supabase = makeSupabase({
      data: null,
      error: { code: '42P01', message: 'relation does not exist' },
    });
    expect(await getWarrantyPlansByCategory(supabase as never)).toEqual([]);
  });

  it('returns [] on any other query failure — never a crash', async () => {
    const supabase = makeSupabase({ data: null, error: { code: '500', message: 'boom' } });
    expect(await getWarrantyPlansByCategory(supabase as never)).toEqual([]);
  });
});

describe('createWarrantyPlan / updateWarrantyPlan', () => {
  it('creates a plan from valid input', async () => {
    const supabase = makeSupabase({ data: ROW, error: null });
    const created = await createWarrantyPlan(supabase as never, {
      providerName: 'Acme Cover',
      planName: 'Extended 2-Year',
      priceUsd: 99.99,
    });
    expect(created?.id).toBe('plan-1');
    expect(created?.priceUsd).toBe(99.99);
  });

  it('refuses invalid input without touching the database', async () => {
    const supabase = makeSupabase({ data: ROW, error: null });
    expect(
      await createWarrantyPlan(supabase as never, { providerName: '', planName: 'X' })
    ).toBeNull();
  });

  it('returns null when the table is missing on create', async () => {
    const supabase = makeSupabase({
      data: null,
      error: { code: 'PGRST205', message: 'Could not find the table' },
    });
    expect(
      await createWarrantyPlan(supabase as never, { providerName: 'A', planName: 'B' })
    ).toBeNull();
  });

  it('updates a plan and returns the updated row', async () => {
    const supabase = makeSupabase({ data: { ...ROW, price_usd: 79.99 }, error: null });
    const updated = await updateWarrantyPlan(supabase as never, 'plan-1', { priceUsd: 79.99 });
    expect(updated?.priceUsd).toBe(79.99);
  });

  it('returns null for an empty patch — nothing to update', async () => {
    const supabase = makeSupabase({ data: ROW, error: null });
    expect(await updateWarrantyPlan(supabase as never, 'plan-1', {})).toBeNull();
  });
});
