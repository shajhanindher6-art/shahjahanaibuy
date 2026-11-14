/**
 * ToolIntegrationService — the single cross-tool integration service
 * (Master Tool Integration, Stage 1; audit items B-01, B-02, B-04).
 *
 * This is the ONE genuine gap the audit found (MASTER_INTEGRATION_AUDIT.md
 * F3): every other suggested service already exists as live code. This
 * file therefore creates nothing parallel — it is a thin facade that
 * DELEGATES to existing services and only adds what no file owns:
 *
 *   (a) the shared product-selection param schema — one parser
 *       (`parseToolParams`) plus one builder (`buildToolUrl`) with the
 *       per-tool dialect translation inside;
 *   (b) cached product fetch — delegates to the existing cached twins
 *       and adds a cached `getProducts` LIST variant (wrapping the
 *       existing uncached `getProducts` via `swrGet`; the wrapper lives
 *       HERE, not in `services/products.ts`, so Stage 1 touches no file
 *       another Stage 1/2 worker owns);
 *   (c) cross-tool link builders — every link carries the product in
 *       the destination tool's own dialect;
 *   (d) a data-only RelatedTools link-block helper (`relatedToolLinks`)
 *       that Stage 3 will render — no JSX in this service.
 *
 * Param-schema design note: `docs/TOOL_PARAM_SCHEMA.md` (Stage 0,
 * D-04) does NOT exist yet at the time this file was written, so this
 * implementation follows the plan's D-04 description directly
 * (INTEGRATION_IMPLEMENTATION_PLAN.md, Stage 0 D-04): canonical
 * `?product=<slug>`, with translation for `?device=&accessory=`
 * (T10 Compatibility Checker), `?current=&successor=` (T1 Upgrade
 * Advisor) and `/compare ?products=<uuid>,<uuid>`. When the design
 * note lands it should be checked against this file, not the other
 * way round.
 *
 * Honesty rules (standing): a missing product is null, never a
 * guessed slug; an unresolvable /compare UUID is kept in
 * `unresolvedCompareIds`, never invented into a slug; a link builder
 * with no product returns the bare tool route (no empty `?product=`).
 *
 * Delegation map — every function in this file names the existing
 * function it delegates to:
 * - `getToolProduct` → `services/products.ts#getCachedProductBySlug`
 * - `getToolPriceHistory` → `services/price-history.ts#getCachedPriceHistory`
 * - `getToolMerchantProducts` → `services/commerce.ts#getCachedMerchantProducts`
 * - `getCachedProducts` → `services/products.ts#getProducts` (uncached),
 *   wrapped in `lib/cache#swrGet` with `lib/cache#cacheKey`
 * - `resolveCompareProductSlugs` → `services/products.ts#getProductById`
 * - `compareLinkForProduct` → `getToolProduct` (this file) → `getCachedProductBySlug`
 * - `parseAndValidateToolParams` → `parseToolParams` + `getToolProduct`
 *   (this file) — every slug-bearing field checked against the
 *   catalog; unknown slugs are nulled, never carried onward.
 * - param parsing mirrors the per-tool parsers it unifies:
 *   `lib/upgrade-advisor.ts` (`current`/`successor`),
 *   `lib/compatibility-checker.ts` (`device`/`accessory`),
 *   `lib/own-it-check.ts` (`product`/`name`/`brand`/`gtin`),
 *   `lib/energy-cost.ts` (`product` + `watts`/`hours`/`tariff`),
 *   `lib/negotiation-coach.ts` (`product`/`target`/`reason`),
 *   `app/tools/persona-fit/page.tsx` (`persona`/`budget`),
 *   `app/tools/price-match/page.tsx` (`status`).
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { swrGet, cacheKey } from '@/lib/cache';
import type { Product } from '@/types';
import type { MerchantProduct } from '@/types/catalog';
import {
  getCachedProductBySlug,
  getProductById,
  getProducts,
  type ProductListOptions,
  type ProductListResult,
} from '@/services/products';
import {
  getCachedPriceHistory,
  type PriceHistoryOptions,
  type PriceHistoryResult,
} from '@/services/price-history';
import { getCachedMerchantProducts } from '@/services/commerce';

// ---------------------------------------------------------------------------
// Tool routes
// ---------------------------------------------------------------------------

/** The 10 new tools (T1–T10) plus /compare, the comparison destination. */
export type ToolId =
  | 'upgrade-advisor'
  | 'persona-fit'
  | 'price-match'
  | 'own-it-check'
  | 'energy-cost'
  | 'negotiation-coach'
  | 'repairability'
  | 'deal-stacker'
  | 'refurbished-checklist'
  | 'compatibility-checker'
  | 'compare';

