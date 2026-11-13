/**
 * Validation helpers using Zod schemas.
 * Validates request bodies against a schema and returns a typed result.
 *
 * Sections 21–25, J-P1-4 / G-P2-1 — schema validation for mutation
 * routes. ADOPTION (counted 2026-11-13 by grepping `validateBody`
 * over app/api — re-count before repeating this number):
 * 27 of 107 mutation route files call `validateBody` (16 before
 * this slice; +11 wired in the Final 100% sweep: newsletter
 * subscribe/unsubscribe/confirm, referrals, referrals/click,
 * product-views, analytics/events, affiliate/click,
 * mobile-app/waitlist, wishlists, recommendations/feedback).
 * The ADMIN slice is complete: all 10 admin mutation route files
 * call it. The one admin mutation handler without a gate, DELETE
 * /api/v1/admin/products/[id], takes no body, so there is nothing
 * to validate. The other 80 mutation route files still hand-roll
 * `typeof` checks (or none) — a documented deviation, not a claim
 * of full adoption; POST /api/v1/referrals/attribute stays unwired
 * on purpose (it soft-ignores an invalid code by contract).
 * Do NOT claim full adoption until a fresh grep says so.
 * A failed check returns 400 via `invalidBodyResponse` (never a
 * 500, never a silent accept) in every route that is wired.
 *
 * House convention (matches the pre-existing Zod routes — alerts,
 * subscriptions/checkout, intake): a failed schema check returns
 * `badRequest(firstError)` — 400 with the generic error envelope —
 * so existing clients and tests that assert 400 keep working.
 * Schemas constrain TYPE / SHAPE / BOUNDS only. Required-ness stays
 * in the route's existing checks, so the route's own error messages
 * (e.g. 'name is required') are preserved. Where a route already
 * coerces with `Number(...)` (merchant verify, fact-check,
 * tech-budget) the schema accepts numeric strings too, via
 * `coercibleInt` / `coercibleNumber`, mirroring the old acceptance.
 */

import { z } from 'zod';
import type { NextResponse } from 'next/server';
import { badRequest } from './responses';
import { validateGtin } from '@/lib/gtin';

export function validateBody<T>(schema: z.ZodSchema<T>, body: unknown):
  | { success: true; data: T }
  | { success: false; errors: Record<string, string[]> } {
  const result = schema.safeParse(body);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const errors: Record<string, string[]> = {};
  for (const issue of result.error.issues) {
    const path = issue.path.join('.') || '_';
    if (!errors[path]) errors[path] = [];
    errors[path].push(issue.message);
  }
  return { success: false, errors };
}

/**
 * Turn a failed `validateBody` result into the 400 response, or
 * return null when validation passed. Routes use it as:
 *
 *   const invalid = invalidBodyResponse(validateBody(mySchema, body ?? {}));
 *   if (invalid) return invalid;
 */
export function invalidBodyResponse(
  result:
    | { success: true; data: unknown }
    | { success: false; errors: Record<string, string[]> },
): NextResponse | null {
  if (result.success) return null;
  const firstError = Object.values(result.errors).flat()[0];
  return badRequest(firstError ?? 'Invalid request body');
}

// ---------------------------------------------------------------------------
// Shared field primitives (all optional at the schema level — see header)
// ---------------------------------------------------------------------------

/** Plain text, trimmed by the route as before; bound against abuse. */
export const textField = (max = 500) => z.string().max(max);
export const optionalText = (max = 500) => z.string().max(max).optional();
export const slugField = (max = 200) => z.string().max(max);
export const idField = (max = 200) => z.string().max(max);
export const emailField = () => z.string().trim().max(254); // format is checked by the route (isValidEmail*), keeping its message
/** http(s) URL only — matches the routes' own `^https?://` checks. */
export const httpUrlField = (max = 2048) =>
  z
    .string()
    .max(max)
    .refine((v) => /^https?:\/\/.+/.test(v.trim()), {
      message: 'must be a valid http(s) URL',
    });
export const isoDateField = () => z.string().max(30);
export const boundedInt = (min: number, max: number) =>
  z.number().int().min(min).max(max);
