#!/usr/bin/env node
/**
 * Local CLIP embedding pass for SmartBuy AI visual search.
 *
 * Generates 512-dimensional CLIP text embeddings for every catalog
 * product — OFFLINE, on this machine, with ZERO API calls — and
 * upserts them into the product_clip_embeddings table in Supabase.
 *
 * WHY THIS IS A LOCAL SCRIPT (not a server route):
 * The CLIP text encoder alone is ~150-250 MB. It cannot load inside
 * a Vercel Hobby serverless function (10s timeout, 250 MB function
 * size limit). The serverless route therefore never runs CLIP: it
 * embeds only the caption TEXT via the Hugging Face Inference API
 * and matches it against the vectors this script stores.
 *
 * WHAT IT EMBEDS — product TEXT only (name + brand + description),
 * using the SAME shape as productEmbeddingText() in
 * services/visual-search.ts. No photos are read, downloaded, or
 * stored anywhere. Keep the two in sync: if the shape changes in
 * one place, change it in the other, or a product's stored vector
 * will mean something different from what the route queries with.
 *
 * MODEL (verified from the installed @huggingface/transformers
 * v4.3.2 package itself — its pipeline registry defaults
 * zero-shot-image-classification to this ID):
 *   Xenova/clip-vit-base-patch32
 * Only the TEXT encoder is loaded (CLIPTextModelWithProjection),
 * so the vision encoder is never downloaded. First run downloads
 * the model once into the Hugging Face cache
 * (~/.cache/huggingface/hub); later runs reuse it and work offline.
 *
 * USAGE (run from the repo root):
 *   node scripts/embed-products-local.mjs --dry-run
 *   node scripts/embed-products-local.mjs
 *   node scripts/embed-products-local.mjs --limit 3
 *   node scripts/embed-products-local.mjs --force
 *
 * ENVIRONMENT (local shell only — never commit these):
 *   SUPABASE_URL               e.g. https://<ref>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY  from the Supabase dashboard
 * The script REFUSES to run without both. Key values are never
 * printed or logged.
 */

import { createClient } from '@supabase/supabase-js';

const CLIP_MODEL_ID = 'Xenova/clip-vit-base-patch32';
const CLIP_EMBEDDING_DIMS = 512;

function usageError(message) {
  console.error(`error: ${message}\n`);
  console.error(
    [
      'usage: node scripts/embed-products-local.mjs [--dry-run] [--limit N] [--force]',
      '',
      '  --dry-run   Validate env vars and arguments, report what would',
      '              happen, and exit WITHOUT downloading the model.',
      '  --limit N   Embed at most N products (default: all).',
      '  --force     Re-embed every product, replacing stored vectors.',
      '              Without --force, products that already have a CLIP',
      '              embedding are skipped (resumable).',
      '',
      'environment (required):',
      '  SUPABASE_URL               e.g. https://<ref>.supabase.co',
      '  SUPABASE_SERVICE_ROLE_KEY  service-role key (never print it)',
    ].join('\n')
  );
  process.exit(1);
}