/** Canonical route for every tool id. */
export const TOOL_ROUTES: Record<ToolId, string> = {
  'upgrade-advisor': '/tools/upgrade-advisor',
  'persona-fit': '/tools/persona-fit',
  'price-match': '/tools/price-match',
  'own-it-check': '/tools/own-it-check',
  'energy-cost': '/tools/energy-cost',
  'negotiation-coach': '/tools/negotiation-coach',
  repairability: '/tools/repairability',
  'deal-stacker': '/tools/deal-stacker',
  'refurbished-checklist': '/tools/refurbished-checklist',
  'compatibility-checker': '/tools/compatibility-checker',
  compare: '/compare',
};

/** Reverse lookup: a tool route (or compare) back to its id, or null. */
export function toolIdFromRoute(route: string): ToolId | null {
  const entry = (Object.entries(TOOL_ROUTES) as Array<[ToolId, string]>).find(
    ([, path]) => path === route
  );
  return entry ? entry[0] : null;
}

// ---------------------------------------------------------------------------
// Shared product-selection param schema
// ---------------------------------------------------------------------------

/**
 * What `parseToolParams` accepts: a live `URLSearchParams` (client) or
 * the plain-object `searchParams` prop Next.js hands a server page
 * (`{ product?: string | string[] }` — values may repeat).
 */
export type ToolSearchParams =
  | URLSearchParams
  | Record<string, string | string[] | undefined>;

/**
 * The ONE cross-tool selection model. Every dialect translates into
 * this shape; every builder translates out of it.
 *
 * - `productSlug` is the canonical product: `?product=` when present,
 *   else the dialect's primary product (`?device=` on T10,
 *   `?current=` on T1) so a handoff never has to re-ask which product
 *   the user is looking at. The dialect fields below keep the exact
 *   value each tool's own parser reads.
 * - `compareProductIds` are /compare's UUIDs exactly as given;
 *   `compareProductSlugs` / `unresolvedCompareIds` are filled only by
 *   `resolveCompareProductSlugs` / `parseAndResolveToolParams` — a
 *   UUID that cannot be resolved stays in `unresolvedCompareIds`,
 *   never invented into a slug.
 * - The remaining fields are the per-tool extras, kept as the raw
 *   query strings the owning tool validates itself (e.g. T6 validates
 *   `target` as a finite number above $0; this parser does not
 *   re-validate — it only carries).
 */
export interface ToolSelection {
  /** Canonical product slug (`?product=`, else `?device=` / `?current=`). */
  productSlug: string | null;
  /** T10 Compatibility Checker: the device under test (`?device=`). */
  deviceSlug: string | null;
  /** T10 Compatibility Checker: the accessory under test (`?accessory=`). */
  accessorySlug: string | null;
  /** T1 Upgrade Advisor: the device being upgraded from (`?current=`). */
  currentSlug: string | null;
  /** T1 Upgrade Advisor: the candidate successor (`?successor=`). */
  successorSlug: string | null;
  /** /compare: product UUIDs exactly as given in `?products=<uuid>,<uuid>`. */
  compareProductIds: string[];
  /** /compare: UUIDs resolved to slugs (only after a lookup — see below). */
  compareProductSlugs: string[];
  /** /compare: UUIDs no lookup could resolve (kept, never invented). */
  unresolvedCompareIds: string[];
  /** T4 Own-It Guard: typed product name (`?name=`). */
  name: string | null;
  /** T4 Own-It Guard: typed brand (`?brand=`). */
  brand: string | null;
  /** T4 Own-It Guard: typed GTIN (`?gtin=`). */
  gtin: string | null;
  /** T2 Persona Fit Finder: selected persona (`?persona=`). */
  persona: string | null;
  /** T2 Persona Fit Finder: budget (`?budget=`), raw string. */
  budget: string | null;
  /** T6 Negotiation Coach: target price (`?target=`), raw string. */
  target: string | null;
  /** T6 Negotiation Coach: reason, the user's own words (`?reason=`). */
  reason: string | null;
  /** T5 Energy Cost Calculator: watts (`?watts=`), raw string. */
  watts: string | null;
  /** T5 Energy Cost Calculator: hours/day (`?hours=`), raw string. */
  hours: string | null;
  /** T5 Energy Cost Calculator: tariff (`?tariff=`), raw string. */
  tariff: string | null;
  /** T3 Price-Match Finder: status filter (`?status=`). */
  status: string | null;
}