export const finiteNumber = () => z.number().finite();
export const stringArrayField = (maxItems = 100, maxLen = 200) =>
  z.array(z.string().max(maxLen)).max(maxItems);

/**
 * A number the route reads with `Number(value)` — accepts a finite
 * number or a numeric string, rejects NaN / non-numeric strings /
 * booleans / objects. `null` stays `null` (unlike z.coerce, which
 * would turn null into 0 and clear-then-set a field by accident).
 */
export const coercibleNumber = (min?: number, max?: number) =>
  z.unknown().refine(
    (v) => {
      if (v === undefined || v === null || v === '') return true;
      const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
      if (!Number.isFinite(n)) return false;
      if (min !== undefined && n < min) return false;
      if (max !== undefined && n > max) return false;
      return true;
    },
    { message: 'must be a number' },
  );

export const coercibleInt = (min?: number, max?: number) =>
  z.unknown().refine(
    (v) => {
      if (v === undefined || v === null || v === '') return true;
      const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
      if (!Number.isFinite(n) || !Number.isInteger(n)) return false;
      if (min !== undefined && n < min) return false;
      if (max !== undefined && n > max) return false;
      return true;
    },
    { message: 'must be a whole number' },
  );

/** GS1 GTIN (8/12/13/14 digits + check digit). Blank/null stays absent. */
export const gtinField = () =>
  z
    .string()
    .max(50)
    .nullable()
    .optional()
    .refine(
      (v) => v == null || v.trim() === '' || validateGtin(v).valid,
      { message: 'gtin must be a valid GS1 GTIN (8, 12, 13 or 14 digits with a correct check digit)' },
    );

// ---------------------------------------------------------------------------
// Generic guard — every JSON mutation body must be a plain object.
// Rejects array / string / number / null bodies with a 400 instead of
// the old silent accept (or 500 from a bare `request.json()`).
// ---------------------------------------------------------------------------

export const mutationBodySchema = z.record(z.string(), z.unknown());
/** Alias for routes that take no body (cron / DELETE): same object guard. */
export const emptyMutationBodySchema = mutationBodySchema;

// ---------------------------------------------------------------------------
// Precise per-route schemas. One schema per route file; all fields
// optional (required-ness stays in the route's existing checks).
// Field types/bounds mirror what the route already enforces or
// accepts — see the per-schema comment for the grounding.
// ---------------------------------------------------------------------------

// --- Admin (G-P2-1: admin routes first) ---

/** POST /api/v1/admin/ai/jobs — mirrors the route's own inline schema (now shared): imageUrl/caption trimmed, limit 1–10. */
export const adminAiJobsSchema = z.object({
  imageUrl: z.string().trim().max(2048).optional(),
  caption: z.string().trim().max(1000).optional(),
  limit: z.number().int().min(1).max(10).optional(),
  preferClip: z.boolean().optional(),
});

/** PATCH /api/v1/admin/community-deals/[id] — action enum checked by the route. */
export const adminCommunityDealModerationSchema = z.object({
  action: textField(20).optional(),
});

/** POST /api/v1/admin/ebay/preview — q is re-validated by validateLocalFirstQuery (max 200 chars, so the 500 bound here is looser on purpose); limit is floored + clamped 1–10 by the route, so the schema only requires a finite number; condition is any string (the Browse service ignores unknown values); items entries without a string itemId are skipped by the route, so itemId stays optional here. */
export const adminEbayPreviewSchema = z.object({
  q: textField(500).optional(),
  limit: z.number().finite().nullable().optional(),
  condition: z.string().optional(),
  items: z
    .array(
      z.object({
        itemId: textField(200).optional(),
        brand: textField(200).optional(),
        category: textField(200).optional(),
        slug: textField(200).optional(),
        description: textField(2000).optional(),
      }),
    )
    .max(10)
    .optional(),
});

