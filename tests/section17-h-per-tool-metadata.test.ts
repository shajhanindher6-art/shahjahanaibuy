/**
 * Section 17, Stage H item 3 — per-tool metadata coverage for ALL 46 tools.
 *
 * The Section 17 audit (§2) reported "21 of 36 tools have their own
 * metadata, 15 lack it" — that count was stale: Section 16 item 13
 * had already given the 15 client-component tools their metadata in
 * layout.tsx (asserted by tests/section16-seo-metadata.test.ts item
 * 13), and the other 21 export it from page.tsx. A re-count on
 * 12 Nov 2026 confirms 36/36: 21 in page.tsx, 15 in layout.tsx.
 * A re-count on 14 Nov 2026 confirms 46/46: the 10 Future AI Tools
 * (upgrade-advisor, persona-fit, price-match, own-it-check, energy-cost,
 * negotiation-coach, repairability, deal-stacker, refurbished-checklist,
 * compatibility-checker) each export metadata from page.tsx.
 *
 * This test locks the full coverage so a future tool cannot silently
 * inherit the generic /tools hub metadata: every directory under
 * app/tools/ with a page.tsx must export per-tool metadata from
 * either its layout.tsx or its page.tsx, with a self-canonical,
 * a title and a description. Source-text assertions (same approach
 * as the Section 13/16 metadata tests) — the pages import the site
 * header/footer, so they are not imported here. No database, no
 * network.
 */

import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

function readSource(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
}

function toolDirs(): string[] {
  return fs
    .readdirSync(path.join(process.cwd(), 'app/tools'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => fs.existsSync(path.join(process.cwd(), 'app/tools', name, 'page.tsx')))
    .sort();
}

describe('item 3 — every tool has per-tool metadata', () => {
  it('covers all 46 tools (36 + 10 Future AI Tools)', () => {
    expect(toolDirs()).toHaveLength(46);
  });

  it.each(toolDirs())(
    '%s: exports metadata from layout.tsx or page.tsx with a self-canonical',
    (tool) => {
      const layoutPath = `app/tools/${tool}/layout.tsx`;
      const pagePath = `app/tools/${tool}/page.tsx`;
      const layoutSrc = fs.existsSync(path.join(process.cwd(), layoutPath))
        ? readSource(layoutPath)
        : '';
      const pageSrc = readSource(pagePath);
      const metaSrc = layoutSrc.includes('export const metadata') ? layoutSrc : pageSrc;
      expect(metaSrc).toContain('export const metadata');
      expect(metaSrc).toContain(`canonical: \`\${appConfig.url}/tools/${tool}\``);
      expect(metaSrc).toContain('title:');
      expect(metaSrc).toContain('description:');
      // A tool must not carry metadata in BOTH places (the nearer
      // one wins in Next, so a stale duplicate would silently lie).
      expect(
        layoutSrc.includes('export const metadata') &&
          pageSrc.includes('export const metadata')
      ).toBe(false);
    }
  );
});
