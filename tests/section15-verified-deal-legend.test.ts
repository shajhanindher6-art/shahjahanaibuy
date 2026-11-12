/**
 * Section 15, W1B — "Verified" deal legend (audit item C8).
 *
 * DEAL_VERIFIED_MEANING exists in lib/fact-check.ts but had zero
 * public uses. Both public pages below now render the constant
 * itself — word-for-word, never a paraphrase — so the badge meaning
 * shoppers see is exactly the fact-check source text. The pages
 * import the site header/footer, so wiring is asserted by reading
 * the source files as text (same approach as the Section 13/14
 * trust tests). No database, no network.
 */

import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DEAL_VERIFIED_MEANING } from '@/lib/fact-check';

function readSource(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
}

describe('Verified-deal legend (C8)', () => {
  it('publishes the fact-check meaning on the deals page badge legend', () => {
    const src = readSource('app/deals/page.tsx');
    expect(src).toContain(
      "import { DEAL_VERIFIED_MEANING } from '@/lib/fact-check'"
    );
    expect(src).toContain('{DEAL_VERIFIED_MEANING}');
    expect(src).toContain('What this badge means');
  });

  it('publishes the same meaning on the methodology page', () => {
    const src = readSource('app/methodology/page.tsx');
    expect(src).toContain(
      "import { DEAL_VERIFIED_MEANING } from '@/lib/fact-check'"
    );
    expect(src).toContain('{DEAL_VERIFIED_MEANING}');
  });

  it('the published text is the constant itself, not a paraphrase', () => {
    // Both pages render {DEAL_VERIFIED_MEANING} directly, so what
    // shoppers read is exactly this string — including its limits
    // ("not a guarantee", "never means SmartBuy sells the product").
    expect(DEAL_VERIFIED_MEANING).toContain('passed SmartBuy');
    expect(DEAL_VERIFIED_MEANING).toContain('it is not a guarantee the price is still live');
    expect(DEAL_VERIFIED_MEANING).toContain('never means SmartBuy sells the product');
    expect(DEAL_VERIFIED_MEANING).toContain('never shown as Verified');
  });
});