function emptySelection(): ToolSelection {
  return {
    productSlug: null,
    deviceSlug: null,
    accessorySlug: null,
    currentSlug: null,
    successorSlug: null,
    compareProductIds: [],
    compareProductSlugs: [],
    unresolvedCompareIds: [],
    name: null,
    brand: null,
    gtin: null,
    persona: null,
    budget: null,
    target: null,
    reason: null,
    watts: null,
    hours: null,
    tariff: null,
    status: null,
  };
}

/** First value of a possibly-repeated param; blank/whitespace → null. */
function firstParam(
  params: ToolSearchParams,
  key: string
): string | null {
  let raw: string | string[] | undefined | null;
  if (params instanceof URLSearchParams) {
    raw = params.get(key);
  } else {
    raw = params[key];
  }
  if (raw === undefined || raw === null) return null;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Parse ANY tool's query string into the one shared model.
 *
 * Translation table (per-tool dialect → canonical fields):
 * - `?product=` → `productSlug` (T4, T5, T6, T8, T9 and the canonical form)
 * - `?device=` / `?accessory=` → `deviceSlug` / `accessorySlug`
 *   (T10); `deviceSlug` also fills `productSlug` when no `?product=`
 *   is present, so the device is the canonical product.
 * - `?current=` / `?successor=` → `currentSlug` / `successorSlug`
 *   (T1); `currentSlug` also fills `productSlug` when no `?product=`
 *   is present.
 * - `?products=<uuid>,<uuid>` → `compareProductIds` (/compare);
 *   slugs are NOT filled here — resolving UUIDs needs a DB lookup,
 *   see `resolveCompareProductSlugs` / `parseAndResolveToolParams`.
 * - `?name=` / `?brand=` / `?gtin=` → T4 typed-check fields.
 * - `?persona=` / `?budget=` → T2 fields (T2 takes no product param).
 * - `?target=` / `?reason=` → T6 fields.
 * - `?watts=` / `?hours=` / `?tariff=` → T5 fields.
 * - `?status=` → T3 filter field.
 *
 * Unknown keys are ignored. The parser never throws and never
 * invents a value: absent means null / empty.
 */
export function parseToolParams(params: ToolSearchParams): ToolSelection {
  const selection = emptySelection();

  selection.productSlug = firstParam(params, 'product');
  selection.deviceSlug = firstParam(params, 'device');
  selection.accessorySlug = firstParam(params, 'accessory');
  selection.currentSlug = firstParam(params, 'current');
  selection.successorSlug = firstParam(params, 'successor');
  selection.name = firstParam(params, 'name');
  selection.brand = firstParam(params, 'brand');
  selection.gtin = firstParam(params, 'gtin');
  selection.persona = firstParam(params, 'persona');
  selection.budget = firstParam(params, 'budget');
  selection.target = firstParam(params, 'target');
  selection.reason = firstParam(params, 'reason');
  selection.watts = firstParam(params, 'watts');
  selection.hours = firstParam(params, 'hours');
  selection.tariff = firstParam(params, 'tariff');
  selection.status = firstParam(params, 'status');

  const rawCompare = firstParam(params, 'products');
  if (rawCompare !== null) {
    selection.compareProductIds = rawCompare
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id !== '');
  }

  // Canonical product: the explicit ?product= wins; otherwise the
  // dialect's primary product (device, then current device) stands
  // in, so a cross-tool handoff carries exactly one product.
  if (selection.productSlug === null) {
    selection.productSlug = selection.deviceSlug ?? selection.currentSlug;
  }

  return selection;
}

