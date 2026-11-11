/**
 * Static accessibility enforcement (Section 13, chunk H).
 *
 * The only a11y enforcement today is the LHCI warn threshold, so
 * these static assertions lock the two cheapest invariants in the
 * repo's existing static-assertion style (read the source, assert
 * on it — same as tests/press-status.test.ts):
 *
 * 1. Every <img> / <Image> in app/ + components/ carries an alt
 *    attribute. A deliberate alt="" (decorative image whose name
 *    is adjacent text) is allowed ONLY with an explaining comment
 *    directly above it ("alt=\"\" is deliberate").
 * 2. Every role="dialog" carries an aria-label on the same
 *    opening tag.
 *
 * The scan skips <img> mentions inside // line comments (e.g. the
 * "Lazy + sized <img>" notes in app/page.tsx and
 * app/search/page.tsx) — those are prose, not elements.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsxFiles(full));
    else if (entry.endsWith('.tsx')) out.push(full);
  }
  return out;
}

const FILES = [...tsxFiles(join(process.cwd(), 'app')), ...tsxFiles(join(process.cwd(), 'components'))];

describe('static a11y — images', () => {
  it('every <img>/<Image> carries a non-missing alt; alt="" only with a deliberate comment', () => {
    const failures: string[] = [];
    for (const file of FILES) {
      const src = readFileSync(file, 'utf8');
      const tagRe = /<(?:img|Image)\b[^>]*>/gs;
      for (const match of src.matchAll(tagRe)) {
        const tag = match[0];
        const before = src.slice(0, match.index ?? 0);
        const lineStart = before.lastIndexOf('\n') + 1;
        const line = before.slice(lineStart).trimStart();
        // Prose mentions in // comments are not elements.
        if (line.startsWith('//') || line.startsWith('*')) continue;
        const rel = file.replace(`${process.cwd()}/`, '');
        if (!/alt\s*=/.test(tag)) {
          failures.push(`${rel}: <img>/<Image> without alt: ${tag.slice(0, 100)}`);
          continue;
        }
        const emptyAlt = /alt\s*=\s*""/.test(tag) || /alt\s*=\s*\{\s*""\s*\}/.test(tag);
        if (emptyAlt) {
          // The explaining comment must sit directly above the tag.
          const windowBefore = src.slice(Math.max(0, (match.index ?? 0) - 800), match.index ?? 0);
          if (!/alt="" is deliberate/.test(windowBefore)) {
            failures.push(`${rel}: alt="" without a "deliberate" comment above it`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });
});

describe('static a11y — dialogs', () => {
  it('every role="dialog" has an aria-label on the same opening tag', () => {
    const failures: string[] = [];
    for (const file of FILES) {
      const src = readFileSync(file, 'utf8');
      for (const match of src.matchAll(/<[^>]*role="dialog"[^>]*>/gs)) {
        const tag = match[0];
        if (!/aria-label\s*=/.test(tag) && !/aria-labelledby\s*=/.test(tag)) {
          failures.push(`${file.replace(`${process.cwd()}/`, '')}: ${tag.slice(0, 120)}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });
});
