-- =====================================================================
-- SmartBuy AI — CLIP vector store for visual search (local embeddings)
-- OWNER STEP: run once in the Supabase SQL Editor (Ctrl+A, then Run).
-- Until this runs, POST /api/v1/visual-search keeps using the MiniLM
-- path — it never invents a CLIP match.
-- =====================================================================
-- WHAT THIS ADDS
-- - A SECOND embedding table, product_clip_embeddings, holding ONE
--   512-dimensional CLIP text embedding per catalog product
--   (CLIP text encoder output, 512 dims).
-- - match_clip_products(): cosine-similarity search over those
--   embeddings.
--
-- WHY A SEPARATE TABLE (read before merging anything):
-- CLIP text embeddings are 512-dimensional; the existing
-- product_embeddings table is vector(384) for MiniLM. The two
-- embedding spaces are NOT comparable — a 512-dim CLIP vector must
-- NEVER be written into the 384-dim table (Postgres would reject
-- the insert) and must never be compared against a MiniLM vector.
-- The two tables live side by side; the route consults the CLIP
-- table when it has rows and falls back to MiniLM otherwise.
--
-- HOW THE CLIP VECTORS GET HERE
-- They are generated OFFLINE on a developer machine by
-- scripts/embed-products-local.mjs (local CLIP model via
-- @huggingface/transformers, zero API calls) and upserted with the
-- service-role key. The serverless route NEVER runs the CLIP model:
-- the model (~150-250 MB text encoder alone) cannot load inside a
-- Vercel Hobby function (10s timeout, 250 MB function limit).
-- The route only embeds the caption TEXT via the Hugging Face
-- Inference API and matches it against these stored vectors.
--
-- PRIVACY / HONESTY, BY DESIGN
-- - Embeddings are computed from the catalog's own name + brand +
--   description text only (same productEmbeddingText shape as the
--   MiniLM path). No user photo is ever stored here, and no
--   uploaded photo is ever sent to any embedding service.
-- - No anon policy is created on purpose: reads/writes go through
--   the service-role client in the API routes / local script, so a
--   public write policy (a spam vector) is never needed. RLS is
--   enabled with no policies, so the anon key sees nothing.
-- - No vector index (IVFFlat) at this scale: the catalog is ~11
--   products, so an exact scan is instant. Add an IVFFlat index
--   only if the catalog grows past ~10k embedded rows.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS product_clip_embeddings (
  product_id uuid PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  embedding vector(512) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- RLS on, no policies: only the service-role client (API routes /
-- local embedding script) can read/write this table. Service role
-- bypasses RLS by design.
ALTER TABLE product_clip_embeddings ENABLE ROW LEVEL SECURITY;

-- Cosine-similarity match. Returns product_id + similarity (1 =
-- identical direction, 0 = unrelated), best first. match_count is
-- clamped to 1..50 so a caller can never ask for an unbounded scan.
CREATE OR REPLACE FUNCTION match_clip_products(
  query_embedding vector(512),
  match_count int
)
RETURNS TABLE (product_id uuid, similarity double precision)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    pe.product_id,
    (1 - (pe.embedding <=> query_embedding))::double precision AS similarity
  FROM product_clip_embeddings pe
  ORDER BY pe.embedding <=> query_embedding
  LIMIT LEAST(GREATEST(match_count, 1), 50);
END;
$$;

-- The API route calls this RPC through the service-role client.
GRANT EXECUTE ON FUNCTION match_clip_products(vector(512), int) TO service_role;

-- Reload the PostgREST schema cache so the new table/function are
-- visible to the API immediately (otherwise PGRST205).
NOTIFY pgrst, 'reload schema';

-- Verify (the SQL editor shows only this last result):
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'product_clip_embeddings'
ORDER BY ordinal_position;