/**
 * Resolve /compare UUIDs to slugs.
 * Delegates to `services/products.ts#getProductById` (one lookup per
 * id — /compare carries at most a handful). A UUID with no product
 * is returned in `unresolved` and kept there: callers must render
 * "could not resolve" for it, never a guessed slug.
 */
export async function resolveCompareProductSlugs(
  supabase: AnySupabaseClient,
  productIds: string[]
): Promise<{ slugs: string[]; unresolved: string[] }> {
  const slugs: string[] = [];
  const unresolved: string[] = [];
  for (const id of productIds) {
    const product = await getProductById(supabase, id);
    if (product) {
      slugs.push(product.slug);
    } else {
      unresolved.push(id);
    }
  }
  return { slugs, unresolved };
}

/**
 * Parse + resolve in one call: `parseToolParams` followed by
 * `resolveCompareProductSlugs` when `?products=` is present. The
 * returned selection has `compareProductSlugs` and
 * `unresolvedCompareIds` filled; when no `?products=` was given
 * both stay empty.
 */
export async function parseAndResolveToolParams(
  supabase: AnySupabaseClient,
  params: ToolSearchParams
): Promise<ToolSelection> {
  const selection = parseToolParams(params);
  if (selection.compareProductIds.length > 0) {
    const { slugs, unresolved } = await resolveCompareProductSlugs(
      supabase,
      selection.compareProductIds
    );
    selection.compareProductSlugs = slugs;
    selection.unresolvedCompareIds = unresolved;
  }
  return selection;
}

/**
 * What `parseAndValidateToolParams` returns: the parsed selection
 * with every unknown slug nulled, the first unknown slug (for the
 * page's honest "unknown product" notice), and the resolved
 * canonical product (for pages that display the selected product).
 */
export interface ValidatedToolSelection {
  /** `parseToolParams` result with every unknown slug nulled. */
  selection: ToolSelection;
  /** First slug from the URL that names no catalog product, or null. */
  unknownSlug: string | null;
  /** The resolved canonical product, or null when there is none. */
  product: Product | null;
}

/**
 * Parse + validate in one call: `parseToolParams`, then check every
 * slug-bearing field (`product`, `device`, `accessory`, `current`,
 * `successor`) against the catalog via `getToolProduct` (the
 * existing cached single-product fetch — no new fetch path, and no
 * fetch at all when the URL carries no slug).
 *
 * A slug that names no catalog product is nulled in the returned
 * selection — so RelatedTools links carry no product param for it
 * (an unknown slug must never bounce tool-to-tool as if valid) —
 * and reported as `unknownSlug`, so the page can show an honest
 * "unknown product" notice instead of silently showing another
 * product. The canonical `productSlug` is re-derived from the
 * VALID slugs only: an explicit `?product=` that is unknown does
 * not fall back to a valid `?device=` / `?current=`.
 */
export async function parseAndValidateToolParams(
  supabase: AnySupabaseClient,
  params: ToolSearchParams
): Promise<ValidatedToolSelection> {
  const selection = parseToolParams(params);
  const explicit = {
    product: firstParam(params, 'product'),
    device: firstParam(params, 'device'),
    accessory: firstParam(params, 'accessory'),
    current: firstParam(params, 'current'),
    successor: firstParam(params, 'successor'),
  } as const;
  const distinct = [
    ...new Set(
      Object.values(explicit).filter((slug): slug is string => slug !== null)
    ),
  ];
  const found = new Map<string, Product | null>();
  await Promise.all(
    distinct.map(async (slug) => {
      found.set(slug, await getToolProduct(supabase, slug));
    })
  );
  const valid = (slug: string | null): string | null =>
    slug !== null && found.get(slug) ? slug : null;
  selection.productSlug =
    valid(explicit.product) ?? valid(explicit.device) ?? valid(explicit.current);
  selection.deviceSlug = valid(explicit.device);
  selection.accessorySlug = valid(explicit.accessory);
  selection.currentSlug = valid(explicit.current);
  selection.successorSlug = valid(explicit.successor);
  let unknownSlug: string | null = null;
  for (const key of ['product', 'device', 'accessory', 'current', 'successor'] as const) {
    const slug = explicit[key];
    if (slug !== null && !found.get(slug)) {
      unknownSlug = slug;
      break;
    }
  }
  const product =
    selection.productSlug !== null
      ? (found.get(selection.productSlug) ?? null)
      : null;
  return { selection, unknownSlug, product };
}

