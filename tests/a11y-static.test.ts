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
 * Section 14, A-1 adds, in the same static style:
 * 3. Every <button> has an accessible name (aria-label or
 *    non-empty text / expression child); every role="button"
 *    has an aria-label.
 * 4. Every <a> / <Link> has an accessible name (aria-label,
 *    title, text, an sr-only span, or an expression child).
 * 5. Every <input> / <select> / <textarea> is labelled
 *    (aria-label, a matching htmlFor, or a wrapping <label>);
 *    hidden and aria-hidden inputs are exempt, as are the
 *    components/ui/input.tsx + textarea.tsx primitives, which
 *    forward props and cannot carry a static label.
 * 6. The root layout has a skip link and an <html lang>.
 *
 * The scan skips <img> mentions inside // line comments (e.g. the
 * "Lazy + sized <img>" notes in app/page.tsx and
 * app/search/page.tsx) — those are prose, not elements — and
 * inside JSX block comments (same reason).
 *
 * Tag matching is brace-aware: JSX attributes contain `=>` and
 * `{...}` with `>` inside, so a naive `[^>]*` truncates tags
 * before their aria-label. A self-closing <a> that forwards its
 * children via {...props} (the pagination link) is named by its
 * call sites and is exempt from check 4.
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

/**
 * Brace-aware opening-tag scan (Section 14, A-1). JSX attributes
 * contain `=>` and `{...}` with `>` inside, so a naive `[^>]*`
 * truncates tags before their aria-label. This scanner tracks {}
 * () [] depth and quotes and ends the tag at the first `>` at
 * depth 0. Tag names allow dots (Card.Title) for completeness.
 */
function scanTags(src: string): Array<{ name: string; tag: string; index: number }> {
  const out: Array<{ name: string; tag: string; index: number }> = [];
  const re = /<([A-Za-z][\w.]*)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    let i = m.index;
    let depth = 0;
    let quote: string | null = null;
    for (; i < src.length; i++) {
      const c = src[i];
      if (quote) {
        if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'") {
        quote = c;
        continue;
      }
      if (c === '{' || c === '(' || c === '[') depth++;
      else if (c === '}' || c === ')' || c === ']') depth--;
      else if (c === '>' && depth === 0) break;
    }
    out.push({ name: m[1], tag: src.slice(m.index, i + 1), index: m.index });
  }
  return out;
}

/** True when the match sits on a // or /* comment line (prose, not an element). */
function isCommentLine(src: string, index: number): boolean {
  const lineStart = src.lastIndexOf('\n', index - 1) + 1;
  const line = src.slice(lineStart, index).trimStart();
  return line.startsWith('//') || line.startsWith('*') || line.startsWith('{/*');
}

/** Ranges of JSX block comments {/* ... *\/} — prose mentions inside them are not elements. */
function blockCommentRanges(src: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const m of src.matchAll(/\{\/\*[\s\S]*?\*\/\}/g)) {
    const start = m.index ?? 0;
    ranges.push([start, start + m[0].length]);
  }
  return ranges;
}

function insideRanges(ranges: Array<[number, number]>, index: number): boolean {
  return ranges.some(([a, b]) => index >= a && index <= b);
}

function labelRanges(src: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const m of src.matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/gs)) {
    const start = m.index ?? 0;
    ranges.push([start, start + m[0].length]);
  }
  return ranges;
}

/** htmlFor targets in the file — literal ids and template ids alike. */
function htmlForTargets(src: string): Set<string> {
  const targets = new Set<string>();
  for (const m of src.matchAll(/htmlFor=(?:"([^"]+)"|\{`([^`]+)`\})/g)) {
    targets.add(m[1] ?? m[2]);
  }
  return targets;
}

function idOf(tag: string): string | null {
  const m = tag.match(/id=(?:"([^"]+)"|\{`([^`]+)`\})/);
  return m ? (m[1] ?? m[2]) : null;
}

function rel(file: string): string {
  return file.replace(`${process.cwd()}/`, '');
}

