import { createSupabaseServerClient } from '@/lib/supabase/server';
import { appConfig } from '@/lib/config/app';
import { getCachedRankedDeals } from '@/services/ai-deals';

export const dynamic = 'force-dynamic';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * RSS 2.0 feed for SmartBuy deals — the AI-ranked deals from
 * GET /api/v1/deals/ranked (top 50), newest ranking first. Served
 * at /deals/rss.xml and linked from the deals page. Same shape as
 * the blog RSS at /rss.xml (app/rss.xml/route.ts).
 *
 * Honest empty state: when there are no ranked deals (or the
 * database is unreachable) the feed is still valid RSS with zero
 * items — never a 500 and never an invented deal. Item links point
 * at the SmartBuy product page when the deal has a product,
 * otherwise at the deal's own retailer URL, otherwise /deals.
 */
export async function GET() {
  let items = '';
  try {
    const supabase = await createSupabaseServerClient();
    const result = await getCachedRankedDeals(supabase, { limit: 50 });
    items = result.deals
      .map((ranked) => {
        const title =
          ranked.deal?.title ?? ranked.product?.name ?? 'SmartBuy deal';
        const link = ranked.product
          ? `${appConfig.url}/products/${ranked.product.slug}`
          : ranked.deal?.url ?? `${appConfig.url}/deals`;
        const guid = ranked.deal?.id ?? ranked.id;
        const pubDate = new Date(
          ranked.rankedAt || ranked.deal?.startAt || Date.now()
        ).toUTCString();
        const descriptionParts = [
          ranked.deal?.description ?? null,
          ranked.discountPercentage !== null && ranked.discountPercentage > 0
            ? `${ranked.discountPercentage}% off vs list price`
            : null,
          ranked.savingsAmount > 0
            ? `Save $${ranked.savingsAmount.toFixed(2)}`
            : null,
          ranked.currentPrice !== null && ranked.currentPrice !== undefined
            ? `Current recorded price $${ranked.currentPrice.toFixed(2)}`
            : 'Price not listed',
        ].filter(Boolean);
        return `
    <item>
      <title>${escapeXml(title)}</title>
      <link>${escapeXml(link)}</link>
      <guid>${escapeXml(guid)}</guid>
      <pubDate>${pubDate}</pubDate>
      <description>${escapeXml(descriptionParts.join(' — '))}</description>
    </item>`;
      })
      .join('');
  } catch {
    // Empty channel below — see the header comment.
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeXml(appConfig.name)} Deals</title>
    <link>${appConfig.url}/deals</link>
    <description>AI-ranked deals, flash sales, coupons, and hidden discounts from SmartBuy AI. Prices are recorded prices from our catalog, not live retailer prices.</description>
    <language>en</language>${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  });
}