/** POST /api/v1/admin/merchants/[slug]/verify — mirrors parseOptionalInt/Score/Url (Number() coercion, 0–5 score, http(s) URLs). The route's int parsers impose NO upper bound (only ≥ 0), so neither does this schema; the policy URLs have no length bound in the route either. */
export const adminMerchantVerifySchema = z.object({
  action: textField(20).optional(),
  returnWindowDays: coercibleInt(0).nullable().optional(),
  warrantyMonths: coercibleInt(0).nullable().optional(),
  reputationScore: coercibleNumber(0, 5).nullable().optional(),
  returnPolicyUrl: z.string().nullable().optional(),
  warrantyPolicyUrl: z.string().nullable().optional(),
});

/** POST /api/v1/admin/newsletter/send — limit is floored + clamped 1–500 by the sender, so the schema only requires a finite number (null is ignored by the route, same as absent). */
export const adminNewsletterSendSchema = z.object({
  limit: z.number().finite().nullable().optional(),
});

/**
 * PATCH /api/v1/admin/products/[id] — mirrors validateAdminProductPatch
 * (services/admin-products.ts, NOT changed here): name ≤200,
 * description ≤5000, brand/category ≤200, image_url http(s) ≤2048,
 * status enum checked by the service. ADDS the GS1 check-digit gate
 * on gtin (audit G-P2-1 / C B2: the service only length-checked it).
 */
export const adminProductPatchSchema = z.object({
  name: z.string().max(200).nullable().optional(),
  description: z.string().max(5000).nullable().optional(),
  brand: z.string().max(200).nullable().optional(),
  category: z.string().max(200).nullable().optional(),
  image_url: z.string().max(2048).nullable().optional(),
  gtin: gtinField(),
  status: textField(20).optional(),
  // FINAL 100% (F-P0-03) — both verification columns, shape gate
  // only (the service keeps the cross-field rule: 'verified'
  // requires a check date in the same edit).
  price_verification_status: textField(20).optional(),
  price_verified_at: z.string().max(40).nullable().optional(),
});

/** PATCH /api/v1/admin/products/[id]/specs — shape gate only (services/admin-products.ts `validateSpecCorrection` keeps the template / non-empty / max-50 rules and its 422 messages). Bounds mirror the service: entries ≤ 50, deleteKeys ≤ 50; the service puts no length bound on key/value/unit/source/deleteKeys, so neither does this schema — it only rejects wrong types. The route passes the ORIGINAL body to the service, never the stripped `data`. */
export const adminProductSpecsPatchSchema = z.object({
  entries: z
    .array(
      z.object({
        key: z.string().optional(),
        value: z.string().optional(),
        unit: z.string().optional(),
      }),
    )
    .max(50)
    .optional(),
  deleteKeys: z.array(z.string()).max(50).optional(),
  source: z.string().optional(),
});

/** POST /api/v1/admin/sentry-test — kind enum checked by the route. */
export const adminSentryTestSchema = z.object({
  kind: textField(20).optional(),
});

/** POST /api/v1/admin/visual-search-backfill — force is `=== true` only. */
export const adminVisualSearchBackfillSchema = z.object({
  force: z.boolean().optional(),
});

// --- Intake / pipeline ---

/** POST /api/v1/prices/refresh (cron) — optional replace flag. */
export const pricesRefreshSchema = z.object({
  replace: z.boolean().optional(),
});

/** POST /api/v1/scan — imageUrl / keywords are typeof-string-guarded by the route. */
export const scanSchema = z.object({
  imageUrl: textField(2048).optional(),
  keywords: textField(500).optional(),
});

// --- Auth / account ---

/** DELETE /api/v1/account — body must be { confirmation: 'DELETE' } (checked by isValidDeleteConfirmation). */
export const accountDeleteSchema = z.object({
  confirmation: textField(20).optional(),
});

// --- Alerts ---

/** POST /api/v1/alerts/guest — email/productId/targetPrice checks mirror the route. */
export const guestAlertSchema = z.object({
  email: emailField().optional(),
  productId: idField().optional(),
  alertType: textField(30).optional(),
  targetPrice: finiteNumber().optional(),
  guestToken: textField(200).optional(),
});

/** PATCH /api/v1/alerts/[id] — conditionValue is passed through as-is by the route, so it stays untyped here. */
export const alertUpdateSchema = z.object({
  alertType: textField(30).optional(),
  conditionValue: z.unknown().optional(),
  channel: textField(30).optional(),
  active: z.boolean().optional(),
});

