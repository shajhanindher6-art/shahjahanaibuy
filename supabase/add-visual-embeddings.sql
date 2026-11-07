-- =====================================================================
-- SmartBuy AI — Visual-search vector store (Delta 1: vector upgrade)
-- OWNER STEP: run once in the Supabase SQL Editor (Ctrl+A, then Run).
-- Until this runs, POST /api/v1/visual-search answers 503
-- ("embeddings not set up yet") — it never invents a match.
-- =====================================================================
-- WHAT THIS ADDS
-- - pgvector extension (free on Supabase) + a product_embeddings
--   table holding ONE 384-dimensional embedding per catalog product
--   (sentence-transformers/all-MiniLM-L6-v2 output, 384 dims).
-- - match_products(): cosine-similarity search over those embeddings.
--
-- PRIVACY / HONESTY, BY DESIGN
-- - Embeddings are computed from the catalog's own name + brand +
--   description text only. No user photo is ever stored here, and no
--   uploaded photo is ever sent to any embedding service: the
--   visual-search route only ever captions a user-pasted PUBLIC
--   image URL (or accepts user-typed caption text).
-- - No anon policy is created on purpose: reads/writes go through
--   the service-role client in the API routes, so a public write
--   policy (a spam vector) is never needed. RLS is enabled with no
--   policies, so the anon key sees nothing.
-- - No vector index (IVFFlat) at this scale: the catalog is ~11
--   products, so an exact scan is instant. Add an IVFFlat index
--   only if the catalog grows past ~10k embedded rows.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS product_embeddings (
  product_id uuid PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  embedding vector(384) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- RLS on, no policies: only the service-role client (API routes)
-- can read/write this table. Service role bypasses RLS by design.
ALTER TABLE product_embeddings ENABLE ROW LEVEL SECURITY;

-- Cosine-similarity match. Returns product_id + similarity (1 =
-- identical direction, 0 = unrelated), best first. match_count is
-- clamped to 1..50 so a caller can never ask for an unbounded scan.
CREATE OR REPLACE FUNCTION match_products(
  query_embedding vector(384),
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
  FROM product_embeddings pe
  ORDER BY pe.embedding <=> query_embedding
  LIMIT LEAST(GREATEST(match_count, 1), 50);
END;
$$;

-- The API routes call this RPC through the service-role client.
GRANT EXECUTE ON FUNCTION match_products(vector(384), int) TO service_role;

-- Reload the PostgREST schema cache so the new table/function are
-- visible to the API immediately (otherwise PGRST205).
NOTIFY pgrst, 'reload schema';

-- Verify (the SQL editor shows only this last result):
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'product_embeddings'
ORDER BY ordinal_position;
