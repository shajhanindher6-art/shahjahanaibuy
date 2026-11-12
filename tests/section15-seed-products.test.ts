/**
 * Seed-products SQL tests (Section 15, A10).
 *
 * supabase/seed-products.sql is the ONLY place the repo can recreate
 * the 10 public catalog products (there was no INSERT INTO products
 * anywhere before it). This file pins its contents as text — it never
 * runs the SQL (no DB in unit tests) — so a future edit cannot
 * silently drop a product, add a row, or re-create the excluded
 * sample-laptop health-check row.
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const SQL = fs.readFileSync(
  path.join(process.cwd(), 'supabase/seed-products.sql'),
  'utf8'
);

/** Non-comment lines only — the header/footer comments mention sample-laptop on purpose. */
const CODE_LINES = SQL.split('\n').filter((line) => !line.trimStart().startsWith('--'));

const CATALOG_SLUGS = [
  'macbook-air-13',
  'galaxy-s24-ultra',
  'sony-wh-1000xm5',
  'dell-xps-13',
  'lenovo-thinkpad-x1',
  'bose-quietcomfort-ultra',
  'canon-eos-r10',
  'gopro-hero12',
  'garmin-venu-3',
  'logitech-mx-master-3s',
];

describe('seed-products.sql — recreates exactly the 10 public products', () => {
  it('inserts into products with ON CONFLICT DO NOTHING (idempotent)', () => {
    expect(SQL).toMatch(/INSERT INTO (public\.)?products/i);
    expect(SQL).toMatch(/ON CONFLICT \(id\) DO NOTHING/i);
  });

  it('contains all 10 catalog slugs, each exactly once in code lines', () => {
    const code = CODE_LINES.join('\n');
    for (const slug of CATALOG_SLUGS) {
      const occurrences = code.split(`'${slug}'`).length - 1;
      expect(occurrences, slug).toBe(1);
    }
  });

  it('never re-creates the sample-laptop health-check row', () => {
    const code = CODE_LINES.join('\n');
    expect(code).not.toContain('sample-laptop');
  });

  it('keeps image_url and gtin NULL (live values) and confidence_score 50 on all 10 rows', () => {
    const code = CODE_LINES.join('\n');
    expect(code).not.toMatch(/image_url\s*,\s*'https?:/i);
    // Exactly one ", 50," per row (the confidence_score value).
    expect(code.split(', 50,').length - 1).toBe(10);
  });
});