/** POST /api/v1/alerts/guest/unsubscribe + newsletter confirm/unsubscribe — token also readable from the query string. */
export const tokenBodySchema = z.object({
  token: textField(500).optional(),
  email: emailField().optional(),
});

// --- Newsletter (public) ---

/** POST /api/v1/newsletter/subscribe — isValidEmailAddress + source enum checked by the route. */
export const newsletterSubscribeSchema = z.object({
  email: emailField().optional(),
  source: textField(100).optional(),
});

// --- Push / public keys ---

/** POST /api/v1/push/subscribe — endpoint/keys required by the route's own check. */
export const pushSubscribeSchema = z.object({
  endpoint: textField(2048).optional(),
  keys: z
    .object({
      p256dh: z.string().max(500).optional(),
      auth: z.string().max(500).optional(),
    })
    .optional(),
  expirationTime: z.number().nullable().optional(),
  guestToken: textField(200).optional(),
});

/** POST /api/v1/public/keys — name ≤100, scopes a non-empty subset of API_KEY_SCOPES (checked by the route). */
export const publicKeyCreateSchema = z.object({
  name: textField(100).optional(),
  scopes: z.array(z.string().max(100)).max(50).optional(),
});

// --- Wishlists / buy list ---

/** POST /api/v1/wishlists (+ PATCH /api/v1/wishlists/[id]). */
export const wishlistSchema = z.object({
  name: textField(200).optional(),
  description: textField(2000).optional(),
  isPublic: z.boolean().optional(),
});

/** POST /api/v1/wishlists/[id]/items. */
export const wishlistItemSchema = z.object({
  productSlug: slugField().optional(),
  productId: idField().optional(),
  notes: textField(2000).optional(),
  targetPrice: finiteNumber().optional(),
});

/** POST /api/v1/wishlists/[id]/items/external. */
export const wishlistExternalItemSchema = z.object({
  catalogSlug: slugField().optional(),
  currency: textField(10).optional(),
  notes: textField(2000).optional(),
  price: finiteNumber().optional(),
  title: textField(500).optional(),
  url: textField(2048).optional(),
});

/** POST /api/v1/buy-list (+ PATCH /api/v1/buy-list/[id]) — quantity 1–99 enforced by the route. */
export const buyListSchema = z.object({
  productId: idField().optional(),
  merchantProductId: z.string().max(200).nullable().optional(),
  quantity: z.number().int().optional(),
});

// --- Community / comparison / chat ---

/** POST /api/v1/community-deals — price/sourceUrl checks mirror the route. */
export const communityDealSchema = z.object({
  couponCode: textField(100).optional(),
  dealText: textField(2000).optional(),
  merchantName: textField(200).optional(),
  price: finiteNumber().optional(),
  productId: idField().optional(),
  productName: textField(200).optional(),
  sourceUrl: textField(2048).optional(),
});

/** POST /api/v1/community-deals/[id]/vote — value 1 | -1 | 0 enforced by the route. */
export const communityDealVoteSchema = z.object({
  value: z.number().int().optional(),
});

/** POST /api/v1/comparison — 2–5 product IDs enforced by the route. */
export const comparisonSchema = z.object({
  productIds: z.array(z.string().max(200)).max(10).optional(),
});

/** POST /api/v1/chat/conversations. */
export const chatConversationSchema = z.object({
  title: textField(200).optional(),
});

/** POST /api/v1/chat/messages. */
export const chatMessageSchema = z.object({
  conversationId: idField().optional(),
  message: textField(20000).optional(),
});

/** POST /api/v1/products/[slug]/reviews (JSON branch) — rating 1–5 enforced by the route. */
export const productReviewSchema = z.object({
  rating: z.number().finite().optional(),
  title: textField(500).optional(),
  content: textField(20000).optional(),
  verifiedPurchase: z.boolean().optional(),
});

/** POST + PATCH /api/v1/products/[slug]/qa — answer is stored as-is by the route. */
export const productQaSchema = z.object({
  question: textField(2000).optional(),
  questionId: idField().optional(),
  status: textField(50).optional(),
  answer: z.unknown().optional(),
});