describe('static a11y — images', () => {
  it('every <img>/<Image> carries a non-missing alt; alt="" only with a deliberate comment', () => {
    const failures: string[] = [];
    for (const file of FILES) {
      const src = readFileSync(file, 'utf8');
      const blocks = blockCommentRanges(src);
      const tagRe = /<(?:img|Image)\b[^>]*>/gs;
      for (const match of src.matchAll(tagRe)) {
        const tag = match[0];
        const before = src.slice(0, match.index ?? 0);
        const lineStart = before.lastIndexOf('\n') + 1;
        const line = before.slice(lineStart).trimStart();
        // Prose mentions in // comments are not elements.
        if (line.startsWith('//') || line.startsWith('*')) continue;
        // Prose mentions inside a {/* ... */} block comment are
        // not elements either (e.g. "Raw <img> (not next/image)").
        if (insideRanges(blocks, match.index ?? 0)) continue;
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

describe('static a11y — buttons (Section 14, A-1)', () => {
  it('every <button> has an accessible name: aria-label or non-empty text', () => {
    const failures: string[] = [];
    for (const file of FILES) {
      const src = readFileSync(file, 'utf8');
      const blocks = blockCommentRanges(src);
      for (const { tag, index } of scanTags(src).filter((t) => t.name === 'button')) {
        if (isCommentLine(src, index) || insideRanges(blocks, index)) continue;
        if (/aria-label=|aria-labelledby=/.test(tag)) continue;
        // Self-closing icon button with no label is a failure.
        if (tag.endsWith('/>')) {
          failures.push(`${rel(file)}: self-closing <button> without aria-label: ${tag.slice(0, 100)}`);
          continue;
        }
        const rest = src.slice(index + tag.length);
        const close = rest.indexOf('</button>');
        if (close === -1) continue;
        const inner = rest.slice(0, close);
        const text = inner.replace(/<[^>]*>/g, ' ').trim();
        // A {expression} child renders text at runtime (e.g.
        // {plan.cta}); only a purely empty/icon-only button fails.
        if (text === '' && !inner.includes('{')) {
          failures.push(`${rel(file)}: <button> without accessible name: ${tag.slice(0, 100)}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('every role="button" has an aria-label', () => {
    const failures: string[] = [];
    for (const file of FILES) {
      const src = readFileSync(file, 'utf8');
      const blocks = blockCommentRanges(src);
      for (const { tag, index } of scanTags(src)) {
        if (isCommentLine(src, index) || insideRanges(blocks, index)) continue;
        if (/role="button"/.test(tag) && !/aria-label=/.test(tag)) {
          failures.push(`${rel(file)}: ${tag.slice(0, 120)}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });
});

describe('static a11y — links (Section 14, A-1)', () => {
  it('every <a>/<Link> has an accessible name: aria-label, title, text or an expression child', () => {
    const failures: string[] = [];
    for (const file of FILES) {
      const src = readFileSync(file, 'utf8');
      const blocks = blockCommentRanges(src);
      for (const { name, tag, index } of scanTags(src).filter((t) => t.name === 'a' || t.name === 'Link')) {
        if (isCommentLine(src, index) || insideRanges(blocks, index)) continue;
        if (/aria-label=|aria-labelledby=|title=/.test(tag)) continue;
        if (tag.endsWith('/>')) {
          // A wrapper that forwards its children via {...props}
          // (e.g. the pagination link) is named by its call sites.
          if (/\{\.\.\./.test(tag)) continue;
          failures.push(`${rel(file)}: self-closing <${name}> without accessible name: ${tag.slice(0, 100)}`);
          continue;
        }
        const rest = src.slice(index + tag.length);
        const close = rest.indexOf(`</${name}>`);
        if (close === -1) continue;
        const inner = rest.slice(0, close);
        const text = inner.replace(/<[^>]*>/g, ' ').trim();
        // sr-only text names the link even though it is invisible,
        // and a {expression} child renders a string at runtime.
        const hasSrOnly = /sr-only/.test(inner);
        if (text === '' && !inner.includes('{') && !hasSrOnly) {
          failures.push(`${rel(file)}: <${name}> without accessible name: ${tag.slice(0, 110)}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });
});

describe('static a11y — form controls (Section 14, A-1)', () => {
  it('every <input>/<select>/<textarea> is labelled', () => {
    // The ui primitives forward props to the native element, so
    // they cannot carry a static label — their call sites are
    // checked instead, and the primitives are exempt here.
    const exempt = new Set(['components/ui/input.tsx', 'components/ui/textarea.tsx']);
    const failures: string[] = [];
    for (const file of FILES) {
      if (exempt.has(rel(file))) continue;
      const src = readFileSync(file, 'utf8');
      const blocks = blockCommentRanges(src);
      const ranges = labelRanges(src);
      const targets = htmlForTargets(src);
      for (const { name, tag, index } of scanTags(src).filter((t) =>
        t.name === 'input' || t.name === 'select' || t.name === 'textarea'
      )) {
        if (isCommentLine(src, index) || insideRanges(blocks, index)) continue;
        if (name === 'input' && /type="hidden"/.test(tag)) continue;
        // Explicitly hidden from assistive tech (e.g. a sr-only
        // share-link holder) needs no label.
        if (/aria-hidden="true"/.test(tag)) continue;
        if (/aria-label=|aria-labelledby=/.test(tag)) continue;
        const id = idOf(tag);
        if (id && targets.has(id)) continue;
        if (ranges.some(([a, b]) => index >= a && index <= b)) continue;
        failures.push(`${rel(file)}: <${name}> without a label: ${tag.replace(/\s+/g, ' ').slice(0, 110)}`);
      }
    }
    expect(failures).toEqual([]);
  });
});

describe('static a11y — document (Section 14, A-1)', () => {
  it('the root layout has a skip link and an html lang', () => {
    const layout = readFileSync(join(process.cwd(), 'app/layout.tsx'), 'utf8');
    expect(layout).toContain('href="#main-content"');
    expect(layout).toContain('Skip to content');
    expect(layout).toMatch(/<html lang=/);
  });
});
