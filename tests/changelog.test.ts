import { describe, expect, it } from 'vitest';
import { RELEASES, PENDING_SYNC_RELEASES } from '../app/changelog/releases';

describe('changelog releases', () => {
  it('lists all 75 releases from the sync record plus Sections 13, 14 and 15 and both soft-404 fixes', () => {
    expect(RELEASES.length).toBe(75);
  });

  it('records Section 15: four batches plus the soft-404 fix', () => {
    const batches: Array<[string, number]> = [
      ['a026129ba888fa9271cc5377abbb75c07cb450b2', 56],
      ['59643bb2062cdfbb4f2aa03d03439e568c3c04e5', 60],
      ['3eef2bc0d394186b34920ad08053ceb14e4f20b2', 60],
      ['7ca4870a5faece8ab3c3223bdeb6ed3205bd99ef', 44],
    ];
    for (const [sha, count] of batches) {
      const batch = RELEASES.find((r) => r.sha === sha);
      expect(batch?.date).toBe('2026-11-12');
      expect(batch?.paths.length).toBe(count);
    }
    const foundations = RELEASES.find(
      (r) => r.sha === 'a026129ba888fa9271cc5377abbb75c07cb450b2'
    );
    expect(foundations?.paths).toContain('services/ebay-intake.ts');
    expect(foundations?.paths).toContain(
      'supabase/migrations/20261112094000_041_ebay_ingestion.sql'
    );
    const appPart1 = RELEASES.find(
      (r) => r.sha === '59643bb2062cdfbb4f2aa03d03439e568c3c04e5'
    );
    expect(appPart1?.paths).toContain('app/find/page.tsx');
    expect(appPart1?.paths).toContain('app/go/route.ts');
    expect(appPart1?.paths).toContain('app/tools/coupons-cashback/page.tsx');
    const tests = RELEASES.find(
      (r) => r.sha === '7ca4870a5faece8ab3c3223bdeb6ed3205bd99ef'
    );
    expect(tests?.paths).toContain('tests/press-status.test.ts');
    expect(tests?.paths).toContain('tests/changelog.test.ts');
    const soft404 = RELEASES.find(
      (r) => r.sha === 'ca6dd621121704dba23107b147e0d901aeec65a3'
    );
    expect(soft404?.date).toBe('2026-11-12');
    expect(soft404?.paths.length).toBe(9);
    expect(soft404?.paths).toContain('app/products/[slug]/layout.tsx');
    expect(soft404?.paths).toContain('app/brands/[slug]/layout.tsx');
    expect(soft404?.paths).toContain('app/categories/[slug]/layout.tsx');
    expect(soft404?.paths).toContain('tests/section15-soft404-layout.test.ts');
  });

  it('records Section 14: four batches plus the two follow-ups', () => {
    const batches: Array<[string, number]> = [
      ['51ad559904f67d01b294c4da9553b91c0d6be595', 63],
      ['74b5dd845cee2eda50d0f4c99ed600e740409dbc', 43],
      ['be97a7bb048622f0b50f8adada749a6aa55ca74f', 38],
      ['9b19e782fc7c255d7e1898a2f1fbc5b378790273', 39],
    ];
    for (const [sha, count] of batches) {
      const batch = RELEASES.find((r) => r.sha === sha);
      expect(batch?.date).toBe('2026-11-11');
      expect(batch?.paths.length).toBe(count);
    }
    const main = RELEASES.find(
      (r) => r.sha === '9b19e782fc7c255d7e1898a2f1fbc5b378790273'
    );
    expect(main?.paths).toContain('app/products/page.tsx');
    expect(main?.paths).toContain('app/partners/page.tsx');
    expect(main?.paths).toContain('app/referrals/page.tsx');
    const chartDelete = RELEASES.find(
      (r) => r.sha === '2f70e1fd7ac9a1b5d818ab1ca2f4083214e321fd'
    );
    expect(chartDelete?.date).toBe('2026-11-11');
    expect(chartDelete?.paths).toEqual(['components/products/price-chart.tsx']);
    const methodFix = RELEASES.find(
      (r) => r.sha === 'b7a562e0b8e01f46273b5b783c451c207b3737f3'
    );
    expect(methodFix?.date).toBe('2026-11-12');
    expect(methodFix?.paths).toEqual([
      'app/methodology/page.tsx',
      'tests/section12-trust.test.ts',
    ]);
  });

  it('records Section 13: main push plus the two web follow-ups', () => {
    const main = RELEASES.find((r) => r.sha === '0df20fc5d8c3eef4ae4d163e675939e1141d5246');
    expect(main?.date).toBe('2026-11-11');
    expect(main?.paths.length).toBe(131);
    expect(main?.paths).toContain('app/tools/price-history/page.tsx');
    expect(main?.paths).toContain('app/tools/currency-converter/page.tsx');
    const chartDelete = RELEASES.find(
      (r) => r.sha === '9296fb23dc6d9c2942027c157f0231eb3029ec43'
    );
    expect(chartDelete?.date).toBe('2026-11-11');
    expect(chartDelete?.paths).toEqual(['components/ui/chart.tsx']);
    const icons = RELEASES.find((r) => r.sha === 'edb30adcd54ce2a33ef38712193db153aecbedfc');
    expect(icons?.date).toBe('2026-11-11');
    expect(icons?.paths).toEqual([
      'extension/icons/icon-16.png',
      'extension/icons/icon-48.png',
      'extension/icons/icon-128.png',
    ]);
  });

  it('has unique full commit SHAs', () => {
    const shas = RELEASES.map((r) => r.sha);
    expect(new Set(shas).size).toBe(shas.length);
    for (const sha of shas) expect(sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it('gives every release a title and a non-empty changed-files list', () => {
    for (const release of RELEASES) {
      expect(release.title.length).toBeGreaterThan(5);
      expect(release.paths.length).toBeGreaterThan(0);
    }
  });

  it('shows a date only when confirmed — and any shown date is a valid ISO date', () => {
    const dated = RELEASES.filter((r) => r.date);
    expect(dated.length).toBeGreaterThan(0);
    for (const release of dated) {
      expect(release.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(release.date ?? ''))).toBe(false);
    }
    // The crash-fix release is the latest dated entry in the record.
    const fix = RELEASES.find((r) => r.sha.startsWith('f4a15b4f'));
    expect(fix?.date).toBe('2026-11-10');
  });

  it('keeps pending-sync releases separate, each with a confirmed date', () => {
    expect(PENDING_SYNC_RELEASES.length).toBeGreaterThan(0);
    for (const release of PENDING_SYNC_RELEASES) {
      expect(release.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(release.title.length).toBeGreaterThan(5);
    }
    expect(RELEASES.some((r) => r.sha.startsWith('83d848ac'))).toBe(false);
  });
});
