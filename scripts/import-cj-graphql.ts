/**
 * CJ Affiliate — GraphQL Product Search importer.
 *
 * Queries CJ's official Product Search API (POST
 * https://ads.api.cj.com/query) for an approved advertiser's
 * products and upserts the filtered rows into
 * public.merchant_offers (migration
 * 20261121_cj_affiliate_offers.sql) in batches of 500 — the same
 * row shape, skip rules, stats shape, and PSA gate as the CSV
 * feed importer (scripts/import-cj-feed.ts).
 *
 * AUTH: Bearer Personal Access Token from CJ_PERSONAL_ACCESS_TOKEN
 * (Vercel only, never in git). Missing token fails closed with
 * 'not_configured'. The token is never logged.
 *
 * FIRST LIVE USE: run --probe first (one call, limit 1) to learn
 * the real rate limit and confirm the response shape before any
 * bulk run. The query-side rate limit is UNKNOWN in CJ's docs,
 * so the client throttles conservatively (>= 1s between calls).
 *
 * HARD COMPLIANCE GATE: every imported row has
 * is_public_live = false unless CJ_PSA_APPROVED=true is set in
 * the environment. The PSA display rules are still UNREAD — do
 * NOT set CJ_PSA_APPROVED=true until they are verified.
 *
 * Usage (run from the repo root):
 *   npx tsx scripts/import-cj-graphql.ts --probe
 *   npx tsx scripts/import-cj-graphql.ts --gtin 9781234567897 --dry-run
 *   npx tsx scripts/import-cj-graphql.ts --dry-run --limit 100
 *   npx tsx scripts/import-cj-graphql.ts --limit 1000 --only-with-gtin
 *   npm run import:cj-graphql -- --dry-run
 *
 * Flags:
 *   --gtin <value>      single-product lookup by GTIN
 *   --advertiser-id <id> default "3992613" (DHGate)
 *   --advertiser-name <name> default "DHGate"
 *   --company-id <id>   own CID, default "8130731"
 *   --limit <n>         stop after n ACCEPTED rows (0 = no limit)
 *   --only-with-gtin    skip rows without a GS1-valid GTIN
 *   --page-size <n>     products per API call (default 1000, max 10000)
 *   --min-interval-ms <n> ms between calls (default 1000)
 *   --probe             one call, limit 1 — no upsert, prints the result
 *   --dry-run           parse + filter only, no database writes
 *
 * Exit code 0 on success, 1 on any fatal error.
 */

import { env } from '@/lib/config/env';
import {
  searchShoppingProducts,
  toMerchantOfferRow,
  type CjGraphqlConfig,
  type CjSearchParams,
} from '@/lib/offers/cj-graphql';
import { upsertMerchantOffers } from '@/lib/offers/cj-upsert';
import type { MerchantOfferRow } from '@/lib/offers/types';
import type { TransformContext } from '@/lib/offers/cj-feed-transform';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import type { ImportStats } from '@/scripts/import-cj-feed';

const BATCH_SIZE = 500;

export interface CliOptions {
  gtin: string;
  advertiserId: string;
  advertiserName: string;
  companyId: string;
  limit: number;
  onlyWithGtin: boolean;
  pageSize: number;
  minIntervalMs: number;
  probe: boolean;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const get = (flag: string, fallback: string): string => {
    const idx = argv.indexOf(flag);
    return idx >= 0 && argv[idx + 1] !== undefined ? argv[idx + 1] : fallback;
  };
  const intFlag = (flag: string, fallback: number): number => {
    const raw = get(flag, String(fallback));
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`--${flag.replace(/^--/, '')} must be a non-negative integer, got "${raw}"`);
    }
    return value;
  };
  return {
    gtin: get('--gtin', ''),
    advertiserId: get('--advertiser-id', '3992613'),
    advertiserName: get('--advertiser-name', 'DHGate'),
    companyId: get('--company-id', '8130731'),
    limit: intFlag('--limit', 0),
    onlyWithGtin: argv.includes('--only-with-gtin'),
    pageSize: intFlag('--page-size', 1000),
    minIntervalMs: intFlag(
      '--min-interval-ms',
      env.cjGraphqlMinIntervalMs ?? 1000,
    ),
    probe: argv.includes('--probe'),
    dryRun: argv.includes('--dry-run'),
  };
}

