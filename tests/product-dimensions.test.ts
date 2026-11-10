/**
 * Tests for the Section 6 dimensions / model / authenticity /
 * supply-chain readers (services/product-dimensions.ts).
 *
 * No DB, no network: the Supabase client is faked with the same
 * .from().select().eq().maybeSingle() chain the readers use.
 * Covers the null paths (missing columns, invalid model URLs, empty
 * certifications) and the validation logic. No real secrets.
 */
import { describe, it, expect } from 'vitest';
import {
  getProductDimensions,
  getProductModelUrl,
  getProductAuthenticity,
  getProductSupplyChain,
  sanitizePositiveDimension,
  sanitizeModelUrl,
  sanitizeHttpsUrl,
  sanitizeText,
  sanitizeCertifications,
  MODEL_URL_EXTENSIONS,
  type ProductDimensionsData,
} from '@/services/product-dimensions';
import type { AnySupabaseClient } from '@/lib/supabase/types';

type MaybeSingleResult = { data: Record<string, unknown> | null; error: { message: string } | null };

function fakeClient(result: MaybeSingleResult | Error): AnySupabaseClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (result instanceof Error) throw result;
            return result;
          },
        }),
      }),
    }),
  } as unknown as AnySupabaseClient;
}

const ok = (data: Record<string, unknown>): MaybeSingleResult => ({ data, error: null });
const failed = (message = 'column does not exist'): MaybeSingleResult => ({
  data: null,
  error: { message },
});

describe('sanitizePositiveDimension', () => {
  it('accepts positive numbers and numeric strings (PostgREST numerics)', () => {
    expect(sanitizePositiveDimension(30.48)).toBe(30.48);
    expect(sanitizePositiveDimension('30.48')).toBe(30.48);
    expect(sanitizePositiveDimension(1)).toBe(1);
  });

  it('rejects zero, negatives, NaN, Infinity, null and non-numbers', () => {
    expect(sanitizePositiveDimension(0)).toBeNull();
    expect(sanitizePositiveDimension(-5)).toBeNull();
    expect(sanitizePositiveDimension(NaN)).toBeNull();
    expect(sanitizePositiveDimension(Infinity)).toBeNull();
    expect(sanitizePositiveDimension(null)).toBeNull();
    expect(sanitizePositiveDimension(undefined)).toBeNull();
    expect(sanitizePositiveDimension('abc')).toBeNull();
    expect(sanitizePositiveDimension({})).toBeNull();
  });
});

describe('sanitizeModelUrl', () => {
  it('accepts https .glb and .gltf URLs', () => {
    expect(sanitizeModelUrl('https://cdn.example.com/models/laptop.glb')).toBe(
      'https://cdn.example.com/models/laptop.glb'
    );
    expect(sanitizeModelUrl('https://cdn.example.com/models/laptop.gltf')).toBe(
      'https://cdn.example.com/models/laptop.gltf'
    );
  });

  it('accepts uppercase extensions and query strings (extension checked on pathname)', () => {
    expect(sanitizeModelUrl('https://cdn.example.com/m/Model.GLB')).toBe(
      'https://cdn.example.com/m/Model.GLB'
    );
    expect(sanitizeModelUrl('https://cdn.example.com/m/model.glb?v=2')).toBe(
      'https://cdn.example.com/m/model.glb?v=2'
    );
  });

  it('rejects http URLs — models load over https only', () => {
    expect(sanitizeModelUrl('http://cdn.example.com/models/laptop.glb')).toBeNull();
  });

  it('rejects non-model extensions', () => {
    expect(sanitizeModelUrl('https://cdn.example.com/models/laptop.usdz')).toBeNull();
    expect(sanitizeModelUrl('https://cdn.example.com/models/laptop.obj')).toBeNull();
    expect(sanitizeModelUrl('https://cdn.example.com/models/laptop.png')).toBeNull();
    expect(sanitizeModelUrl('https://example.com/product/laptop')).toBeNull();
  });

  it('rejects empty, relative, malformed and non-string values', () => {
    expect(sanitizeModelUrl('')).toBeNull();
    expect(sanitizeModelUrl('   ')).toBeNull();
    expect(sanitizeModelUrl('/models/laptop.glb')).toBeNull();
    expect(sanitizeModelUrl('not a url')).toBeNull();
    expect(sanitizeModelUrl(null)).toBeNull();
    expect(sanitizeModelUrl(42)).toBeNull();
  });

  it('exposes exactly the .glb/.gltf allow-list', () => {
    expect([...MODEL_URL_EXTENSIONS]).toEqual(['.glb', '.gltf']);
  });
});