// ---------------------------------------------------------------------------
// URL builder (the inverse of parseToolParams)
// ---------------------------------------------------------------------------

/**
 * Extra query values a builder may carry verbatim alongside the
 * product. Only the keys the destination tool actually reads are
 * emitted (see the per-route allowlist in `buildToolUrl`).
 */
export interface ToolUrlParams extends Partial<ToolSelection> {
  /** Verbatim extras, appended after the translated product params. */
  extra?: Record<string, string | undefined>;
}

/** Per-route extras allowlist: only keys the destination reads. */
const TOOL_URL_EXTRAS: Partial<Record<ToolId, Array<keyof ToolSelection>>> = {
  'own-it-check': ['name', 'brand', 'gtin'],
  'persona-fit': ['persona', 'budget'],
  'negotiation-coach': ['target', 'reason'],
  'energy-cost': ['watts', 'hours', 'tariff'],
  'price-match': ['status'],
};

/**
 * Build a tool URL from the shared model — the inverse of
 * `parseToolParams`. The per-tool translation lives here:
 * - `/tools/compatibility-checker` → `?device=<slug>&accessory=<slug>`
 *   (`device` falls back to `productSlug` when no `deviceSlug` given)
 * - `/tools/upgrade-advisor` → `?current=<slug>&successor=<slug>`
 *   (`current` falls back to `productSlug` when no `currentSlug` given)
 * - `/compare` → `?products=<uuid>,<uuid>` from `compareProductIds`
 *   (a slug alone CANNOT build this URL — /compare resolves UUIDs,
 *   so a slug-only call returns the bare `/compare`; use
 *   `compareLinkForProduct` when only a slug is known)
 * - every other tool → `?product=<slug>`
 * - T2 (`persona-fit`) and T3 (`price-match`) take no product param
 *   for their OWN logic, so `buildToolUrl` never emits `?product=`
 *   for them from `productSlug` — but both pages DO read
 *   `?product=` for transfer (`parseToolParams` → their
 *   RelatedTools pass it onward), so `personaFitLink` /
 *   `priceMatchLink` carry it ONLY when the caller explicitly
 *   passes a product slug (see those builders).
 *
 * Round-trip guarantee: `parseToolParams(new URLSearchParams(
 * buildToolUrl(route, sel).split('?')[1] ?? ''))` returns the same
 * product/dialect fields that were passed in.
 */
export function buildToolUrl(
  toolRoute: string,
  params: ToolUrlParams = {}
): string {
  const toolId = toolIdFromRoute(toolRoute);
  const query = new URLSearchParams();

  const setIf = (key: string, value: string | null | undefined): void => {
    if (value !== null && value !== undefined && value !== '') {
      query.set(key, value);
    }
  };

  if (toolId === 'compatibility-checker') {
    setIf('device', params.deviceSlug ?? params.productSlug);
    setIf('accessory', params.accessorySlug);
  } else if (toolId === 'upgrade-advisor') {
    setIf('current', params.currentSlug ?? params.productSlug);
    setIf('successor', params.successorSlug);
  } else if (toolId === 'compare') {
    const ids = (params.compareProductIds ?? []).filter((id) => id !== '');
    if (ids.length > 0) query.set('products', ids.join(','));
  } else if (toolId === 'persona-fit' || toolId === 'price-match') {
    // No product param on these tools — only their own dialect (below).
  } else {
    setIf('product', params.productSlug);
  }

  // Per-route extras, in the tool's own dialect.
  if (toolId !== null) {
    for (const key of TOOL_URL_EXTRAS[toolId] ?? []) {
      const value = params[key];
      if (typeof value === 'string') setIf(key, value);
    }
  }

  if (params.extra) {
    for (const [key, value] of Object.entries(params.extra)) {
      setIf(key, value);
    }
  }

  const qs = query.toString();
  return qs === '' ? toolRoute : `${toolRoute}?${qs}`;
}