// --- Agent ---

/** POST /api/v1/agent/rules (+ PATCH /api/v1/agent/rules/[id]) — channel enum checked by the route. */
export const agentRuleSchema = z.object({
  channel: textField(20).optional(),
  productId: idField().optional(),
  productName: textField(200).optional(),
  productSlug: slugField().optional(),
  targetPriceUsd: finiteNumber().optional(),
  active: z.boolean().optional(),
});

/** POST /api/v1/agent/hunts (+ PATCH /api/v1/agent/hunts/[id]). */
export const agentHuntSchema = z.object({
  category: textField(100).optional(),
  maxBudgetUsd: finiteNumber().optional(),
  preferredBrands: stringArrayField().optional(),
  active: z.boolean().optional(),
});

/** PUT /api/v1/agent/memory — preferences is a record, consent is stored as-is. */
export const agentMemorySchema = z.object({
  preferences: z.record(z.string(), z.unknown()).optional(),
  addSeenSlug: slugField().optional(),
  clearSeen: z.boolean().optional(),
  consent: z.unknown().optional(),
});

// --- AI search / tools ---

/** POST /api/v1/ai-search. */
export const aiSearchSchema = z.object({
  query: textField(1000).optional(),
  url: textField(2048).optional(),
  filters: z.record(z.string(), z.unknown()).optional(),
  page: z.number().int().optional(),
  pageSize: z.number().int().optional(),
  includeWeb: z.boolean().optional(),
  sort: textField(50).optional(),
});

/** POST /api/v1/visual-search. */
export const visualSearchSchema = z.object({
  caption: textField(1000).optional(),
  imageUrl: textField(2048).optional(),
  limit: z.number().int().optional(),
});

/** POST /api/v1/deal-finder — messages are chat turns. */
export const dealFinderSchema = z.object({
  country: textField(100).optional(),
  messages: z.array(z.record(z.string(), z.unknown())).max(100).optional(),
});

/** POST /api/v1/tools/ai-qa. */
export const aiQaSchema = z.object({
  question: textField(2000).optional(),
  slug: slugField().optional(),
});

/** POST /api/v1/tools/digest. */
export const digestToolSchema = z.object({
  frequency: textField(30).optional(),
  is_active: z.boolean().optional(),
});

/** POST /api/v1/tools/eco-coach + /api/v1/tools/planner — month is YYYY-MM, budget a number. */
export const monthToolSchema = z.object({
  month: textField(20).optional(),
  budgetUsd: finiteNumber().optional(),
});

/** POST /api/v1/tools/expenses. */
export const expenseSchema = z.object({
  note: textField(1000).optional(),
  product_slug: slugField().optional(),
  spent_on: isoDateField().optional(),
  amountUsd: finiteNumber().optional(),
});

/** POST /api/v1/tools/future-you. */
export const futureYouSchema = z.object({
  product_slug: slugField().optional(),
});

/** POST /api/v1/tools/list-optimizer. */
export const listOptimizerSchema = z.object({
  name: textField(200).optional(),
});

/** POST /api/v1/tools/smart-home. */
export const smartHomeSchema = z.object({
  deviceLabel: textField(200).optional(),
  productSlug: slugField().optional(),
  trigger: textField(100).optional(),
});

/** POST /api/v1/tools/warranty-claims. */
export const warrantyClaimSchema = z.object({
  claimStatus: textField(50).optional(),
  notes: textField(2000).optional(),
  productSlug: slugField().optional(),
  retailer: textField(200).optional(),
  vaultItemId: idField().optional(),
});

/** POST /api/v1/tools/consumer-subscriptions — snake_case fields validated by parseCreateBody in the route. */
export const consumerSubscriptionSchema = z.object({
  id: idField().optional(),
  name: textField(200).optional(),
  price_usd: finiteNumber().optional(),
  billing_interval: textField(20).optional(),
  renewal_date: isoDateField().nullable().optional(),
  last_used_at: isoDateField().nullable().optional(),
  category: textField(200).nullable().optional(),
  is_active: z.boolean().optional(),
});

