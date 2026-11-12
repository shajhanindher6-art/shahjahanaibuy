/**
 * Section 18, Phase 2 — UX reliability (audit §1 #38–#42, #77–#80).
 *
 * Pure mapping tests + static guards in the repo's existing
 * static-assertion style (read the source, assert on it — same as
 * tests/a11y-static.test.ts). Component renders + interactions live
 * in tests/section18-ux-jsdom.test.tsx (jsdom config); axe checks
 * in tests/a11y-runtime.test.tsx.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mapAuthError, mapOAuthError } from '@/features/auth/auth-errors';

const src = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

// Raw Supabase / provider wording that must never surface to a user.
const RAW_AUTH_TEXT = [
  'Invalid login credentials',
  'Email not confirmed',
  'User already registered',
];

describe('item 57 — auth-error mapping', () => {
  it.each([
    ['invalid-credentials', { code: 'invalid_credentials', message: 'Invalid login credentials' }],
    ['invalid-credentials', { message: 'Invalid login credentials' }],
    ['email-not-confirmed', { code: 'email_not_confirmed', message: 'Email not confirmed' }],
    ['email-not-confirmed', { message: 'Email not confirmed' }],
    ['invalid-email', { message: 'Invalid email address' }],
    ['weak-password', { message: 'Password should be at least 6 characters' }],
    ['weak-password', { message: 'Password is too short' }],
    ['user-not-found', { message: 'User not found' }],
    ['too-many-requests', { message: 'Too many requests' }],
    ['too-many-requests', { message: 'Email rate limit exceeded' }],
    ['expired-link', { message: 'Token has expired' }],
    ['already-registered', { message: 'User already registered' }],
  ])('maps %s from %j', (code, error) => {
    const mapped = mapAuthError(error as { code?: string; message?: string });
    expect(mapped.code).toBe(code);
    for (const raw of RAW_AUTH_TEXT) expect(mapped.message).not.toContain(raw);
    // Every mapped message is plain English with a next step.
    expect(mapped.message.length).toBeGreaterThan(20);
  });

  it('maps a plain string message and an unknown error to the generic fallback', () => {
    expect(mapAuthError('Invalid login credentials').code).toBe('invalid-credentials');
    const unknown = mapAuthError({ message: 'Something odd happened in the database' });
    expect(unknown.code).toBe('generic');
    expect(unknown.message).toContain('try again');
    expect(mapAuthError(null).code).toBe('generic');
    expect(mapAuthError(undefined, 'Custom fallback').message).toBe('Custom fallback');
  });

  it('the provider returns mapped copy, never error.message verbatim', () => {
    const provider = src('features/auth/auth-provider.tsx');
    expect(provider).toContain('mapAuthError');
    expect(provider).toContain('authFailure(');
    expect(provider).not.toContain('error: error.message');
    expect(provider).not.toContain('err.message');
  });

  it('the sign-in page keys the resend link off the error code, not the message text', () => {
    const page = src('app/sign-in/page.tsx');
    expect(page).toContain("errorCode === 'email-not-confirmed'");
    expect(page).not.toContain("includes('not confirmed')");
  });
});

describe('item 58 — session-expired notice', () => {
  it('all three guarded layouts redirect with ?reason=session-expired', () => {
    for (const layout of [
      'app/dashboard/layout.tsx',
      'app/admin/layout.tsx',
      'app/owner/layout.tsx',
    ]) {
      expect(src(layout)).toContain("redirect('/sign-in?reason=session-expired')");
    }
  });

  it('the sign-in page renders a banner for ?reason=session-expired', () => {
    const page = src('app/sign-in/page.tsx');
    expect(page).toContain("searchParams.get('reason') === 'session-expired'");
    expect(page).toContain('Your session expired — please sign in again.');
  });
});

describe('item 59 — OAuth error mapping', () => {
  it('maps access_denied to the cancel copy', () => {
    const mapped = mapOAuthError('access_denied', 'The user denied your request');
    expect(mapped.message).toBe(
      'You cancelled Google sign-in. Try again, or sign in with your email and password instead.'
    );
    expect(mapped.message).not.toContain('denied your request');
  });

  it('maps other known codes and never returns the raw description', () => {
    expect(mapOAuthError('server_error', 'Internal server error').message).toContain(
      'Google sign-in is having a problem'
    );
    expect(
      mapOAuthError('temporarily_unavailable', 'Service unavailable').message
    ).toContain('temporarily unavailable');
    const unknown = mapOAuthError('weird_code', 'Some provider wording here');
    expect(unknown.message).toContain('Google sign-in did not work');
    expect(unknown.message).not.toContain('Some provider wording');
    expect(mapOAuthError(null, null).message).toContain('Google sign-in did not work');
  });

  it('the callback page renders the mapped message, not errorDescription', () => {
    const page = src('app/auth/callback/page.tsx');
    expect(page).toContain('mapOAuthError');
    expect(page).toContain('oauthErrorMessage');
    expect(page).not.toMatch(/\{errorDescription \|\|/);
  });
});

describe('item 60 — sub-44px elements', () => {
  it('header country + language switchers are 44px (h-11)', () => {
    expect(src('components/region/country-switcher.tsx')).toContain("'h-11 ");
    expect(src('components/region/country-switcher.tsx')).not.toContain("'h-8 ");
  });

  it('password toggles are 44px, labelled, and keyboard-reachable (no tabIndex={-1})', () => {
    for (const page of ['app/sign-in/page.tsx', 'app/sign-up/page.tsx']) {
      const s = src(page);
      expect(s).toContain('h-11 w-11 -translate-y-1/2');
      expect(s).toContain("aria-label={showPassword ? 'Hide password' : 'Show password'}");
      expect(s).not.toContain('tabIndex={-1}');
    }
  });

  it('text inputs stay at 40px (h-10) — accepted as-is, untouched', () => {
    expect(src('components/ui/input.tsx')).toContain('h-10');
  });
});

describe('item 62 — Google button on sign-up', () => {
  it('sign-up reuses the shared Google button from sign-in', () => {
    const button = src('components/auth/google-sign-in-button.tsx');
    expect(button).toContain('Continue with Google');
    const signUp = src('app/sign-up/page.tsx');
    expect(signUp).toContain('GoogleSignInButton');
    expect(signUp).toContain('signInWithGoogle');
    const signIn = src('app/sign-in/page.tsx');
    expect(signIn).toContain('GoogleSignInButton');
  });
});

describe('item 63 — sidebar links + sign-out confirm', () => {
  it('the sidebar links /dashboard/vault and /dashboard/saved-searches, and both pages exist', () => {
    const sidebar = src('components/layout/dashboard-sidebar.tsx');
    expect(sidebar).toContain("'/dashboard/vault'");
    expect(sidebar).toContain("'/dashboard/saved-searches'");
    expect(existsSync(join(process.cwd(), 'app/dashboard/vault/page.tsx'))).toBe(true);
    expect(existsSync(join(process.cwd(), 'app/dashboard/saved-searches/page.tsx'))).toBe(true);
  });

  it('sign-out asks first and surfaces an error instead of silently redirecting', () => {
    const sidebar = src('components/layout/dashboard-sidebar.tsx');
    expect(sidebar).toContain('showSignOutConfirm');
    expect(sidebar).toContain('role="alertdialog"');
    expect(sidebar).toContain("couldn't sign you out");
  });
});

describe('item 64 — loading.tsx for the priority missing segments', () => {
  const EXPECTED = [
    'app/products/loading.tsx',
    'app/admin/loading.tsx',
    'app/admin/intake/loading.tsx',
    'app/admin/intake/ebay/loading.tsx',
    ...[
      'api-keys',
      'billing',
      'chat',
      'notifications',
      'profile',
      'recommendations',
      'settings',
      'tracking',
      'vault',
      'wishlists',
    ].map((d) => `app/dashboard/${d}/loading.tsx`),
    ...[
      'best-time-calendar',
      'budget-finder',
      'coupons-cashback',
      'currency-converter',
      'deal-checker',
      'eco-coach',
      'emi-calculator',
      'expense-tracker',
      'forecast-explainer',
      'future-you-planner',
      'gift-splitter',
      'help-me-choose',
      'landed-cost',
      'list-optimizer',
      'monthly-planner',
      'price-alert-simulator',
      'price-drop-digest',
      'price-history',
      'price-protection',
      'product-qa',
      'savings-dashboard',
      'smart-home-agent',
      'store-finder',
      'subscription-manager',
      'trade-in-finder',
      'warranty-claim-helper',
    ].map((t) => `app/tools/${t}/loading.tsx`),
  ];

  it('all 40 priority loading.tsx files exist and are skeletons with a status role', () => {
    expect(EXPECTED).toHaveLength(40);
    for (const rel of EXPECTED) {
      expect(existsSync(join(process.cwd(), rel)), `${rel} missing`).toBe(true);
      const content = src(rel);
      expect(content).toContain('role="status"');
      expect(content).toContain('Skeleton');
      expect(content).toContain('export default function Loading()');
    }
  });
});

describe('item 65 — generic error copy', () => {
  it('no bare generic error copy is shown in the waitlist form or push opt-in prompt', () => {
    for (const file of [
      'components/mobile-app/waitlist-form.tsx',
      'components/home/push-opt-in-prompt.tsx',
    ]) {
      const content = src(file);
      // User-facing strings only: the waitlist form legitimately
      // filters the API's old generic fallback by comparing against
      // it, so assert no string literal is *shown* instead.
      expect(content).not.toContain("setMessage('Something went wrong");
      expect(content).not.toContain("return 'Something went wrong");
      expect(content).not.toContain('return "Something went wrong');
    }
    expect(src('components/mobile-app/waitlist-form.tsx')).toContain('check your connection');
    expect(src('components/home/push-opt-in-prompt.tsx')).toContain(
      "couldn't turn on push alerts"
    );
  });

  it('the store finder never renders a raw error state', () => {
    const page = src('app/tools/store-finder/page.tsx');
    expect(page).not.toMatch(/\{error\}/);
    expect(page).not.toContain('Something went wrong');
  });
});