function parseArgs(argv) {
  const args = { dryRun: false, force: false, limit: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--force') args.force = true;
    else if (arg === '--limit') {
      const raw = argv[++i];
      const n = Number(raw);
      if (!Number.isInteger(n) || n <= 0) {
        usageError(`--limit needs a positive integer, got ${JSON.stringify(raw)}.`);
      }
      args.limit = n;
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        [
          'Local CLIP embedding pass for SmartBuy AI visual search.',
          '',
          'Embeds each catalog product (name + brand + description) with',
          `the local CLIP text encoder (${CLIP_MODEL_ID}) and upserts the`,
          '512-dim vectors into product_clip_embeddings.',
          '',
          'Run --dry-run first to validate setup without downloading the model.',
        ].join('\n')
      );
      process.exit(0);
    } else {
      usageError(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

/**
 * Catalog text embedded for a product: name + brand + description.
 * MUST stay identical to productEmbeddingText() in
 * services/visual-search.ts — same parts, same order, same
 * separator. Empty parts are skipped, never replaced with guesses.
 */
function productEmbeddingText(input) {
  return [input.name, input.brand, input.description]
    .map((part) => (part ?? '').trim())
    .filter((part) => part !== '')
    .join(' — ');
}

function isMissingTableError(error) {
  if (!error) return false;
  return error.code === '42P01' || error.code === 'PGRST205';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    usageError(
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set in the local environment.'
    );
  }
  try {
    // Validate the URL shape without ever printing it in full.
    const parsed = new URL(supabaseUrl);
    if (parsed.protocol !== 'https:') {
      usageError('SUPABASE_URL must be an https:// URL.');
    }
  } catch {
    usageError('SUPABASE_URL is not a valid URL.');
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Load the catalog (text only — no photos involved anywhere).
  const { data: products, error: productsError } = await supabase
    .from('products')
    .select('id, slug, name, brand, description')
    .is('deleted_at', null)
    .order('name', { ascending: true });
  if (productsError) {
    console.error(`error: could not load the catalog: ${productsError.message}`);
    process.exit(1);
  }
  const catalog = products ?? [];

  // Which products already have a CLIP embedding?
  const { data: existing, error: existingError } = await supabase
    .from('product_clip_embeddings')
    .select('product_id');
  if (existingError) {
    if (isMissingTableError(existingError)) {
      console.error(
        'error: product_clip_embeddings table is not set up yet. ' +
          'Run supabase/add-clip-embeddings.sql in the Supabase SQL Editor first (see docs/visual-search.md).'
      );
      process.exit(1);
    }
    console.error(`error: could not check existing CLIP embeddings: ${existingError.message}`);
    process.exit(1);
  }
  const embeddedIds = new Set((existing ?? []).map((row) => row.product_id));

  const todoAll = args.force ? catalog : catalog.filter((p) => !embeddedIds.has(p.id));
  const alreadyEmbedded = catalog.length - todoAll.length;
  const todo = args.limit !== null ? todoAll.slice(0, args.limit) : todoAll;

  if (args.dryRun) {
    console.log('dry-run: setup OK — no model will be downloaded, nothing will be written.');
    console.log(`  catalog products:        ${catalog.length}`);
    console.log(`  already CLIP-embedded:   ${alreadyEmbedded}`);
    console.log(`  would embed now:         ${todo.length}${args.limit !== null ? ` (limited to ${args.limit})` : ''}`);
    console.log(`  model (first run only):  ${CLIP_MODEL_ID} (text encoder only, ~150-250 MB download, cached in ~/.cache/huggingface/hub)`);
    console.log('  re-run without --dry-run to embed.');
    process.exit(0);
  }

  // Load the local CLIP text encoder. Dynamic import so --dry-run
  // never touches the ML stack. First run downloads the model once
  // into the Hugging Face cache; later runs reuse it offline.
  console.log(`loading local CLIP text encoder (${CLIP_MODEL_ID}) — first run downloads the model once...`);
  let tokenizer;
  let textModel;
  try {
    const transformers = await import('@huggingface/transformers');
    tokenizer = await transformers.AutoTokenizer.from_pretrained(CLIP_MODEL_ID);
    textModel = await transformers.CLIPTextModelWithProjection.from_pretrained(CLIP_MODEL_ID);
  } catch (err) {
    console.error(`error: could not load the local CLIP model: ${String(err)}`);
    console.error('Check your network (first run downloads the model) and that @huggingface/transformers is installed.');
    process.exit(1);
  }

  let embedded = 0;
  const failed = [];

  for (const product of todo) {
    const text = productEmbeddingText({
      name: product.name,
      brand: product.brand,
      description: product.description,
    });
    try {
      const inputs = tokenizer([text], { padding: true, truncation: true });
      const { text_embeds } = await textModel(inputs);
      const vector = text_embeds.tolist()[0];
      if (
        !Array.isArray(vector) ||
        vector.length !== CLIP_EMBEDDING_DIMS ||
        !vector.every((n) => typeof n === 'number' && Number.isFinite(n))
      ) {
        throw new Error(`unexpected embedding shape (expected ${CLIP_EMBEDDING_DIMS} finite numbers)`);
      }
      const { error: upsertError } = await supabase
        .from('product_clip_embeddings')
        .upsert(
          {
            product_id: product.id,
            embedding: vector,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'product_id' }
        );
      if (upsertError) {
        if (isMissingTableError(upsertError)) {
          console.error(
            'error: product_clip_embeddings table is not set up yet. ' +
              'Run supabase/add-clip-embeddings.sql in the Supabase SQL Editor first (see docs/visual-search.md).'
          );
          process.exit(1);
        }
        throw new Error(`could not store the embedding: ${upsertError.message}`);
      }
      embedded++;
      console.log(`  embedded ${product.slug} (${embedded}/${todo.length})`);
    } catch (err) {
      failed.push({ slug: product.slug, error: String(err) });
      console.error(`  failed ${product.slug}: ${String(err)}`);
    }
  }

  console.log(
    JSON.stringify({ total: catalog.length, alreadyEmbedded, embedded, failed }, null, 2)
  );
  if (failed.length > 0) {
    console.error(`${failed.length} product(s) failed — re-run to retry only the ones still missing an embedding.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`error: ${String(err)}`);
  process.exit(1);
});
