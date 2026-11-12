/**
 * Section 17, Stage H item 20 — viewport meta + 44px touch targets.
 *
 * Source-text assertions (same approach as the other metadata tests):
 * the root layout and the Button component import the app shell, so
 * they are not imported here. No database, no network.
 *
 * - Viewport: Next 13.5.9 has no separate `export const viewport`
 *   (that arrived in Next 14), so the viewport is a field of the
 *   root `metadata` object in app/layout.tsx — the 13.5 convention —
 *   rendering <meta name="viewport" content="width=device-width,
 *   initial-scale=1">.
 * - Touch targets: every Button size variant (default, sm, lg, icon)
 *   is h-11 (44px). `sm` used to be h-9 (36px); 182 size="sm"
 *   usages across the app inherit the 44px minimum from the variant
 *   itself, so no call site needed changing.
 */

import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

function readSource(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
}

describe('item 20 — viewport meta export', () => {
  it('root layout metadata sets width=device-width, initial-scale=1', () => {
    const src = readSource('app/layout.tsx');
    expect(src).toContain('viewport:');
    expect(src).toContain("width: 'device-width'");
    expect(src).toContain('initialScale: 1');
  });
});

describe('item 20 — Button touch targets are 44px', () => {
  it('every size variant is h-11 (44px); no variant is h-9 (36px)', () => {
    const raw = readSource('components/ui/button.tsx');
    // Strip comments: the history note above the variants mentions
    // the old h-9 value — the assertion is about the code, not the prose.
    const src = raw.replace(/\/\/.*$/gm, '');
    expect(src).toContain("default: 'h-11 px-4 py-2'");
    expect(src).toContain("sm: 'h-11 rounded-md px-3'");
    expect(src).toContain("lg: 'h-11 rounded-md px-8'");
    expect(src).toContain("icon: 'h-11 w-11'");
    expect(src).not.toMatch(/size:\s*\{[^}]*h-9/);
  });

  it('size="sm" is still used — the variant change covers all call sites', () => {
    // Guard against a future "fix" that re-introduces a 36px sm:
    // if any size variant drops below h-11, the test above fails.
    // This count is a tripwire, not a budget — sm usages exist and
    // must stay covered by the variant.
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== 'node_modules' && entry.name !== '.next') walk(full);
        } else if (entry.name.endsWith('.tsx') && fs.readFileSync(full, 'utf8').includes('size="sm"')) {
          hits.push(full);
        }
      }
    };
    walk(path.join(process.cwd(), 'app'));
    walk(path.join(process.cwd(), 'components'));
    expect(hits.length).toBeGreaterThan(0);
  });
});