describe('sanitizeHttpsUrl / sanitizeText', () => {
  it('accepts https URLs, rejects http and malformed values', () => {
    expect(sanitizeHttpsUrl('https://example.com/verify')).toBe('https://example.com/verify');
    expect(sanitizeHttpsUrl('http://example.com/verify')).toBeNull();
    expect(sanitizeHttpsUrl('not a url')).toBeNull();
    expect(sanitizeHttpsUrl(null)).toBeNull();
  });

  it('trims text and returns null for blank or non-string values', () => {
    expect(sanitizeText('  Serial check  ')).toBe('Serial check');
    expect(sanitizeText('   ')).toBeNull();
    expect(sanitizeText('')).toBeNull();
    expect(sanitizeText(null)).toBeNull();
    expect(sanitizeText(7)).toBeNull();
  });
});

describe('sanitizeCertifications', () => {
  it('trims, drops empties and dedupes, preserving order', () => {
    expect(sanitizeCertifications([' CE ', '', 'FCC', 'CE', '  ', 'RoHS'])).toEqual([
      'CE',
      'FCC',
      'RoHS',
    ]);
  });

  it('returns [] for non-arrays, empty arrays and non-string items', () => {
    expect(sanitizeCertifications([])).toEqual([]);
    expect(sanitizeCertifications(null)).toEqual([]);
    expect(sanitizeCertifications('CE')).toEqual([]);
    expect(sanitizeCertifications([42, null, 'CE'])).toEqual(['CE']);
  });
});

describe('getProductDimensions', () => {
  it('returns recorded dimensions (numeric strings included)', async () => {
    const result = await getProductDimensions(
      fakeClient(ok({ length_cm: '30.41', width_cm: 21.24, height_cm: 1.13 })),
      'prod-1'
    );
    expect(result).toEqual({ lengthCm: 30.41, widthCm: 21.24, heightCm: 1.13 });
  });

  it('returns partial dimensions with nulls for unrecorded sides', async () => {
    const result = await getProductDimensions(
      fakeClient(ok({ length_cm: 30.41, width_cm: null, height_cm: null })),
      'prod-1'
    );
    expect(result).toEqual({ lengthCm: 30.41, widthCm: null, heightCm: null });
  });

  it('returns all nulls when no row exists', async () => {
    const result = await getProductDimensions(fakeClient({ data: null, error: null }), 'prod-1');
    expect(result).toEqual({ lengthCm: null, widthCm: null, heightCm: null });
  });

  it('returns all nulls when the columns are missing (migration 033 not run)', async () => {
    const result = await getProductDimensions(fakeClient(failed()), 'prod-1');
    expect(result).toEqual({ lengthCm: null, widthCm: null, heightCm: null });
  });

  it('returns all nulls when the client throws — never throws', async () => {
    const result = await getProductDimensions(fakeClient(new Error('boom')), 'prod-1');
    expect(result).toEqual({ lengthCm: null, widthCm: null, heightCm: null });
  });

  it('rejects non-positive recorded values instead of surfacing them', async () => {
    const result = await getProductDimensions(
      fakeClient(ok({ length_cm: 0, width_cm: -2, height_cm: 'bad' })),
      'prod-1'
    );
    expect(result).toEqual({ lengthCm: null, widthCm: null, heightCm: null });
  });
});

describe('getProductModelUrl', () => {
  it('returns a valid recorded https .glb URL', async () => {
    const result = await getProductModelUrl(
      fakeClient(ok({ model_url: 'https://cdn.example.com/m/laptop.glb' })),
      'prod-1'
    );
    expect(result).toBe('https://cdn.example.com/m/laptop.glb');
  });

  it('returns null when no model URL is recorded', async () => {
    expect(await getProductModelUrl(fakeClient(ok({ model_url: null })), 'prod-1')).toBeNull();
  });

  it('returns null for an http model URL', async () => {
    const result = await getProductModelUrl(
      fakeClient(ok({ model_url: 'http://cdn.example.com/m/laptop.glb' })),
      'prod-1'
    );
    expect(result).toBeNull();
  });

  it('returns null for a wrong-extension URL', async () => {
    const result = await getProductModelUrl(
      fakeClient(ok({ model_url: 'https://cdn.example.com/m/laptop.usdz' })),
      'prod-1'
    );
    expect(result).toBeNull();
  });

  it('returns null when the column is missing (migration 033 not run)', async () => {
    expect(await getProductModelUrl(fakeClient(failed()), 'prod-1')).toBeNull();
  });

  it('returns null when the client throws — never throws', async () => {
    expect(await getProductModelUrl(fakeClient(new Error('boom')), 'prod-1')).toBeNull();
  });
});

