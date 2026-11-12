/**
 * Section 18, Phase 2 — auth/security hardening (audit §1 #11, #12,
 * #13, #53, #54, #55, #56): items 8, 10, 2, 3, 5, 4, 6.
 *
 * Pure-helper tests + SQL-text assertions + source wiring checks.
 * Route-level behaviour (CSRF 403, Zod 400s, reset-proxy 200/400/429)
 * lives in section18-phase2-auth-routes.test.ts.
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NextRequest } from 'next/server';
import { checkCsrfOrigin } from '@/lib/api/csrf';
import {
  RESEND_COOLDOWN_SECONDS,
  cooldownRemainingSeconds,
  formatCooldownSeconds,
} from '@/lib/auth/resend-cooldown';
import {
  SIGNUP_ALREADY_REGISTERED_MESSAGE,
  mapSignUpErrorMessage,
} from '@/lib/auth/error-messages';
import { getRecoverySessionState, RECOVERY_LINK_EXPIRED_MESSAGE } from '@/lib/auth/recovery-session';
import {
  shouldRedirectToVerifyEmail,
  VERIFY_SKIP_COOKIE,
} from '@/lib/auth/email-verification';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

function csrfRequest(origin: string | null, host = 'localhost'): NextRequest {
  const headers: Record<string, string> = { host };
  if (origin) headers.origin = origin;
  return new NextRequest('http://localhost/api/v1/alerts', {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  });
}

// ---------------------------------------------------------------------------
// Item 8 — CSRF Origin check (audit §1 #12)
// ---------------------------------------------------------------------------
describe('Item 8 — checkCsrfOrigin', () => {
  it('absent Origin passes (fail-open for non-browser clients)', () => {
    expect(checkCsrfOrigin(csrfRequest(null))).toBeNull();
  });

  it('matching Origin host passes', () => {
    expect(checkCsrfOrigin(csrfRequest('http://localhost'))).toBeNull();
    expect(checkCsrfOrigin(csrfRequest('https://localhost'))).toBeNull();
  });

  it('mismatched Origin host → 403', async () => {
    const res = checkCsrfOrigin(csrfRequest('https://evil.example'));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    const body = (await res!.json()) as Record<string, unknown>;
    expect(body.success).toBe(false);
    expect((body.error as Record<string, unknown>).code).toBe('FORBIDDEN');
  });

  it('unparseable Origin → 403', () => {
    const res = checkCsrfOrigin(csrfRequest('not-a-url'));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  it('same host on a different port is a mismatch', () => {
    const res = checkCsrfOrigin(csrfRequest('http://localhost:9999'));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  it('is wired into the cookie-authed mutating routes, and NOT into webhook/cron routes', () => {
    for (const route of [
      'app/api/v1/admin/intake/route.ts',
      'app/api/v1/alerts/route.ts',
      'app/api/v1/subscriptions/route.ts',
      'app/api/v1/subscriptions/checkout/route.ts',
    ]) {
      const src = read(route);
      expect(src).toContain('checkCsrfOrigin');
      expect(src).toContain('checkCsrfOrigin(request)');
    }
    // Webhook + cron routes are not cookie-authed: no Origin check.
    expect(read('app/api/webhooks/stripe/route.ts')).not.toContain('checkCsrfOrigin');
    expect(read('app/api/v1/prices/refresh/route.ts')).not.toContain('checkCsrfOrigin');
  });
});

// ---------------------------------------------------------------------------
// Item 10 — Zod adoption (audit §1 #13)
// ---------------------------------------------------------------------------
describe('Item 10 — validateBody wired into intake, alerts, checkout', () => {
  it('all three routes import and call validateBody', () => {
    for (const route of [
      'app/api/v1/admin/intake/route.ts',
      'app/api/v1/alerts/route.ts',
      'app/api/v1/subscriptions/checkout/route.ts',
    ]) {
      const src = read(route);
      expect(src).toContain("from '@/lib/api/validation'");
      expect(src).toContain('validateBody(');
    }
  });

  it('intake schema validates the envelope only (rows stay per-row reviewed)', () => {
    const src = read('app/api/v1/admin/intake/route.ts');
    expect(src).toContain('intakeJsonBodySchema');
    expect(src).toContain("z.enum(['preview', 'approve'])");
    expect(src).toContain('z.record(z.string(), z.unknown())');
  });
});

// ---------------------------------------------------------------------------
// Item 2 — auth rate-limit proxy / resend cooldown (audit §1 #11)
// ---------------------------------------------------------------------------
describe('Item 2 — resend cooldown helpers', () => {
  it('cooldown is 60s', () => {
    expect(RESEND_COOLDOWN_SECONDS).toBe(60);
  });

  it('no send yet → 0 remaining', () => {
    expect(cooldownRemainingSeconds(null, 1_000_000)).toBe(0);
  });

  it('30s after a send → 30s remaining', () => {
    expect(cooldownRemainingSeconds(1_000_000, 1_030_000)).toBe(30);
  });

  it('after the window → 0 (never negative)', () => {
    expect(cooldownRemainingSeconds(1_000_000, 1_061_000)).toBe(0);
    expect(cooldownRemainingSeconds(1_000_000, 1_500_000)).toBe(0);
  });

  it('formats the countdown as 0:SS', () => {
    expect(formatCooldownSeconds(45)).toBe('0:45');
    expect(formatCooldownSeconds(5)).toBe('0:05');
    expect(formatCooldownSeconds(0)).toBe('0:00');
  });

  it('the cooldown hook is wired into sign-up / forgot-password / verify-email', () => {
    for (const page of [
      'app/sign-up/page.tsx',
      'app/forgot-password/page.tsx',
      'app/verify-email/page.tsx',
    ]) {
      const src = read(page);
      expect(src).toContain('useResendCooldown');
      expect(src).toContain('formatCooldownSeconds');
    }
    // Sign-in has no resend button of its own: its resend path is
    // the /verify-email page (linked from the "not confirmed"
    // error), where the cooldown applies.
    expect(read('app/sign-in/page.tsx')).toContain('/verify-email');
  });

  it('reset proxy route exists, is rate-limited, and validates the email', () => {
    const src = read('app/api/v1/auth/reset-password/route.ts');
    expect(src).toContain('rateLimitResponse(`auth.reset-password:');
    expect(src).toContain('z.string().email(');
    expect(src).toContain('resetPasswordForEmail');
    // The redirect target is always this site's own origin —
    // never a caller-supplied URL (no body/search-param redirect).
    expect(src).toContain('new URL(request.url).origin');
    expect(src).not.toContain('body.redirect');
    expect(src).not.toContain('searchParams');
    expect(src).toContain('/auth/callback?type=recovery');
  });
});

// ---------------------------------------------------------------------------
// Item 3 — 047 INSERT coverage (audit §1 #53, FILE ONLY)
// ---------------------------------------------------------------------------
describe('Item 3 — migration 047 guards profile INSERT', () => {
  const sql = read('supabase/migrations/20261112180000_047_profiles_role_id_change_guard.sql');

  it('still marked DO NOT APPLY and keeps the UPDATE trigger', () => {
    expect(sql).toContain('DO NOT APPLY YET');
    expect(sql).toContain('BEFORE UPDATE ON profiles');
    expect(sql).toContain('prevent_profiles_role_id_change');
  });

  it('replaces profiles_insert_own with a WITH CHECK role_id guard', () => {
    expect(sql).toContain('DROP POLICY IF EXISTS "profiles_insert_own" ON profiles');
    expect(sql).toContain('CREATE POLICY "profiles_insert_own" ON profiles FOR INSERT');
    expect(sql).toContain('WITH CHECK (');
    expect(sql).toContain('auth.uid() = id');
    expect(sql).toContain('role_id IS NULL');
    expect(sql).toContain("roles WHERE name = 'user'");
  });

  it('documents why a policy (not the trigger) and the current_user caveat', () => {
    expect(sql).toContain('INSERT GUARD');
    expect(sql).toContain('current_user');
  });

  it('UPDATE trigger identifies the caller with auth.uid(), not current_user/session_user (Section 18 final fix)', () => {
    // Scope the check to the trigger FUNCTION BODY only: the
    // comments elsewhere in the file still mention current_user
    // (explaining why it must not be used).
    const fnStart = sql.indexOf(
      'CREATE OR REPLACE FUNCTION public.prevent_profiles_role_id_change()'
    );
    expect(fnStart).toBeGreaterThanOrEqual(0);
    const fnBody = sql.slice(fnStart, sql.indexOf('DROP TRIGGER IF EXISTS', fnStart));
    expect(fnBody).toContain('SECURITY DEFINER');
    expect(fnBody).toContain('auth.uid() IS NOT NULL');
    // Caller identification must not use current_user/session_user
    // in EXECUTABLE code — the `--` comment lines above the check
    // explain why current_user was dropped, so strip them first.
    const fnCode = fnBody.replace(/^\s*--.*$/gm, '');
    expect(fnCode).not.toContain('current_user');
    expect(fnCode).not.toContain('session_user');
    // The guard logic itself is unchanged.
    expect(fnBody).toContain('OLD.role_id IS DISTINCT FROM NEW.role_id');
    expect(fnBody).toContain('RAISE EXCEPTION');
  });
});

// ---------------------------------------------------------------------------
// Item 5 — sign-up enumeration message (audit §1 #55)
// ---------------------------------------------------------------------------
describe('Item 5 — already-registered sign-up error is generic', () => {
  it('maps "User already registered" to the generic message', () => {
    expect(mapSignUpErrorMessage('User already registered')).toBe(
      SIGNUP_ALREADY_REGISTERED_MESSAGE
    );
    expect(mapSignUpErrorMessage('user already registered')).toBe(
      SIGNUP_ALREADY_REGISTERED_MESSAGE
    );
  });

  it('the generic message never contains "already registered"', () => {
    expect(SIGNUP_ALREADY_REGISTERED_MESSAGE.toLowerCase()).not.toContain('already registered');
    expect(SIGNUP_ALREADY_REGISTERED_MESSAGE).toContain('confirmation link');
  });

  it('other errors pass through (null = no mapping)', () => {
    expect(mapSignUpErrorMessage('Invalid email')).toBeNull();
    expect(mapSignUpErrorMessage('Password too short')).toBeNull();
    expect(mapSignUpErrorMessage(null)).toBeNull();
    expect(mapSignUpErrorMessage('')).toBeNull();
  });

  it('auth-provider signUp uses the mapper before the generic failure path', () => {
    const src = read('features/auth/auth-provider.tsx');
    expect(src).toContain('mapSignUpErrorMessage');
    expect(src).toContain('return { success: true, error: generic }');
  });
});

// ---------------------------------------------------------------------------
// Item 4 — reset-link expiry UX (audit §1 #54)
// ---------------------------------------------------------------------------
describe('Item 4 — recovery session is checked before the reset form', () => {
  it('loading while auth resolves', () => {
    expect(getRecoverySessionState({ isLoading: true, user: null })).toBe('loading');
    expect(getRecoverySessionState({ isLoading: true, user: { id: 'u1' } })).toBe('loading');
  });

  it('no user after loading → expired', () => {
    expect(getRecoverySessionState({ isLoading: false, user: null })).toBe('expired');
    expect(getRecoverySessionState({ isLoading: false, user: undefined })).toBe('expired');
  });

  it('user present → valid', () => {
    expect(getRecoverySessionState({ isLoading: false, user: { id: 'u1' } })).toBe('valid');
  });

  it('callback page shows the expired message + a /forgot-password link', () => {
    const src = read('app/auth/callback/page.tsx');
    expect(src).toContain('getRecoverySessionState');
    expect(src).toContain('RECOVERY_LINK_EXPIRED_MESSAGE');
    expect(src).toContain("href=\"/forgot-password\"");
    expect(RECOVERY_LINK_EXPIRED_MESSAGE).toContain('expired or is invalid');
  });
});

// ---------------------------------------------------------------------------
// Item 6 — email_confirmed_at dashboard check (audit §1 #56)
// ---------------------------------------------------------------------------
describe('Item 6 — unconfirmed email/password users go to /verify-email', () => {
  const emailUnconfirmed = {
    email_confirmed_at: null,
    app_metadata: { provider: 'email' },
  };
  const emailConfirmed = {
    email_confirmed_at: '2026-11-12T00:00:00Z',
    app_metadata: { provider: 'email' },
  };
  const googleUnconfirmed = {
    email_confirmed_at: null,
    app_metadata: { provider: 'google' },
  };

  it('email provider + unconfirmed → redirect', () => {
    expect(shouldRedirectToVerifyEmail(emailUnconfirmed)).toBe(true);
  });

  it('email provider + confirmed → no redirect', () => {
    expect(shouldRedirectToVerifyEmail(emailConfirmed)).toBe(false);
  });

  it('Google/OAuth users are NEVER redirected', () => {
    expect(shouldRedirectToVerifyEmail(googleUnconfirmed)).toBe(false);
    expect(
      shouldRedirectToVerifyEmail({ email_confirmed_at: null, app_metadata: { provider: 'github' } })
    ).toBe(false);
  });

  it('unknown provider fails open (no redirect)', () => {
    expect(shouldRedirectToVerifyEmail({ email_confirmed_at: null })).toBe(false);
    expect(shouldRedirectToVerifyEmail({ email_confirmed_at: null, identities: [] })).toBe(false);
    expect(shouldRedirectToVerifyEmail(null)).toBe(false);
  });

  it('"Skip for now" is honoured', () => {
    expect(shouldRedirectToVerifyEmail(emailUnconfirmed, { skipped: true })).toBe(false);
  });

  it('dashboard layout wires the check; verify-email skip sets the cookie', () => {
    const layout = read('app/dashboard/layout.tsx');
    expect(layout).toContain('shouldRedirectToVerifyEmail');
    expect(layout).toContain("redirect('/verify-email')");
    expect(layout).toContain('VERIFY_SKIP_COOKIE');
    const verify = read('app/verify-email/page.tsx');
    expect(verify).toContain('setVerifySkippedCookie');
    expect(verify).toContain('Skip for now');
  });
});