export async function importCjGraphql(options: CliOptions): Promise<ImportStats> {
  const supabase = options.dryRun || options.probe ? null : createSupabaseServiceClient();
  if (!options.dryRun && !options.probe && !supabase) {
    throw new Error(
      'Supabase service client is not configured (SUPABASE_SERVICE_ROLE_KEY is missing). ' +
        'The importer writes through the service role only — set the key or use --dry-run.',
    );
  }

  const ctx: TransformContext = {
    network: 'cj',
    advertiserId: options.advertiserId,
    advertiserName: options.advertiserName,
    onlyWithGtin: options.onlyWithGtin,
    psaApproved: env.cjPsaApproved,
    syncedAt: new Date().toISOString(),
  };

  if (!ctx.psaApproved) {
    // eslint-disable-next-line no-console
    console.log(
      '[import-cj-graphql] CJ_PSA_APPROVED is not true — all imported rows will have is_public_live = false (PSA compliance gate).',
    );
  }

  const stats: ImportStats = {
    file: `graphql:${options.advertiserId}`,
    processed: 0,
    accepted: 0,
    upserted: 0,
    skipped: 0,
    skippedByReason: {},
    withIdentifier: 0,
    errors: 0,
    wouldUpsert: 0,
  };

  const config: CjGraphqlConfig = {
    companyId: options.companyId,
    personalAccessToken: env.cjPersonalAccessToken ?? '',
    pid: env.cjPid,
    minIntervalMs: options.minIntervalMs,
  };

  let batch: MerchantOfferRow[] = [];
  const flush = async (): Promise<void> => {
    if (batch.length === 0) return;
    const rows = batch;
    batch = [];
    if (options.dryRun || options.probe) {
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
      console.error(
        `[import-cj-graphql] upsert failed for batch of ${rows.length}: ${result.error}`,
      );
      return;
    }
    stats.upserted += result.upserted;
  };

  const params: CjSearchParams = {
    partnerIds: [options.advertiserId],
    partnerStatus: 'joined',
    limit: options.probe ? 1 : Math.min(options.pageSize, 10_000),
  };
  if (options.gtin !== '') params.gtin = options.gtin;

  const { pages, total } = await searchShoppingProducts(
    params,
    async (page) => {
      for (const product of page.resultList) {
        stats.processed += 1;
        try {
          const result = toMerchantOfferRow(product, ctx, params.currency);
          if (result.row === null) {
            stats.skipped += 1;
            const reason = result.skipReason ?? 'unknown';
            stats.skippedByReason[reason] = (stats.skippedByReason[reason] ?? 0) + 1;
          } else {
            if (result.hasIdentifier) stats.withIdentifier += 1;
            batch.push(result.row);
            stats.accepted += 1;
            if (batch.length >= BATCH_SIZE) await flush();
            if (options.limit > 0 && stats.accepted >= options.limit) {
              await flush();
              return false; // stop pagination
            }
          }
        } catch (err) {
          stats.errors += 1;
          stats.skipped += 1;
          stats.skippedByReason.transform_error =
            (stats.skippedByReason.transform_error ?? 0) + 1;
          // eslint-disable-next-line no-console
          console.error(
            `[import-cj-graphql] transform error at product ${stats.processed}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
      // Probe mode is one page by contract: stop pagination after the
      // first API call, even when the response carries a page token
      // for a large catalog (the --limit stop above never fires in
      // probe mode because its flag defaults to 0).
      if (options.probe) return false;
      return undefined;
    },
    config,
  );

  await flush();

  if (options.probe) {
    // eslint-disable-next-line no-console
    console.log(
      `[import-cj-graphql] PROBE pages=${pages} total=${total} ` +
        `processed=${stats.processed} accepted=${stats.accepted}`,
    );
  }
  return stats;
}

async function main(): Promise<void> {
  let options: CliOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[import-cj-graphql] ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
    return;
  }

  try {
    const stats = await importCjGraphql(options);
    // eslint-disable-next-line no-console
    console.log(`[import-cj-graphql] DONE ${JSON.stringify(stats)}`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[import-cj-graphql] FATAL: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

// Run as a CLI script (not when imported by tests).
if (process.argv[1]?.endsWith('import-cj-graphql.ts')) {
  void main();
}
