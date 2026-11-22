/**
 * CJ Affiliate feed — streaming ZIP + CSV importer.
 *
 * Reads a CJ Product Export file (Google Shopping Format CSV,
 * inside a .zip or as a plain .csv) and upserts the filtered rows
 * into public.merchant_offers (migration
 * 20261121_cj_affiliate_offers.sql) in batches of 500.
 *
 * STREAMING, not load-all: the DHGate feed is 1.1M+ rows, so the
 * file is read through unzipper + csv-parse streams and only one
 * 500-row batch is held in memory at a time (target < 256 MB).
 * Nothing is accumulated across batches.
 *
 * FILTERS (lib/offers/cj-feed-transform.ts): only rows that are
 * in stock AND have price > 0 AND a valid image URL are upserted.
 * --only-with-gtin additionally requires a GS1-valid GTIN.
 *
 * HARD COMPLIANCE GATE: every imported row has
 * is_public_live = false unless CJ_PSA_APPROVED=true is set in
 * the environment. The PSA (Publisher Service Agreement) display
 * rules are still UNREAD — do NOT set CJ_PSA_APPROVED=true until
 * they are verified.
 *
 * Usage (run from the repo root):
 *   npx tsx scripts/import-cj-feed.ts --file ./tmp/feeds/DHGate-shopping-20261121.zip
 *   npx tsx scripts/import-cj-feed.ts --file tests/fixtures/cj-sample-shopping.csv --dry-run
 *   npx tsx scripts/import-cj-feed.ts --file <zip> --limit 1000 --only-with-gtin
 *   npm run import:cj-feed -- --file ./tmp/feeds/DHGate-shopping-20261121.zip
 *
 * Flags:
 *   --file <path>        ZIP or CSV feed file (required)
 *   --network <name>     default "cj"
 *   --advertiser-id <id> default "3992613" (DHGate)
 *   --advertiser-name <name> default "DHGate"
 *   --limit <n>          stop after n ACCEPTED rows (0 = no limit)
 *   --only-with-gtin     skip rows without a GS1-valid GTIN
 *   --dry-run            parse + filter only, no database writes
 *
 * Exit code 0 on success, 1 on any fatal error.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse';
import unzipper from 'unzipper';
import { env } from '@/lib/config/env';
import {
  normalizeFeedHeader,
  transformFeedRow,
  type FeedRecord,
  type TransformContext,
} from '@/lib/offers/cj-feed-transform';
import { upsertMerchantOffers } from '@/lib/offers/cj-upsert';
import type { MerchantOfferRow } from '@/lib/offers/types';
import { createSupabaseServiceClient } from '@/lib/supabase/service';

const BATCH_SIZE = 500;
const PROGRESS_EVERY = 10_000;

export interface ImportStats {
  file: string;
  processed: number;
  accepted: number;
  upserted: number;
  skipped: number;
  skippedByReason: Record<string, number>;
  withIdentifier: number;
  errors: number;
  /** Rows that would have been upserted (dry-run only). */
  wouldUpsert: number;
}

interface CliOptions {
  file: string;
  network: string;
  advertiserId: string;
  advertiserName: string;
  limit: number;
  onlyWithGtin: boolean;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliOptions {
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
  return {
    file,
    network: get('--network', 'cj'),
    advertiserId: get('--advertiser-id', '3992613'),
    advertiserName: get('--advertiser-name', 'DHGate'),
    limit,
    onlyWithGtin: argv.includes('--only-with-gtin'),
    dryRun: argv.includes('--dry-run'),
  };
}

function logProgress(stats: ImportStats): void {
  // eslint-disable-next-line no-console
  console.log(
    `[import-cj-feed] processed=${stats.processed} accepted=${stats.accepted} ` +
      `upserted=${stats.upserted} skipped=${stats.skipped} errors=${stats.errors}`,
  );
}

export async function importCjFeed(options: CliOptions): Promise<ImportStats> {
  const supabase = options.dryRun ? null : createSupabaseServiceClient();
  if (!options.dryRun && !supabase) {
    throw new Error(
      'Supabase service client is not configured (SUPABASE_SERVICE_ROLE_KEY is missing). ' +
        'The importer writes through the service role only — set the key or use --dry-run.',
    );
  }

  const filePath = path.resolve(options.file);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Feed file not found: ${filePath}`);
  }
  const isZip = filePath.toLowerCase().endsWith('.zip');

  const ctx: TransformContext = {
    network: options.network,
    advertiserId: options.advertiserId,
    advertiserName: options.advertiserName,
    onlyWithGtin: options.onlyWithGtin,
    psaApproved: env.cjPsaApproved,
    syncedAt: new Date().toISOString(),
  };

  if (!ctx.psaApproved) {
    // eslint-disable-next-line no-console
    console.log(
      '[import-cj-feed] CJ_PSA_APPROVED is not true — all imported rows will have is_public_live = false (PSA compliance gate).',
    );
  }

  const stats: ImportStats = {
    file: filePath,
    processed: 0,
    accepted: 0,
    upserted: 0,
    skipped: 0,
    skippedByReason: {},
    withIdentifier: 0,
    errors: 0,
    wouldUpsert: 0,
  };

  let batch: MerchantOfferRow[] = [];
  let stopped = false;

  const flush = async (): Promise<void> => {
    if (batch.length === 0) return;
    const rows = batch;
    batch = [];
    if (options.dryRun) {
      stats.wouldUpsert += rows.length;
      return;
    }
    const result = await upsertMerchantOffers(
      supabase as NonNullable<typeof supabase>,
      rows,
    );
    if (result.error !== null) {
      stats.errors += rows.length;
      // eslint-disable-next-line no-console
      console.error(`[import-cj-feed] upsert failed for batch of ${rows.length}: ${result.error}`);
      return;
    }
    stats.upserted += result.upserted;
  };

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

  try {
    for await (const record of parser as AsyncIterable<FeedRecord>) {
      if (stopped) break;
      stats.processed += 1;
      try {
        const result = transformFeedRow(record, ctx);
        if (result.row === null) {
          stats.skipped += 1;
          const reason = result.skipReason ?? 'unknown';
          stats.skippedByReason[reason] = (stats.skippedByReason[reason] ?? 0) + 1;
        } else {
          if (result.hasIdentifier) stats.withIdentifier += 1;
          batch.push(result.row);
          stats.accepted += 1;
          if (batch.length >= BATCH_SIZE) {
            await flush();
          }
          if (options.limit > 0 && stats.accepted >= options.limit) {
            stopped = true;
          }
        }
      } catch (err) {
        stats.errors += 1;
        stats.skipped += 1;
        stats.skippedByReason.transform_error =
          (stats.skippedByReason.transform_error ?? 0) + 1;
        // eslint-disable-next-line no-console
        console.error(
          `[import-cj-feed] transform error at record ${stats.processed}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
      if (stats.processed % PROGRESS_EVERY === 0) {
        logProgress(stats);
      }
    }
  } catch (err) {
    // Stream-level failure (bad ZIP, no CSV entry inside, malformed CSV).
    throw new Error(
      `Feed stream failed after ${stats.processed} records: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  } finally {
    await flush();
  }

  return stats;
}

async function main(): Promise<void> {
  let options: CliOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[import-cj-feed] ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
    return;
  }

  try {
    const stats = await importCjFeed(options);
    // eslint-disable-next-line no-console
    console.log(`[import-cj-feed] DONE ${JSON.stringify(stats)}`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[import-cj-feed] FATAL: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

// Run as a CLI script (not when imported by tests).
if (process.argv[1]?.endsWith('import-cj-feed.ts')) {
  void main();
}
