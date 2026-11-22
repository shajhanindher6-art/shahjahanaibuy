/**
 * CJ Affiliate feed — read-only analysis.
 *
 * Streams a CJ Product Export file (Google Shopping Format CSV,
 * inside a .zip or as a plain .csv) and reports REAL metrics —
 * no database writes, ever. Built for the DHGate feed
 * (1,118,904 records) so the first real download can be measured
 * before any import decision.
 *
 * Metrics: total / accepted / rejected (by the same rules as the
 * importer), GTIN + MPN coverage, invalid prices, duplicate
 * external ids / GTINs, missing identifiers / images /
 * descriptions, currency + category distribution, affiliate-URL
 * validity, feed freshness, parse errors.
 *
 * Usage (run from the repo root):
 *   npx tsx scripts/analyze-cj-feed.ts --file ./tmp/feeds/DHGate-shopping-20261121.zip
 *   npx tsx scripts/analyze-cj-feed.ts --file tests/fixtures/cj-sample-shopping.csv
 *   npx tsx scripts/analyze-cj-feed.ts --file <zip> --out ./tmp/feeds/analysis.json
 *   npm run analyze:cj-feed -- --file ./tmp/feeds/DHGate-shopping-20261121.zip
 *
 * Flags:
 *   --file <path>     ZIP or CSV feed file (required)
 *   --limit <n>       stop after n PROCESSED rows (0 = no limit)
 *   --only-with-gtin  apply the importer's GTIN-only filter to "accepted"
 *   --out <path>      also write the JSON report to this file
 *
 * Exit code 0 on success, 1 on any fatal error.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse';
import unzipper from 'unzipper';
import {
  isValidImageUrl,
  normalizeFeedHeader,
  normalizeGtinValue,
  parseFeedPrice,
  transformFeedRow,
  type FeedRecord,
  type TransformContext,
} from '@/lib/offers/cj-feed-transform';

export interface FeedAnalysis {
  file: string;
  fileSizeBytes: number;
  fileModifiedAt: string;
  exportDateFromFilename: string | null;
  exportAgeDays: number | null;
  processed: number;
  accepted: number;
  skipped: number;
  skippedByReason: Record<string, number>;
  withIdentifier: number;
  gtinCoverage: { valid: number; total: number };
  mpnCoverage: { present: number; total: number };
  missingIdentifiers: number;
  duplicateExternalIds: { count: number; examples: string[] };
  duplicateGtins: { count: number; examples: string[] };
  invalidPrices: number;
  missingImages: number;
  missingDescriptions: number;
  invalidAffiliateUrls: number;
  currencyDistribution: Record<string, number>;
  categoryDistribution: Array<{ category: string; count: number }>;
  distinctCategories: number;
  parseErrors: number;
}

interface AnalyzeOptions {
  file: string;
  limit: number;
  onlyWithGtin: boolean;
  out?: string;
}

function parseArgs(argv: string[]): AnalyzeOptions {
  const get = (flag: string, fallback: string): string => {
    const idx = argv.indexOf(flag);
    return idx >= 0 && argv[idx + 1] !== undefined ? argv[idx + 1] : fallback;
  };
  const file = get('--file', '');
  if (!file) {
    throw new Error('Missing required flag: --file <path to .zip or .csv feed file>');
  }
  const limitRaw = get('--limit', '0');
  const limit = Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 0) {
    throw new Error(`--limit must be a non-negative integer, got "${limitRaw}"`);
  }
  const out = get('--out', '');
  return {
    file,
    limit,
    onlyWithGtin: argv.includes('--only-with-gtin'),
    out: out === '' ? undefined : out,
  };
}

function topCategories(counts: Map<string, number>, topN: number): Array<{ category: string; count: number }> {
  return [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);
}

export async function analyzeCjFeed(options: AnalyzeOptions): Promise<FeedAnalysis> {
  const filePath = path.resolve(options.file);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Feed file not found: ${filePath}`);
  }
  const isZip = filePath.toLowerCase().endsWith('.zip');
  const stat = fs.statSync(filePath);
  const fileName = path.basename(filePath);
  const dateMatch = fileName.match(/(\d{4})(\d{2})(\d{2})/);
  const exportDate = dateMatch
    ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`
    : null;
  const exportAgeDays =
    exportDate !== null
      ? Math.floor(
          (Date.now() - Date.parse(`${exportDate}T00:00:00.000Z`)) / 86_400_000,
        )
      : null;

  const ctx: TransformContext = {
    network: 'cj',
    advertiserId: '3992613',
    advertiserName: 'DHGate',
    onlyWithGtin: options.onlyWithGtin,
    psaApproved: false,
    syncedAt: new Date().toISOString(),
  };

  const analysis: FeedAnalysis = {
    file: filePath,
    fileSizeBytes: stat.size,
    fileModifiedAt: stat.mtime.toISOString(),
    exportDateFromFilename: exportDate,
    exportAgeDays,
    processed: 0,
    accepted: 0,
    skipped: 0,
    skippedByReason: {},
    withIdentifier: 0,
    gtinCoverage: { valid: 0, total: 0 },
    mpnCoverage: { present: 0, total: 0 },
    missingIdentifiers: 0,
    duplicateExternalIds: { count: 0, examples: [] },
    duplicateGtins: { count: 0, examples: [] },
    invalidPrices: 0,
    missingImages: 0,
    missingDescriptions: 0,
    invalidAffiliateUrls: 0,
    currencyDistribution: {},
    categoryDistribution: [],
    distinctCategories: 0,
    parseErrors: 0,
  };

  const seenIds = new Set<string>();
  const seenGtins = new Set<string>();
  const currencyCounts = new Map<string, number>();
  const categoryCounts = new Map<string, number>();

  const csvStream = isZip
    ? fs.createReadStream(filePath).pipe(unzipper.ParseOne(/\.csv$/i))
    : fs.createReadStream(filePath);

  const parser = csvStream.pipe(
    parse({
      columns: (header: string[]) => header.map(normalizeFeedHeader),
      skip_empty_lines: true,
      trim: true,
      bom: true,
      relax_column_count: true,
    }),
  );

  let stopped = false;
  try {
    for await (const record of parser as AsyncIterable<FeedRecord>) {
      if (stopped) break;
      analysis.processed += 1;
      try {
        // Identifier coverage (raw record, independent of accept/skip).
        const gtin = normalizeGtinValue(record.gtin);
        if (gtin !== null) {
          analysis.gtinCoverage.valid += 1;
          if (seenGtins.has(gtin)) {
            analysis.duplicateGtins.count += 1;
            if (analysis.duplicateGtins.examples.length < 10) {
              analysis.duplicateGtins.examples.push(gtin);
            }
          } else {
            seenGtins.add(gtin);
          }
        }
        const mpn = (record.mpn ?? '').trim();
        if (mpn !== '') analysis.mpnCoverage.present += 1;
        if (gtin === null && mpn === '') analysis.missingIdentifiers += 1;

        const externalId = (record.id ?? '').trim();
        if (externalId !== '') {
          if (seenIds.has(externalId)) {
            analysis.duplicateExternalIds.count += 1;
            if (analysis.duplicateExternalIds.examples.length < 10) {
              analysis.duplicateExternalIds.examples.push(externalId);
            }
          } else {
            seenIds.add(externalId);
          }
        }

        const price = parseFeedPrice(record.price);
        if (price === null || price.amount <= 0) {
          analysis.invalidPrices += 1;
        } else {
          currencyCounts.set(
            price.currency,
            (currencyCounts.get(price.currency) ?? 0) + 1,
          );
        }

        if (!isValidImageUrl(record.image_link)) analysis.missingImages += 1;
        if ((record.description ?? '').trim() === '') analysis.missingDescriptions += 1;
        if (!isValidImageUrl(record.link)) analysis.invalidAffiliateUrls += 1;

        // Category distribution uses the human-readable name when the
        // feed carries one (CJ's sample has a numeric
        // google_product_category ID plus a _name column); falls
        // back to the ID, then product_type.
        const category =
          (record.google_product_category_name ?? '').trim() ||
          (record.google_product_category ?? '').trim() ||
          (record.product_type ?? '').trim();
        if (category !== '') {
          categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
        }

        // Accept/skip by the importer's own rules.
        const result = transformFeedRow(record, ctx);
        if (result.row === null) {
          analysis.skipped += 1;
          const reason = result.skipReason ?? 'unknown';
          analysis.skippedByReason[reason] =
            (analysis.skippedByReason[reason] ?? 0) + 1;
        } else {
          analysis.accepted += 1;
          if (result.hasIdentifier) analysis.withIdentifier += 1;
        }
      } catch (err) {
        analysis.parseErrors += 1;
        // eslint-disable-next-line no-console
        console.error(
          `[analyze-cj-feed] record error at row ${analysis.processed}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
      if (options.limit > 0 && analysis.processed >= options.limit) {
        stopped = true;
      }
    }
  } catch (err) {
    throw new Error(
      `Feed stream failed after ${analysis.processed} records: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  analysis.gtinCoverage.total = analysis.processed;
  analysis.mpnCoverage.total = analysis.processed;
  analysis.distinctCategories = categoryCounts.size;
  analysis.categoryDistribution = topCategories(categoryCounts, 20);
  analysis.currencyDistribution = Object.fromEntries(currencyCounts);

  if (options.out !== undefined) {
    const outPath = path.resolve(options.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(analysis, null, 2)}\n`);
    // eslint-disable-next-line no-console
    console.log(`[analyze-cj-feed] report written to ${outPath}`);
  }
  return analysis;
}

async function main(): Promise<void> {
  let options: AnalyzeOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[analyze-cj-feed] ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
    return;
  }

  try {
    const analysis = await analyzeCjFeed(options);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(analysis, null, 2));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[analyze-cj-feed] FATAL: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

// Run as a CLI script (not when imported by tests).
if (process.argv[1]?.endsWith('analyze-cj-feed.ts')) {
  void main();
}