describe('getProductAuthenticity', () => {
  it('returns the recorded method, url and verified timestamp', async () => {
    const result = await getProductAuthenticity(
      fakeClient(
        ok({
          authenticity_method: 'Serial-number check on brand site',
          authenticity_url: 'https://brand.example.com/verify',
          authenticity_verified_at: '2026-11-09T10:00:00.000Z',
        })
      ),
      'prod-1'
    );
    expect(result).toEqual({
      method: 'Serial-number check on brand site',
      url: 'https://brand.example.com/verify',
      verifiedAt: '2026-11-09T10:00:00.000Z',
    });
  });

  it('returns null when nothing is recorded', async () => {
    const result = await getProductAuthenticity(
      fakeClient(
        ok({ authenticity_method: null, authenticity_url: null, authenticity_verified_at: null })
      ),
      'prod-1'
    );
    expect(result).toBeNull();
  });

  it('keeps a recorded method even when the URL is invalid', async () => {
    const result = await getProductAuthenticity(
      fakeClient(
        ok({
          authenticity_method: 'Hologram sticker',
          authenticity_url: 'http://insecure.example.com',
          authenticity_verified_at: null,
        })
      ),
      'prod-1'
    );
    expect(result).toEqual({ method: 'Hologram sticker', url: null, verifiedAt: null });
  });

  it('returns null when the columns are missing (migration 033 not run)', async () => {
    expect(await getProductAuthenticity(fakeClient(failed()), 'prod-1')).toBeNull();
  });

  it('returns null when the client throws — never throws', async () => {
    expect(await getProductAuthenticity(fakeClient(new Error('boom')), 'prod-1')).toBeNull();
  });
});

describe('getProductSupplyChain', () => {
  it('returns the full recorded supply-chain record', async () => {
    const result = await getProductSupplyChain(
      fakeClient(
        ok({
          country_of_origin: 'China',
          manufacturer_name: 'Example Manufacturing Ltd.',
          certifications: ['CE', 'FCC'],
          supply_chain_note: 'Assembled in Shenzhen.',
          supply_chain_source_url: 'https://brand.example.com/supply-chain',
        })
      ),
      'prod-1'
    );
    expect(result).toEqual({
      countryOfOrigin: 'China',
      manufacturerName: 'Example Manufacturing Ltd.',
      certifications: ['CE', 'FCC'],
      note: 'Assembled in Shenzhen.',
      sourceUrl: 'https://brand.example.com/supply-chain',
    });
  });

  it('returns null when nothing is recorded (empty certifications do not count)', async () => {
    const result = await getProductSupplyChain(
      fakeClient(
        ok({
          country_of_origin: null,
          manufacturer_name: null,
          certifications: [],
          supply_chain_note: null,
          supply_chain_source_url: null,
        })
      ),
      'prod-1'
    );
    expect(result).toBeNull();
  });

  it('returns null when the certifications column is absent (pre-033 row shape)', async () => {
    const result = await getProductSupplyChain(
      fakeClient(
        ok({
          country_of_origin: null,
          manufacturer_name: null,
          certifications: null,
          supply_chain_note: null,
          supply_chain_source_url: null,
        })
      ),
      'prod-1'
    );
    expect(result).toBeNull();
  });

  it('cleans recorded certifications and keeps a partial record', async () => {
    const result = await getProductSupplyChain(
      fakeClient(
        ok({
          country_of_origin: null,
          manufacturer_name: null,
          certifications: [' CE ', '', 'CE', 'RoHS'],
          supply_chain_note: null,
          supply_chain_source_url: null,
        })
      ),
      'prod-1'
    );
    expect(result).toEqual({
      countryOfOrigin: null,
      manufacturerName: null,
      certifications: ['CE', 'RoHS'],
      note: null,
      sourceUrl: null,
    });
  });

  it('returns null when the columns are missing (migration 033 not run)', async () => {
    expect(await getProductSupplyChain(fakeClient(failed()), 'prod-1')).toBeNull();
  });

  it('returns null when the client throws — never throws', async () => {
    expect(await getProductSupplyChain(fakeClient(new Error('boom')), 'prod-1')).toBeNull();
  });
});

describe('shape guard', () => {
  it('a fully-null dimensions object is the honest empty state', () => {
    const empty: ProductDimensionsData = { lengthCm: null, widthCm: null, heightCm: null };
    expect(
      empty.lengthCm === null && empty.widthCm === null && empty.heightCm === null
    ).toBe(true);
  });
});
