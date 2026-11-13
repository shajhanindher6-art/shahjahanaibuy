/**
 * Final 100%, F-P1-60 — schema-validation sweep (second batch).
 *
 * The S21–25 build wrote per-route Zod schemas in
 * `lib/api/validation.ts` but wired only 16/106 mutation route
 * files to `validateBody`. This file pins the 11 files wired in
 * this slice (27/107 at the time of writing — the denominator
 * moved 106 → 107 while other workers added a route; the count is
 * re-measured at gate time, never copied forward).
 *
 * House convention (unchanged): schemas constrain TYPE / SHAPE /
 * BOUNDS only; required-ness stays in each route's existing
 * checks, so the route's own error messages are preserved. Two
 * deliberate tightenings are pinned here: a non-number `value` /
 * `clickedPrice` now 400s instead of being silently stored as
 * null, and a non-string `description` / non-boolean `isPublic`
 * on wishlists now 400s instead of being silently dropped/coerced.
 *
 * NOT wired (documented deviation): POST /api/v1/referrals/attribute
 * deliberately soft-ignores an invalid code (200 + attributed:false)
 * — a strict schema would turn that into a 400 and break the
 * route's stated contract. It stays hand-rolled on purpose.
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import {
  validateBody,
  newsletterSubscribeSchema,
  tokenBodySchema,
  referralSchema,
  productViewSchema,
  analyticsEventSchema,
  affiliateClickSchema,
  mobileWaitlistSchema,
  wishlistSchema,
  recommendationProductSchema,
} from '@/lib/api/validation';

describe('F-P1-60 sweep — the 11 wired routes call validateBody', () => {
  // NARROWING (9 files): these read validation.data, so they must
  // narrow with `if (!validation.success)` — invalidBodyResponse()
  // returns the same 400 but does NOT narrow the discriminated
  // union, so validation.data would not type-check (tsc TS2339).
  // The 400 is identical: first error, same message.
  it.each([
    'app/api/v1/newsletter/subscribe/route.ts',
    'app/api/v1/newsletter/unsubscribe/route.ts',
    'app/api/v1/newsletter/confirm/route.ts',
    'app/api/v1/referrals/click/route.ts',
    'app/api/v1/product-views/route.ts',
    'app/api/v1/analytics/events/route.ts',
    'app/api/v1/affiliate/click/route.ts',
    'app/api/v1/wishlists/route.ts',
    'app/api/v1/recommendations/feedback/route.ts',
  ])('%s calls validateBody and narrows with !validation.success', (file) => {
    const src = fs.readFileSync(`${process.cwd()}/${file}`, 'utf8');
    expect(src).toContain('validateBody(');
    expect(src).toContain('if (!validation.success)');
    expect(src).toContain("return badRequest(firstError ?? 'Invalid request body')");
  });

  // The other 2 wired files never read validation.data (they read
  // `body` directly), so the non-narrowing invalidBodyResponse()
  // pattern is fine there — and stays, to keep the sweep's shape
  // visible in one place.
  it.each([
    'app/api/v1/referrals/route.ts',
    'app/api/v1/mobile-app/waitlist/route.ts',
  ])('%s calls validateBody + invalidBodyResponse', (file) => {
    const src = fs.readFileSync(`${process.cwd()}/${file}`, 'utf8');
    expect(src).toContain('validateBody(');
    expect(src).toContain('invalidBodyResponse(');
  });

  it('referrals/attribute stays unwired on purpose (soft-ignore contract)', () => {
    const src = fs.readFileSync(
      `${process.cwd()}/app/api/v1/referrals/attribute/route.ts`,
      'utf8'
    );
    expect(src).not.toContain('validateBody(');
    expect(src).toContain('Invalid format: ignored silently');
  });
});

describe('F-P1-60 sweep — schemas accept valid bodies, reject wrong types', () => {
  it('newsletterSubscribeSchema', () => {
    expect(validateBody(newsletterSubscribeSchema, { email: 'a@b.com', source: 'footer' }).success).toBe(true);
    expect(validateBody(newsletterSubscribeSchema, { email: 123 }).success).toBe(false);
    expect(validateBody(newsletterSubscribeSchema, {}).success).toBe(true);
  });

  it('tokenBodySchema (newsletter confirm/unsubscribe)', () => {
    expect(validateBody(tokenBodySchema, { token: 'tok-1' }).success).toBe(true);
    expect(validateBody(tokenBodySchema, { token: 123 }).success).toBe(false);
    expect(validateBody(tokenBodySchema, {}).success).toBe(true);
  });

  it('referralSchema', () => {
    expect(validateBody(referralSchema, { code: 'sb-abc', productId: 'p1' }).success).toBe(true);
    expect(validateBody(referralSchema, { code: 123 }).success).toBe(false);
    expect(validateBody(referralSchema, { guestToken: 'gt-1' }).success).toBe(true);
  });

  it('productViewSchema', () => {
    expect(validateBody(productViewSchema, { productId: 'p1' }).success).toBe(true);
    expect(validateBody(productViewSchema, { productId: 42 }).success).toBe(false);
  });

  it('analyticsEventSchema — non-number value now 400s (pinned tightening)', () => {
    expect(
      validateBody(analyticsEventSchema, { eventType: 'view', value: 3, metadata: { a: 1 } }).success
    ).toBe(true);
    expect(validateBody(analyticsEventSchema, { eventType: 'view', value: '3' }).success).toBe(false);
    expect(validateBody(analyticsEventSchema, { eventType: 5 }).success).toBe(false);
  });

  it('affiliateClickSchema — non-number clickedPrice now 400s (pinned tightening)', () => {
    expect(
      validateBody(affiliateClickSchema, { affiliateLinkId: 'l1', clickedPrice: 9.99 }).success
    ).toBe(true);
    expect(validateBody(affiliateClickSchema, { affiliateLinkId: 'l1', clickedPrice: '9.99' }).success).toBe(false);
  });

  it('mobileWaitlistSchema', () => {
    expect(validateBody(mobileWaitlistSchema, { email: 'a@b.com', platform: 'ios' }).success).toBe(true);
    expect(validateBody(mobileWaitlistSchema, { email: 1 }).success).toBe(false);
  });

  it('wishlistSchema — non-string description / non-boolean isPublic now 400s', () => {
    expect(validateBody(wishlistSchema, { name: 'My list', isPublic: true }).success).toBe(true);
    expect(validateBody(wishlistSchema, { name: 'My list', description: 5 }).success).toBe(false);
    expect(validateBody(wishlistSchema, { name: 'My list', isPublic: 'yes' }).success).toBe(false);
  });

  it('recommendationProductSchema', () => {
    expect(validateBody(recommendationProductSchema, { productId: 'p1' }).success).toBe(true);
    expect(validateBody(recommendationProductSchema, { productId: [] }).success).toBe(false);
  });
});
