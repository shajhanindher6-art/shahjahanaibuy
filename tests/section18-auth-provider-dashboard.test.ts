// @vitest-environment jsdom
/**
 * Section 18, item 72 (audit §1 #46), part 2 — the signup →
 * dashboard flow at its two other ends: the AuthProvider
 * `signUp` boundary (mocked Supabase browser client) and the
 * dashboard server guard.
 *
 * Before this file no test imported
 * `features/auth/auth-provider.tsx` or exercised the dashboard
 * layout guard; the signup page itself is covered in
 * tests/section18-signup-page.test.ts.
 *
 * Contracts pinned here (as coded):
 * - AuthProvider.signUp passes { email, password,
 *   options: { data: { full_name } } } to
 *   supabase.auth.signUp and returns { success: true } when a
 *   session comes back, { success: true, error: <verify-email
 *   message> } when it does not, { success: false, error }
 *   when Supabase errors — the three shapes the sign-up page
 *   branches on (redirect / message / error).
 * - DashboardLayout: no user → redirect('/sign-in?reason=
 *   session-expired') (thrown, as Next's redirect() works); an
 *   unconfirmed email/password user → redirect('/verify-email')
 *   unless they skipped verification (sb_verify_skipped cookie);
 *   a confirmed user → the DashboardShell element with the
 *   caller's children. (The verify-email gate is Section 18
 *   Phase 2 item 6 — it landed in the layout while this file
 *   was being written; the first version of this test only knew
 *   the plain sign-in redirect, and the failing run is what
 *   surfaced the new gate.)
 *
 * NOTE (file shape): `.test.ts` cannot contain JSX, so rendering
 * uses `createElement` (same pattern as tests/bnpl-line.test.ts).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createElement } from 'react';
import { render, act } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';

const fakeBrowser = vi.hoisted(() => ({
  signUp: vi.fn(),
  session: null as { user: { id: string; email?: string } } | null,
}));

const fakeServerSession = vi.hoisted(() => ({
  user: null as {
    id: string;
    email_confirmed_at?: string | null;
    app_metadata?: { provider?: string };
  } | null,
  skipCookie: false,
}));

vi.mock('next/headers', () => ({
  cookies: () => ({
    get: (name: string) =>
      name === 'sb_verify_skipped' && fakeServerSession.skipCookie
        ? { value: '1' }
        : undefined,
  }),
}));

vi.mock('@/lib/supabase/client', () => ({
  getSupabaseBrowserClient: () => ({
    auth: {
      signUp: (...args: unknown[]) => fakeBrowser.signUp(...args),
      getSession: async () => ({ data: { session: fakeBrowser.session } }),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: () => undefined } },
      }),
    },
  }),
}));

vi.mock('@/services/profiles', () => ({
  getProfile: async () => null,
}));

vi.mock('@/lib/guest-merge', () => ({
  runGuestMerge: async () => undefined,
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: fakeServerSession.user },
        error: null,
      }),
    },
  }),
}));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

// Imported after the mocks so the modules under test use the fakes.
import { AuthProvider, useAuth } from '@/features/auth';
import type { AuthContextValue, AuthResult } from '@/types/auth';
import DashboardLayout from '@/app/dashboard/layout';
import DashboardShell from '@/components/layout/dashboard-shell';

describe('AuthProvider.signUp — Supabase boundary', () => {
  let captured: AuthContextValue | undefined;

  function Probe() {
    captured = useAuth();
    return null;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    captured = undefined;
    fakeBrowser.session = null;
    fakeBrowser.signUp.mockResolvedValue({
      data: {
        user: { id: 'new-user-1', email: 'new@example.test' },
        session: { user: { id: 'new-user-1' } },
      },
      error: null,
    });
    render(createElement(AuthProvider, null, createElement(Probe)));
  });

  it('passes email/password/full_name to supabase.auth.signUp and returns success with a session', async () => {
    let result: AuthResult | undefined;
    await act(async () => {
      result = await captured?.signUp(
        'new@example.test',
        'correct-horse-battery',
        'New User'
      );
    });
    expect(fakeBrowser.signUp).toHaveBeenCalledWith({
      email: 'new@example.test',
      password: 'correct-horse-battery',
      options: { data: { full_name: 'New User' } },
    });
    expect(result).toEqual({ success: true });
  });

  it('returns success + the verify-email message when no session comes back (confirmation required)', async () => {
    fakeBrowser.signUp.mockResolvedValue({
      data: { user: { id: 'new-user-1' }, session: null },
      error: null,
    });
    let result: AuthResult | undefined;
    await act(async () => {
      result = await captured?.signUp(
        'new@example.test',
        'correct-horse-battery',
        'New User'
      );
    });
    expect(result).toEqual({
      success: true,
      error: 'Account created! Check your email to confirm your account.',
    });
  });

  it('returns success + a generic message when the email is already registered (enumeration protection, item 5)', async () => {
    // Section 18 Phase 2 item 5 (audit §1 #55): Supabase's
    // "User already registered" would let an attacker enumerate
    // registered emails, so signUp maps it to the same generic
    // "check your email" wording a fresh sign-up shows — reported
    // as success-with-message, indistinguishable from a new
    // account creation. The raw "already registered" text must
    // never surface.
    fakeBrowser.signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: 'User already registered' },
    });
    let result: AuthResult | undefined;
    await act(async () => {
      result = await captured?.signUp(
        'taken@example.test',
        'correct-horse-battery',
        'Taken User'
      );
    });
    expect(result).toEqual({
      success: true,
      error: "If this email is registered, you'll receive a confirmation link",
    });
    expect(result?.error).not.toContain('already registered');
  });

  it('returns success:false with a mapped message for any other signup error', async () => {
    fakeBrowser.signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: 'Database error saving new user' },
    });
    let result: AuthResult | undefined;
    await act(async () => {
      result = await captured?.signUp(
        'new@example.test',
        'correct-horse-battery',
        'New User'
      );
    });
    expect(result?.success).toBe(false);
    expect(typeof result?.error).toBe('string');
    expect((result?.error as string).length).toBeGreaterThan(0);
    // Never the raw provider text.
    expect(result?.error).not.toContain('Database error saving new user');
  });
});

describe('DashboardLayout — server guard (signup → dashboard, second end)', () => {
  beforeEach(() => {
    fakeServerSession.user = null;
    fakeServerSession.skipCookie = false;
  });

  it('redirects an anonymous visitor to /sign-in with the session-expired reason (redirect throws, as Next does)', async () => {
    await expect(
      DashboardLayout({ children: createElement('p', null, 'dash-kid') })
    ).rejects.toThrow('/sign-in?reason=session-expired');
  });

  it('redirects an unconfirmed email/password user to /verify-email (item 6 gate)', async () => {
    fakeServerSession.user = {
      id: 'test-user-1',
      email_confirmed_at: null,
      app_metadata: { provider: 'email' },
    };
    await expect(
      DashboardLayout({ children: createElement('p', null, 'dash-kid') })
    ).rejects.toThrow('/verify-email');
  });

  it('lets an unconfirmed user through when they skipped verification (sb_verify_skipped cookie)', async () => {
    fakeServerSession.user = {
      id: 'test-user-1',
      email_confirmed_at: null,
      app_metadata: { provider: 'email' },
    };
    fakeServerSession.skipCookie = true;
    const el = await DashboardLayout({
      children: createElement('p', null, 'dash-kid'),
    });
    expect(el.type).toBe(DashboardShell);
  });

  it('renders the shell with the callers children for a confirmed signed-in user', async () => {
    fakeServerSession.user = {
      id: 'test-user-1',
      email_confirmed_at: '2026-11-01T00:00:00.000Z',
      app_metadata: { provider: 'email' },
    };
    const el = await DashboardLayout({
      children: createElement('p', null, 'dash-kid'),
    });
    expect(el.type).toBe(DashboardShell);
    // The shell itself is a client component (needs its providers);
    // render the children the guard passed through instead.
    const html = renderToStaticMarkup(
      createElement('div', null, el.props.children)
    );
    expect(html).toContain('dash-kid');
  });
});