// ---------------------------------------------------------------------------
// Cached product fetch (delegating facade — B-04)
// ---------------------------------------------------------------------------

/**
 * Cached single-product fetch for tools.
 * Delegates to `services/products.ts#getCachedProductBySlug`
 * (`swrGet`, `cacheKey('product', slug)`, 60s fresh / 300s stale).
 */
export async function getToolProduct(
  supabase: AnySupabaseClient,
  slug: string
): Promise<Product | null> {
  return getCachedProductBySlug(supabase, slug);
}

/**
 * Cached product-LIST fetch for tools — the one new cached variant
 * (B-04). Wraps the existing UNcached
 * `services/products.ts#getProducts` in `lib/cache#swrGet` with
 * `cacheKey('products', <stable options key>)`, 60s fresh / 300s
 * stale — the same TTL pair the single-product twin uses. The
 * wrapper lives HERE, not in `services/products.ts`, so Stage 1
 * does not edit a file another worker owns this round. The cache
 * key is the JSON of the normalised options, so two different
 * filters never share an entry.
 */
export async function getCachedProducts(
  supabase: AnySupabaseClient,
  options: ProductListOptions = {}
): Promise<ProductListResult> {
  const normalised: ProductListOptions = {
    page: options.page ?? 1,
    pageSize: options.pageSize ?? 20,
    sort: options.sort ?? 'newest',
    order: options.order,
    ...(options.category !== undefined ? { category: options.category } : {}),
    ...(options.brand !== undefined ? { brand: options.brand } : {}),
    ...(options.search !== undefined ? { search: options.search } : {}),
  };
  const key = cacheKey('products', JSON.stringify(normalised));
  return swrGet<ProductListResult>(
    key,
    () => getProducts(supabase, options),
    60_000, // 1 min fresh — same pair as getCachedProductBySlug
    300_000 // 5 min stale
  );
}

/**
 * Cached price-history fetch for tools.
 * Delegates to `services/price-history.ts#getCachedPriceHistory`
 * (`swrGet`, `cacheKey('price-history', productId, ...)`,
 * 60s fresh / 300s stale).
 */
export async function getToolPriceHistory(
  supabase: AnySupabaseClient,
  productId: string,
  options: PriceHistoryOptions = {}
): Promise<PriceHistoryResult> {
  return getCachedPriceHistory(supabase, productId, options);
}

/**
 * Cached merchant-listings fetch for tools.
 * Delegates to `services/commerce.ts#getCachedMerchantProducts`
 * (`swrGet`, `cacheKey('merchant-products', productId)`,
 * 60s fresh / 300s stale).
 */
export async function getToolMerchantProducts(
  supabase: AnySupabaseClient,
  productId: string
): Promise<MerchantProduct[]> {
  return getCachedMerchantProducts(supabase, productId);
}

// ---------------------------------------------------------------------------
// Cross-tool link builders (each carries the product in the
// destination tool's own dialect)
// ---------------------------------------------------------------------------

/** No product to carry → the bare route (never an empty ?product=). */
function withProduct(route: string, slug: string | null | undefined): string {
  if (!slug) return route;
  return `${route}?product=${encodeURIComponent(slug)}`;
}

/**
 * /compare link. Dialect: `?products=<uuid>,<uuid>` — /compare
 * resolves product UUIDs, not slugs, so this takes IDs. With no IDs
 * it returns the bare `/compare` (product picker, no invented id).
 * When only a slug is known, use `compareLinkForProduct` instead.
 */
export function compareLink(productIds: string[]): string {
  const ids = productIds.filter((id) => id !== '');
  if (ids.length === 0) return TOOL_ROUTES.compare;
  return `${TOOL_ROUTES.compare}?products=${ids.map(encodeURIComponent).join(',')}`;
}

/**
 * /compare link from a slug: resolves the slug to its product id via
 * `getToolProduct` (→ `getCachedProductBySlug`), then `compareLink`.
 * Unresolvable slug → bare `/compare` (never an invented id).
 * Note: a real comparison needs ≥2 products — this links one product
 * into the picker; the page pre-selects it when it resolves.
 */