/** POST /api/v1/affiliate/transform — urls list, max 20 enforced by the route. */
export const affiliateTransformSchema = z.object({
  urls: z.array(z.string().max(2048)).max(100).optional(),
});

/** POST /api/v1/affiliate/geo-click — accepts retailerName or merchantName (beacon compat). */
export const affiliateGeoClickSchema = z.object({
  targetUrl: textField(2048).optional(),
  productSlug: slugField().optional(),
  productId: idField(100).optional(),
  retailerName: textField(100).optional(),
  merchantName: textField(100).optional(),
});

/** POST /api/v1/tech-budget — Number() coercion in the route, mirrored here. */
export const techBudgetSchema = z.object({
  monthlyTechBudgetUsd: coercibleNumber(0).optional(),
  dailyTargetHours: coercibleNumber(0, 24).optional(),
});

// --- Commerce / misc ---

/** POST /api/v1/affiliate/click. */
export const affiliateClickSchema = z.object({
  affiliateLinkId: idField().optional(),
  productId: idField().optional(),
  retailerName: textField(200).optional(),
  clickedPrice: finiteNumber().optional(),
});

/** POST /api/v1/analytics/events — metadata is a free-form record. */
export const analyticsEventSchema = z.object({
  eventType: textField(100).optional(),
  productId: idField().optional(),
  value: finiteNumber().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/** POST /api/v1/creator-rewards/award. */
export const creatorRewardAwardSchema = z.object({
  dealId: idField().optional(),
});

/** POST /api/v1/fact-check — prices use the route's toOptionalNumber (Number() coercion). */
export const factCheckSchema = z.object({
  subjectType: textField(100).optional(),
  subjectId: idField().optional(),
  subjectTitle: textField(500).optional(),
  listingPrice: coercibleNumber(0).nullable().optional(),
  compareAtPrice: coercibleNumber(0).nullable().optional(),
  checkoutPrice: coercibleNumber(0).nullable().optional(),
  historyLowest: coercibleNumber(0).nullable().optional(),
  historyPoints: coercibleInt(0).nullable().optional(),
  merchantCaution: z.boolean().optional(),
});

/** PATCH /api/v1/fact-check/[id]. */
export const factCheckNoteSchema = z.object({
  note: textField(5000).optional(),
});

/** POST /api/v1/gifts. */
export const giftsSchema = z.object({
  budgetText: textField(500).optional(),
  country: textField(100).optional(),
  occasion: textField(100).optional(),
});

/** POST /api/v1/live-sessions. */
export const liveSessionSchema = z.object({
  endsAt: isoDateField().optional(),
  hostNote: textField(1000).optional(),
  productIds: z.array(z.string().max(200)).max(100).optional(),
  slug: slugField().optional(),
  startsAt: isoDateField().optional(),
  streamUrl: textField(2048).optional(),
  title: textField(500).optional(),
});

/** POST /api/v1/merchants/[slug]/accuracy. */
export const merchantAccuracySchema = z.object({
  currency: textField(10).optional(),
  notes: textField(2000).optional(),
  productId: idField().optional(),
});

/** POST /api/v1/mobile-app/waitlist — platform enum checked by the route. */
export const mobileWaitlistSchema = z.object({
  email: emailField().optional(),
  platform: textField(50).optional(),
});

/** POST /api/v1/monitoring/uptime/check. */
export const uptimeCheckSchema = z.object({
  target_url: textField(2048).optional(),
});

/** POST /api/v1/pools (+ POST /api/v1/pools/[id]/join quantity). */
export const poolSchema = z.object({
  bulkNote: textField(1000).optional(),
  city: textField(100).optional(),
  productId: idField().optional(),
  productName: textField(200).optional(),
  regionCode: textField(10).optional(),
  quantity: z.number().int().optional(),
});

/** POST /api/v1/predictions/outcomes. */
export const predictionOutcomeSchema = z.object({
  actual_lowest_price: finiteNumber().optional(),
  predicted_lowest_price: finiteNumber().optional(),
  price_at_prediction: finiteNumber().optional(),
  productId: idField().optional(),
  predictionId: idField().optional(),
});

/** PUT /api/v1/preferences — notificationEmail/Push are booleans in the route. */
export const preferencesSchema = z.object({
  budgetMax: finiteNumber().optional(),
  budgetMin: finiteNumber().optional(),
  favoriteBrands: stringArrayField().optional(),
  favoriteCategories: stringArrayField().optional(),
  notificationEmail: z.boolean().optional(),
  notificationPush: z.boolean().optional(),
  preferredRetailers: stringArrayField().optional(),
});

/** POST /api/v1/price-protection. */
export const priceProtectionSchema = z.object({
  vaultItemId: idField().optional(),
  windowDays: z.number().int().optional(),
});

/** POST + DELETE /api/v1/product-views. */
export const productViewSchema = z.object({
  productId: idField().optional(),
});

/** POST /api/v1/recommendations/feedback + POST/DELETE /api/v1/recommendations/saved. */
export const recommendationProductSchema = z.object({
  productId: idField().optional(),
});

/** PUT /api/v1/recommendations/personalization. */
export const personalizationSchema = z.object({
  optedOut: z.boolean().optional(),
});

/** POST /api/v1/referrals (+ /click + /attribute) — code is a string in the route. */
export const referralSchema = z.object({
  code: textField(100).optional(),
  productId: idField().optional(),
  guestToken: textField(200).optional(),
});

/** POST /api/v1/saved-searches (+ PATCH/DELETE) — other fields are free-form search criteria. */
export const savedSearchSchema = z.object({
  notifyOnMatch: z.boolean().optional(),
});

/** POST /api/v1/savings. */
export const savingsSchema = z.object({
  alert_id: idField().optional(),
  basis: textField(100).optional(),
  product_id: idField().optional(),
  amountSavedUsd: finiteNumber().optional(),
});

/** POST /api/v1/settings/webhooks. */
export const settingsWebhooksSchema = z.object({
  genericWebhookSecret: textField(500).optional(),
  genericWebhookUrl: textField(2048).optional(),
  telegramChatId: textField(100).optional(),
  telegramEnabled: z.boolean().optional(),
  whatsappEnabled: z.boolean().optional(),
  whatsappPhone: textField(30).optional(),
});

/** POST /api/v1/translations. */
export const translationSchema = z.object({
  field: textField(100).optional(),
  language: textField(20).optional(),
  productId: idField().optional(),
  source: textField(100).optional(),
  text: textField(20000).optional(),
});

/** POST /api/v1/vault (+ PATCH /api/v1/vault/[id]). */
export const vaultSchema = z.object({
  amount: finiteNumber().optional(),
  currency: textField(10).optional(),
  extractedText: textField(20000).optional(),
  productId: idField().optional(),
  purchaseDate: isoDateField().optional(),
  receiptFileName: textField(500).optional(),
  receiptFileSize: z.number().int().optional(),
  receiptFileType: textField(100).optional(),
  receiptUrl: textField(2048).optional(),
  store: textField(200).optional(),
  title: textField(500).optional(),
  isConsumable: z.boolean().optional(),
  reorderIntervalDays: z.number().int().optional(),
  reorderReminder: z.boolean().optional(),
});

/** POST /api/v1/warranty-plans. */
export const warrantyPlanSchema = z.object({
  coverageSummary: textField(5000).optional(),
  currency: textField(10).optional(),
  deductibleUsd: finiteNumber().optional(),
  durationMonths: z.number().int().optional(),
  isActive: z.boolean().optional(),
  merchantId: idField().optional(),
  planName: textField(200).optional(),
  priceUsd: finiteNumber().optional(),
  productCategory: textField(200).optional(),
  providerName: textField(200).optional(),
  sourceUrl: textField(2048).optional(),
  verifiedAt: isoDateField().optional(),
});

/** POST /api/v1/wishlist-polls (+ POST /api/v1/wishlist-polls/[id]/vote). */
export const wishlistPollSchema = z.object({
  question: textField(1000).optional(),
  wishlistId: idField().optional(),
  optionId: idField().optional(),
});

/** PATCH /api/v1/notifications/[id] + POST /api/v1/notifications/read-all. */
export const notificationReadSchema = z.object({
  read: z.boolean().optional(),
});
