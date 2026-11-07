# Visual Search — Vector Upgrade (Delta 1)

Match a photo against SmartBuy's own catalog by **vector similarity**,
not by keywords: a public image URL is captioned (BLIP), the caption
is embedded (all-MiniLM-L6-v2, 384 dims), and `match_products()` in
Supabase (pgvector) returns catalog products by cosine similarity.

**Status: dormant until the owner completes the steps below.** With
nothing configured, `POST /api/v1/visual-search` answers 503 and the
backfill route refuses — it never invents a match.

## What already exists

- `/scan` (Option 6) is unchanged: uploaded/captured photos NEVER
  leave the browser and are NEVER stored. That rule is absolute and
  this upgrade does not touch it.
- `POST /api/v1/scan` (SerpAPI Lens visual match) is unchanged.
- This upgrade only adds a second path: `POST /api/v1/visual-search`.

## Owner setup (3 steps)

### 1. Free Hugging Face account + token

1. Create a free account at https://huggingface.co (no card needed).
2. Create a token at https://huggingface.co/settings/tokens
   (type: **Read** is enough).
3. In Vercel → project `shahjahanaibuy-b1zp` → Settings →
   Environment Variables, add `HF_API_TOKEN` = the token
   (Production scope), then redeploy.
4. Free-tier note: the Inference API is rate-limited and models can
   take ~10–20s to load on first use (cold start). The route answers
   503 "model is still loading" in that case — retry, never a fake
   result.

### 2. Run the SQL in Supabase (once)

In the Supabase dashboard → SQL Editor, open
`supabase/add-visual-embeddings.sql`, press **Ctrl+A** (select all),
then **Run**. It:

- enables the `pgvector` extension (free on Supabase),
- creates `product_embeddings` (one 384-dim vector per product),
- creates `match_products(query_embedding, match_count)` — cosine
  similarity search, best first,
- ends with a verifying `SELECT` of the new table's columns.

Verify it worked: the last result should list `product_id`,
`embedding`, `updated_at`. If you see an error instead, do not
proceed — the routes will keep answering 503 until this runs.

### 3. Backfill the catalog (once, admin only)

Sign in as an admin and call once:

```bash
curl -X POST https://shahjahanaibuy-b1zp.vercel.app/api/v1/admin/visual-search-backfill \
  -H "Cookie: <your admin session cookie>" \
  -H "Content-Type: application/json" \
  -d '{}'
```

(or call it from any HTTP client while signed in as admin in the
browser). It embeds each product's name + brand + description and
upserts the vectors. The response reports
`{ total, alreadyEmbedded, embedded, failed }`.

- **Resumable:** without `force`, products that already have an
  embedding are skipped. If the call is cut short (free-tier
  function timeout), just call it again to finish the rest.
- **Re-embed everything:** send `{ "force": true }`.
- **After adding a new product** to the catalog, call the backfill
  again — new products are embedded, existing ones are skipped.

## Using it

```bash
curl -X POST https://shahjahanaibuy-b1zp.vercel.app/api/v1/visual-search \
  -H "Content-Type: application/json" \
  -d '{"imageUrl": "https://example.com/photo-of-a-laptop.jpg", "limit": 5}'
```

Or caption text only:

```bash
curl -X POST https://shahjahanaibuy-b1zp.vercel.app/api/v1/visual-search \
  -H "Content-Type: application/json" \
  -d '{"caption": "silver laptop with black keyboard", "limit": 5}'
```

Success response (200):

```json
{
  "success": true,
  "data": [
    {
      "id": "3aa8470f-...",
      "slug": "macbook-air-13",
      "name": "MacBook Air 13",
      "brand": "Apple",
      "similarity": 0.812,
      "lowestPriceUsd": 999
    }
  ],
  "meta": { "mode": "vector", "caption": "a silver laptop on a desk", "note": "..." }
}
```

- `similarity` is cosine similarity (1 = closest), computed by the
  database — never invented. `lowestPriceUsd` is the lowest recorded
  merchant price, or `null` when none exists.
- Each match links to `/products/[slug]` on the site.
- Honest empty state: if the catalog has no embeddings yet, the
  response is `200` with `[]` and a note saying the backfill is
  still needed.

## Honest limits

- The caption describes what BLIP sees; a wrong caption gives a
  wrong match. The route returns the caption in `meta` so the
  caller can see what was actually matched on.
- Embeddings are only as good as the catalog text (name + brand +
  description). Products with thin descriptions match less well.
- No photo is ever uploaded, stored, or embedded — only public
  image URLs (fetched server-side for captioning) or typed text.
- The free Hugging Face tier is rate-limited; the route is capped
  at 10 requests/minute per IP.