export async function compareLinkForProduct(
  supabase: AnySupabaseClient,
  productSlug: string
): Promise<string> {
  const product = await getToolProduct(supabase, productSlug);
  if (!product) return TOOL_ROUTES.compare;
  return compareLink([product.id]);
}

/** T10 Compatibility Checker: `?device=<slug>&accessory=<slug>`. */
export function compatibilityLink(
  deviceSlug: string | null,
  accessorySlug?: string | null
): string {
  return buildToolUrl(TOOL_ROUTES['compatibility-checker'], {
    deviceSlug,
    accessorySlug: accessorySlug ?? null,
  });
}

/** T5 Energy Cost Calculator: `?product=<slug>` (labels the result). */
export function energyCostLink(productSlug: string | null): string {
  return withProduct(TOOL_ROUTES['energy-cost'], productSlug);
}

/** T1 Upgrade Advisor: `?current=<slug>&successor=<slug>`. */
export function upgradeAdvisorLink(
  currentSlug: string | null,
  successorSlug?: string | null
): string {
  return buildToolUrl(TOOL_ROUTES['upgrade-advisor'], {
    currentSlug,
    successorSlug: successorSlug ?? null,
  });
}

/**
 * T2 Persona Fit Finder: `?persona=&budget=`. T2 takes NO product
 * param for its own logic (audit §T2), so this builder carries
 * persona/budget only — UNLESS the caller explicitly passes a
 * product slug: the page reads `?product=` for transfer
 * (`parseToolParams` → its RelatedTools pass it onward), so a
 * caller that knows the product (e.g. the product page) carries
 * it. Without the third argument no `?product=` is ever emitted.
 */
export function personaFitLink(
  persona?: string | null,
  budget?: string | null,
  productSlug?: string | null
): string {
  return buildToolUrl(TOOL_ROUTES['persona-fit'], {
    persona: persona ?? null,
    budget: budget ?? null,
    extra: productSlug ? { product: productSlug } : undefined,
  });
}

/**
 * T3 Price-Match Finder: `?status=`. T3 takes NO product param
 * for its own logic (audit §T3 — static policy directory), so this
 * builder carries only the status filter — UNLESS the caller
 * explicitly passes a product slug: the page reads `?product=`
 * for transfer (`parseToolParams` → its RelatedTools pass it
 * onward), so a caller that knows the product (e.g. the product
 * page) carries it. Without the second argument no `?product=`
 * is ever emitted.
 */
export function priceMatchLink(
  status?: string | null,
  productSlug?: string | null
): string {
  return buildToolUrl(TOOL_ROUTES['price-match'], {
    status: status ?? null,
    extra: productSlug ? { product: productSlug } : undefined,
  });
}

/** T4 Own-It Guard: `?product=<slug>` (or `?name=&brand=&gtin=`). */
export function ownItLink(
  productSlug: string | null,
  typed?: { name?: string | null; brand?: string | null; gtin?: string | null }
): string {
  return buildToolUrl(TOOL_ROUTES['own-it-check'], {
    productSlug,
    name: typed?.name ?? null,
    brand: typed?.brand ?? null,
    gtin: typed?.gtin ?? null,
  });
}

/** T8 Deal Stacker: `?product=<slug>`. */
export function dealStackerLink(productSlug: string | null): string {
  return withProduct(TOOL_ROUTES['deal-stacker'], productSlug);
}

/** T6 Negotiation Coach: `?product=<slug>`. */
export function negotiationLink(productSlug: string | null): string {
  return withProduct(TOOL_ROUTES['negotiation-coach'], productSlug);
}

/** T7 Repairability Explorer: `?product=<slug>`. */
export function repairabilityLink(productSlug: string | null): string {
  return withProduct(TOOL_ROUTES.repairability, productSlug);
}

/** T9 Refurbished Checklist: `?product=<slug>`. */
export function refurbishedLink(productSlug: string | null): string {
  return withProduct(TOOL_ROUTES['refurbished-checklist'], productSlug);
}

