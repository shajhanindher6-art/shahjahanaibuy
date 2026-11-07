import { ImageResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * Per-product Open Graph image (1200×630), generated at runtime.
 *
 * Shows the real product name (and the lowest recorded merchant
 * price when one exists) from the live catalog. If the product
 * cannot be loaded — unknown slug, database unreachable, env vars
 * missing — it falls back to the brand image instead of failing,
 * so a shared link never gets a broken preview.
 *
 * NOTE: the product page itself is a client component, so it cannot
 * set per-product metadata yet; this route is served at
 * /products/[slug]/opengraph-image and is picked up automatically
 * once the page gains server metadata.
 */
export const alt = 'SmartBuy AI product';
export const contentType = 'image/png';

async function loadProduct(slug: string): Promise<{
  name: string;
  brand: string | null;
  lowestPrice: number | null;
} | null> {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return null;
    const supabase = createClient(url, key);

    const { data: product } = await supabase
      .from('products')
      .select('id, name, brand')
      .eq('slug', slug)
      .is('deleted_at', null)
      .single();
    if (!product) return null;

    const { data: cheapest } = await supabase
      .from('merchant_products')
      .select('price')
      .eq('product_id', (product as { id: string }).id)
      .is('deleted_at', null)
      .order('price', { ascending: true })
      .limit(1);
    const row = (cheapest as { price: number }[] | null)?.[0];

    return {
      name: (product as { name: string }).name,
      brand: (product as { brand: string | null }).brand ?? null,
      lowestPrice: typeof row?.price === 'number' ? row.price : null,
    };
  } catch {
    return null;
  }
}

export default async function Image({ params }: { params: { slug: string } }) {
  const product = await loadProduct(params.slug);

  const title = product ? product.name : 'SmartBuy AI';
  const subtitle = product
    ? [
        product.brand,
        product.lowestPrice !== null
          ? `Lowest recorded price $${product.lowestPrice.toFixed(2)}`
          : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : 'AI-Powered Shopping Intelligence';

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '80px',
          background:
            'linear-gradient(135deg, #0f172a 0%, #1e3a8a 60%, #6d28d9 100%)',
          color: '#ffffff',
          fontFamily: 'sans-serif',
        }}
      >
        <div
          style={{
            fontSize: 28,
            letterSpacing: 6,
            color: '#93c5fd',
            marginBottom: 16,
          }}
        >
          SMARTBUY AI
        </div>
        <div style={{ fontSize: 64, fontWeight: 800, lineHeight: 1.15 }}>
          {title}
        </div>
        <div style={{ fontSize: 30, color: '#dbeafe', marginTop: 24 }}>
          {subtitle}
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
