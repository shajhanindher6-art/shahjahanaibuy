/**
 * Section 20 gate fix — client-bundle boundary for price-verification.
 *
 * Root cause (found by the clean-build failure, 2026-11-13): the Section 20
 * #99 hardening made `services/providers/csv-provider.ts` import the
 * visual-search SSRF guard, which imports `node:dns` / `node:net`. That
 * is fine for server code — but `services/price-verification.ts`
 * imported the two intake-source string constants from the server-only
 * intake modules (`./catalog-intake`, `./ebay-intake`), and
 * `price-verification.ts` is imported by a CLIENT component
 * (`components/products/product-card.tsx`). Webpack then tried to
 * bundle `node:net` for the browser and the production build failed
 * (`UnhandledSchemeError: node:net`).
 *
 * Fix: the constants live in the zero-import leaf module
 * `lib/intake-sources.ts`; the intake modules re-export them. These
 * tests pin the boundary: the leaf keeps its values, and
 * `price-verification.ts` never again imports a server-only module.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  EBAY_INTAKE_SOURCE,
  INTAKE_SOURCE,
} from '@/lib/intake-sources';
import { priceVerificationForIntakeSource } from '@/services/price-verification';

describe('intake source constants — leaf module values', () => {
  it('manual-intake and ebay-browse-api are unchanged', () => {
    expect(INTAKE_SOURCE).toBe('manual-intake');
    expect(EBAY_INTAKE_SOURCE).toBe('ebay-browse-api');
  });

  it('priceVerificationForIntakeSource still maps both sources', () => {
    expect(
      priceVerificationForIntakeSource(INTAKE_SOURCE, '2026-11-13'),
    ).toEqual({
      priceVerificationStatus: 'unverified',
      priceSource: 'manual-intake',
      priceVerifiedAt: null,
    });
    expect(
      priceVerificationForIntakeSource(
        EBAY_INTAKE_SOURCE,
        '2026-11-13T00:00:00.000Z',
      ),
    ).toEqual({
      priceVerificationStatus: 'verified',
      priceSource: 'ebay-browse-api',
      priceVerifiedAt: '2026-11-13T00:00:00.000Z',
    });
  });
});

describe('client-bundle boundary — price-verification must not import server-only modules', () => {
  const src = readFileSync(
    `${process.cwd()}/services/price-verification.ts`,
    'utf8',
  );

  it('does not import catalog-intake or ebay-intake', () => {
    expect(src).not.toContain("from './catalog-intake'");
    expect(src).not.toContain("from './ebay-intake'");
    expect(src).toContain("from '@/lib/intake-sources'");
  });

  it('does not import the CSV provider or the visual-search SSRF guard', () => {
    expect(src).not.toContain('csv-provider');
    expect(src).not.toContain('visual-search');
    expect(src).not.toContain('node:');
  });

  it('the leaf module itself imports nothing', () => {
    const leaf = readFileSync(
      `${process.cwd()}/lib/intake-sources.ts`,
      'utf8',
    );
    expect(leaf).not.toMatch(/^import /m);
    expect(leaf).not.toContain('require(');
  });
});

describe('CSV provider hardening is preserved (#99)', () => {
  it('csv-provider still guards its fetch with isSafePublicImageUrl', () => {
    const src = readFileSync(
      `${process.cwd()}/services/providers/csv-provider.ts`,
      'utf8',
    );
    expect(src).toContain('isSafePublicImageUrl');
    expect(src).toContain("from '@/services/visual-search'");
  });
});