// ---------------------------------------------------------------------------
// RelatedTools link-block data (data-only — Stage 3 renders it)
// ---------------------------------------------------------------------------

/** One entry of a RelatedTools link block: href + label, no JSX. */
export interface RelatedToolLink {
  href: string;
  label: string;
}

/**
 * Related-tool links for one tool, carrying the product in each
 * destination's own dialect. Data-only: Stage 3 renders these as a
 * link block; nothing here touches the DOM.
 *
 * The per-tool lists are the brief's "wanted connections" from
 * TOOL_DEPENDENCY_MAP.md §1, restricted to destinations that exist
 * as routes — "Specs" (0 specs rows), "Alternatives", "Condition"
 * and "Deal Finder" have no route and are omitted, not linked to a
 * wrong page. T2/T3 links carry the product via `?product=` (both
 * pages read it for transfer and show the selected product)
 * alongside their own dialect (persona/budget, status).
 */
export function relatedToolLinks(
  tool: ToolId | string,
  productSlug: string | null
): RelatedToolLink[] {
  const product = productSlug ?? null;
  switch (tool) {
    case 'upgrade-advisor':
      return [
        { href: compareLink([]), label: 'Compare products' },
        { href: personaFitLink(null, null, product), label: 'Find your persona fit' },
        { href: priceMatchLink(null, product), label: 'Check the price-match policy' },
        { href: ownItLink(product), label: 'Do I already own this?' },
        { href: energyCostLink(product), label: 'Calculate total energy cost' },
        { href: dealStackerLink(product), label: 'Stack this deal' },
        { href: refurbishedLink(product), label: 'Refurbished buying checklist' },
      ];
    case 'persona-fit':
      return [
        { href: upgradeAdvisorLink(product), label: 'Is this an upgrade?' },
        { href: compareLink([]), label: 'Compare products' },
        { href: '/tools/budget-finder', label: 'Find products in your budget' },
        { href: compatibilityLink(product), label: 'Check compatibility' },
      ];
    case 'price-match':
      return [
        { href: compareLink([]), label: 'Compare products' },
        { href: dealStackerLink(product), label: 'Stack this deal' },
        { href: negotiationLink(product), label: 'Negotiate this price' },
        { href: '/tools/price-history', label: 'See recorded price history' },
      ];
    case 'own-it-check':
      return [
        { href: upgradeAdvisorLink(product), label: 'Is this an upgrade?' },
        { href: personaFitLink(null, null, product), label: 'Find your persona fit' },
        { href: compatibilityLink(product), label: 'Check compatibility' },
      ];
    case 'energy-cost':
      return [
        { href: compareLink([]), label: 'Compare products' },
        { href: upgradeAdvisorLink(product), label: 'Is this an upgrade?' },
        { href: '/tools/budget-finder', label: 'Find products in your budget' },
      ];
    case 'negotiation-coach':
      return [
        { href: priceMatchLink(null, product), label: 'Check the price-match policy' },
        { href: dealStackerLink(product), label: 'Stack this deal' },
      ];
    case 'repairability':
      return [
        { href: upgradeAdvisorLink(product), label: 'Is this an upgrade?' },
        { href: refurbishedLink(product), label: 'Refurbished buying checklist' },
      ];
    case 'deal-stacker':
      return [
        { href: priceMatchLink(null, product), label: 'Check the price-match policy' },
        { href: '/tools/coupons-cashback', label: 'Coupons and cashback' },
        { href: negotiationLink(product), label: 'Negotiate this price' },
        { href: '/tools/budget-finder', label: 'Find products in your budget' },
      ];
    case 'refurbished-checklist':
      return [
        { href: compareLink([]), label: 'Compare products' },
        { href: upgradeAdvisorLink(product), label: 'Is this an upgrade?' },
        { href: repairabilityLink(product), label: 'Check repairability' },
        { href: priceMatchLink(null, product), label: 'Check the price-match policy' },
      ];
    case 'compatibility-checker':
      return [
        { href: upgradeAdvisorLink(product), label: 'Is this an upgrade?' },
        { href: personaFitLink(null, null, product), label: 'Find your persona fit' },
      ];
    default:
      return [];
  }
}
