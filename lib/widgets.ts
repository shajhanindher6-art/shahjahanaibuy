/**
 * Embeddable price widgets — S5#9 (pure helpers, no I/O).
 *
 * A widget is a copy-paste `<iframe>` that renders one catalog
 * product's price (or price history) on a third-party page, e.g. a
 * blogger's "best laptop 2026" post. The embed page itself
 * (app/widgets/embed) reads live data from the EXISTING public
 * routes — /api/v1/extension/price for the best price and
 * /api/v1/products/[slug]/prices for history — because the S4#18
 * public API does not exist yet. Wave 2: when that API lands, the
 * embed page switches to it (one fetch, API-key/rate-limit aware)
 * and these helpers gain an `apiKey` option; nothing here assumes
 * it already exists.
 *
 * HONESTY RULES:
 * - The slug must be a real catalog slug (lowercase letters,
 *   digits, hyphens). An unknown slug renders the embed's honest
 *   "Product not found" state — never a guessed product.
 * - Prices are the recorded merchant prices from the API, never
 *   invented here. No price is ever defaulted or rounded into a
 *   fake "deal".
 * - Click reporting reuses the affiliate geo-click beacon pattern
 *   (lib/affiliate-beacon.ts → POST /api/v1/affiliate/geo-click):
 *   only product slug + target URL are reported, never a visitor
 *   id, IP, or the embedding page's URL. The beacon is fire-and-
 *   forget and never blocks navigation.
 */

export const WIDGET_BASE_URL = 'https://shahjahanaibuy-b1zp.vercel.app';

export type WidgetType = 'price' | 'history';
export type WidgetTheme = 'light' | 'dark';

export interface WidgetConfig {
  slug: string;
  type: WidgetType;
  theme: WidgetTheme;
}

export const WIDGET_TYPES: WidgetType[] = ['price', 'history'];
export const WIDGET_THEMES: WidgetTheme[] = ['light', 'dark'];

/** Iframe size per widget type (fixed heights keep embeds stable). */
export const WIDGET_DIMENSIONS: Record<WidgetType, { width: number; height: number }> = {
  price: { width: 320, height: 180 },
  history: { width: 320, height: 260 },
};

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidWidgetSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug);
}

/**
 * Validate raw embed parameters (e.g. from a query string) into a
 * WidgetConfig, or return the list of problems. Unknown type/theme
 * fall back to the defaults instead of failing — only a missing or
 * malformed slug is a hard error, because the widget cannot render
 * without a real product.
 */
export function validateWidgetConfig(input: {
  slug?: unknown;
  type?: unknown;
  theme?: unknown;
}): { config: WidgetConfig } | { errors: string[] } {
  const slug = typeof input.slug === 'string' ? input.slug.trim().toLowerCase() : '';
  if (!slug) return { errors: ['slug is required'] };
  if (!isValidWidgetSlug(slug)) {
    return { errors: ['slug must be lowercase letters, digits, and hyphens only'] };
  }
  const type: WidgetType = input.type === 'history' ? 'history' : 'price';
  const theme: WidgetTheme = input.theme === 'dark' ? 'dark' : 'light';
  return { config: { slug, type, theme } };
}

/** Canonical embed URL for a widget config. */
export function buildWidgetUrl(config: WidgetConfig, baseUrl: string = WIDGET_BASE_URL): string {
  const params = new URLSearchParams({
    slug: config.slug,
    type: config.type,
    theme: config.theme,
  });
  return `${baseUrl.replace(/\/$/, '')}/widgets/embed?${params.toString()}`;
}

/** Copy-paste `<iframe>` snippet for a widget config. */
export function buildWidgetEmbedCode(config: WidgetConfig, baseUrl: string = WIDGET_BASE_URL): string {
  const url = buildWidgetUrl(config, baseUrl);
  const { width, height } = WIDGET_DIMENSIONS[config.type];
  return (
    `<iframe src="${url}" width="${width}" height="${height}" ` +
    `style="border:0;border-radius:12px;overflow:hidden" loading="lazy" ` +
    `title="SmartBuy AI price widget — ${config.slug}"></iframe>`
  );
}

export interface PricePoint {
  price: number;
  recordedAt: string;
}

/**
 * Summarize real recorded price points (from
 * /api/v1/products/[slug]/prices). Returns nulls — never invented
 * values — when there are no points, and an explicit
 * `hasEnoughHistory` flag (< 2 points = "Not enough history yet").
 */
export function summarizePriceHistory(points: PricePoint[]): {
  lowest: number | null;
  highest: number | null;
  current: number | null;
  previous: number | null;
  change: number | null;
  points: number;
  hasEnoughHistory: boolean;
} {
  const valid = points.filter((p) => Number.isFinite(p.price) && p.price > 0);
  if (valid.length === 0) {
    return {
      lowest: null,
      highest: null,
      current: null,
      previous: null,
      change: null,
      points: 0,
      hasEnoughHistory: false,
    };
  }
  const prices = valid.map((p) => p.price);
  const current = prices[prices.length - 1] as number;
  const previous = prices.length >= 2 ? (prices[prices.length - 2] as number) : null;
  return {
    lowest: Math.min(...prices),
    highest: Math.max(...prices),
    current,
    previous,
    change: previous !== null ? current - previous : null,
    points: valid.length,
    hasEnoughHistory: valid.length >= 2,
  };
}

export interface WidgetClickPayload {
  productSlug: string;
  targetUrl: string;
  merchantName: string;
}

/**
 * Build the click-reporting payload for a widget outbound click.
 * Same shape the site beacon sends to /api/v1/affiliate/geo-click
 * (see lib/affiliate-beacon.ts): product slug + merchant URL only.
 * The embedding page's own URL is never included — the widget must
 * not leak where it is embedded.
 */
export function buildWidgetClickPayload(input: {
  slug: string;
  targetUrl: string;
}): WidgetClickPayload | null {
  const slug = input.slug.trim().toLowerCase();
  const targetUrl = input.targetUrl.trim();
  if (!isValidWidgetSlug(slug) || !targetUrl) return null;
  try {
    const parsed = new URL(targetUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  } catch {
    return null;
  }
  return { productSlug: slug, targetUrl, merchantName: 'SmartBuy widget' };
}
