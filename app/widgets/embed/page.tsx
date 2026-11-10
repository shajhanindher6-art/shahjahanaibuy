/**
 * Embeddable widget renderer — /widgets/embed?slug=…&type=price|history&theme=light|dark
 *
 * Renders a minimal, chromeless widget for third-party `<iframe>`
 * embeds (see lib/widgets.ts for the copy-paste codes and
 * /widgets for the docs). Reads live data from the PUBLIC API
 * (S4#18, wave 2 switch): GET /api/v1/public/products/<slug>
 * (latest recorded price) and GET /api/v1/public/prices?slug=…
 * (recorded history). The public API returns recorded prices with
 * no per-merchant offers, so the widget's "best price" is the
 * latest recorded price and carries no merchant attribution.
 *
 * HONESTY: every fetch is try/catch — a failed or empty read renders
 * an honest "unavailable / not enough history" state, never an
 * invented price. Seed prices are demo prices; the widget shows
 * them only as the recorded merchant prices they are, with the
 * same "recorded price" framing as the product page.
 */

import type { CSSProperties } from 'react';
import { headers } from 'next/headers';
import Link from 'next/link';
import { EmbedClickTracker } from './embed-tracker';
import { summarizePriceHistory, validateWidgetConfig, type PricePoint } from '@/lib/widgets';

export const dynamic = 'force-dynamic';

interface ExtensionOffer {
  merchant: string | null;
  price: number;
  compareAtPrice: number | null;
  url: string | null;
  inStock: boolean;
}

interface PriceHistoryPoint {
  price: number;
  recordedAt: string;
}

async function fetchJson(origin: string, path: string): Promise<unknown | null> {
  try {
    const res = await fetch(`${origin}${path}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

function sparklinePoints(points: PricePoint[], width: number, height: number): string {
  if (points.length < 2) return '';
  const prices = points.map((p) => p.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1;
  return points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * width;
      const y = height - 4 - ((p.price - min) / span) * (height - 8);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

export default async function WidgetEmbedPage({
  searchParams,
}: {
  searchParams: { slug?: string; type?: string; theme?: string };
}) {
  const validated = validateWidgetConfig(searchParams);
  const dark = !('errors' in validated) && validated.config.theme === 'dark';

  const wrapStyle: CSSProperties = {
    fontFamily: 'system-ui, -apple-system, sans-serif',
    background: dark ? '#0f172a' : '#ffffff',
    color: dark ? '#f1f5f9' : '#0f172a',
    borderRadius: 12,
    padding: 16,
    width: '100%',
    minHeight: 120,
    boxSizing: 'border-box',
  };
  const muted: CSSProperties = { color: dark ? '#94a3b8' : '#64748b', fontSize: 12 };
  const linkStyle: CSSProperties = { color: '#2563eb', fontWeight: 600, fontSize: 13, textDecoration: 'none' };

  if ('errors' in validated) {
    return (
      <div style={wrapStyle}>
        <p style={{ fontSize: 13, margin: 0 }}>SmartBuy price widget unavailable — {validated.errors[0]}.</p>
        <p style={{ ...muted, marginTop: 8 }}>Use a real catalog product slug, e.g. macbook-air-13.</p>
      </div>
    );
  }

  const { slug, type } = validated.config;
  const headerList = headers();
  const host = headerList.get('x-forwarded-host') ?? headerList.get('host') ?? '';
  const proto = headerList.get('x-forwarded-proto') ?? 'https';
  const origin = host ? `${proto}://${host}` : '';

  let best: ExtensionOffer | null = null;
  let productName: string | null = null;
  let historyPoints: PricePoint[] = [];
  if (origin) {
    // Public API (S4#18): one product read gives the name + the
    // latest recorded price (the widget's "best price"); the
    // history read gives the recorded points. No merchant
    // attribution exists in the public API, so merchant/compare-at
    // are null — the widget says "Best recorded price" and shows
    // no retailer name, instead of guessing one.
    const productJson = (await fetchJson(
      origin,
      `/api/v1/public/products/${encodeURIComponent(slug)}`
    )) as {
      success?: boolean;
      data?: {
        name?: string;
        latestRecordedPrice?: { price?: number; recordedAt?: string } | null;
      };
    } | null;
    const latest = productJson?.data?.latestRecordedPrice ?? null;
    if (latest && typeof latest.price === 'number' && latest.price > 0) {
      best = {
        merchant: null,
        price: latest.price,
        compareAtPrice: null,
        url: null,
        inStock: true,
      };
    }
    productName = productJson?.data?.name ?? null;

    if (type === 'history') {
      const pricesJson = (await fetchJson(
        origin,
        `/api/v1/public/prices?slug=${encodeURIComponent(slug)}&limit=30`
      )) as { success?: boolean; data?: { prices?: PriceHistoryPoint[] } } | null;
      const rows = Array.isArray(pricesJson?.data?.prices) ? (pricesJson?.data?.prices as PriceHistoryPoint[]) : [];
      historyPoints = rows
        .filter((r) => Number.isFinite(Number(r.price)) && Number(r.price) > 0)
        .map((r) => ({ price: Number(r.price), recordedAt: r.recordedAt }))
        .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
    }
  }

  const productUrl = `/products/${slug}`;
  const summary = summarizePriceHistory(historyPoints);

  return (
    <EmbedClickTracker slug={slug}>
      <div style={wrapStyle}>
        <p style={{ fontSize: 13, fontWeight: 700, margin: '0 0 4px' }}>
          {productName ?? slug}
        </p>
        {type === 'price' ? (
          best ? (
            <>
              <p style={{ fontSize: 22, fontWeight: 800, margin: '4px 0' }}>
                ${best.price.toFixed(2)}
                {best.compareAtPrice !== null && best.compareAtPrice > best.price ? (
                  <span style={{ ...muted, textDecoration: 'line-through', marginLeft: 8 }}>
                    ${best.compareAtPrice.toFixed(2)}
                  </span>
                ) : null}
              </p>
              <p style={{ ...muted, margin: '0 0 10px' }}>
                Best recorded price{best.merchant ? ` at ${best.merchant}` : ''} · SmartBuy AI
              </p>
            </>
          ) : (
            <p style={{ ...muted, margin: '8px 0 10px' }}>
              No recorded price right now — check the product page for the latest.
            </p>
          )
        ) : summary.hasEnoughHistory ? (
          <>
            <svg width="100%" height="64" viewBox="0 0 288 64" preserveAspectRatio="none" role="img" aria-label="Recorded price history chart">
              <polyline
                points={sparklinePoints(historyPoints, 288, 64)}
                fill="none"
                stroke="#2563eb"
                strokeWidth="2"
              />
            </svg>
            <p style={{ fontSize: 13, margin: '6px 0 0' }}>
              ${summary.current?.toFixed(2)} now · lowest ${summary.lowest?.toFixed(2)} · highest $
              {summary.highest?.toFixed(2)}
            </p>
            <p style={{ ...muted, margin: '4px 0 10px' }}>
              {summary.points} recorded prices · SmartBuy AI
            </p>
          </>
        ) : (
          <p style={{ ...muted, margin: '8px 0 10px' }}>
            Not enough price history yet — this product needs at least 2 recorded prices.
          </p>
        )}
        <Link href={productUrl} target="_blank" rel="noopener noreferrer" style={linkStyle}>
          View on SmartBuy AI →
        </Link>
      </div>
    </EmbedClickTracker>
  );
}
