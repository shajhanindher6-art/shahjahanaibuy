/**
 * Section 18, Phase 2 — UX reliability, component renders +
 * interactions (audit §1 #38–#42, #77–#80).
 *
 * Runs under the jsdom config (vitest.a11y.config.ts) — the main
 * suite is node-only. Mocks mirror tests/a11y-runtime.test.tsx:
 * next/link -> <a>, next/navigation hooks -> controllable stubs,
 * useAuth -> controllable stubs. Pure mapping + static guards live
 * in tests/section18-ux-reliability.test.ts.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import SignInPage from '@/app/sign-in/page';
import SignUpPage from '@/app/sign-up/page';
import { DashboardSidebar } from '@/components/layout/dashboard-sidebar';
import { CountrySwitcher, LanguageSwitcher } from '@/components/region/country-switcher';
import { RegionProvider } from '@/components/region/region-provider';

afterEach(cleanup);

const mockSearchParams = vi.hoisted(() => ({ current: new URLSearchParams() }));
const mockSignIn = vi.hoisted(() => vi.fn());
const mockSignOut = vi.hoisted(() => vi.fn());
const mockRouter = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
  } & Record<string, unknown>) =>
    React.createElement('a', { href, ...props }, children),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => mockRouter,
  useSearchParams: () => mockSearchParams.current,
  useParams: () => ({}),
}));

vi.mock('@/features/auth', () => ({
  useAuth: () => ({
    user: null,
    profile: null,
    role: 'user',
    isLoading: false,
    isAuthenticated: false,
    signIn: mockSignIn,
    signUp: vi.fn().mockResolvedValue({ success: true }),
    signInWithGoogle: vi.fn().mockResolvedValue({ success: true }),
    signOut: mockSignOut,
    resetPassword: vi.fn(),
    updatePassword: vi.fn(),
    resendVerification: vi.fn(),
    refreshProfile: vi.fn(),
  }),
}));

if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as MediaQueryList) as typeof window.matchMedia;
}

function withRegion(children: React.ReactElement) {
  return (
    <RegionProvider initialCountryCode="US" initialLanguage="en">
      {children}
    </RegionProvider>
  );
}

describe('item 58 — session-expired banner', () => {
  it('shows the banner with ?reason=session-expired and hides it without', () => {
    mockSearchParams.current = new URLSearchParams('reason=session-expired');
    const { unmount } = render(withRegion(<SignInPage />));
    expect(screen.getByRole('status').textContent).toContain(
      'Your session expired — please sign in again.'
    );
    unmount();

    mockSearchParams.current = new URLSearchParams();
    render(withRegion(<SignInPage />));
    expect(screen.queryByText(/session expired/i)).toBeNull();
  });
});

describe('item 57 — resend link keys off the mapped error code', () => {
  it('shows "Resend verification email" after an email-not-confirmed failure', async () => {
    mockSearchParams.current = new URLSearchParams();
    mockSignIn.mockResolvedValueOnce({
      success: false,
      error: 'Your email is not confirmed yet. Check your inbox for the confirmation link, or resend it below.',
      errorCode: 'email-not-confirmed',
    });
    render(withRegion(<SignInPage />));
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'a@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'password123' },
    });
    fireEvent.submit(screen.getByRole('button', { name: /sign in/i }).closest('form')!);
    expect(await screen.findByText('Resend verification email')).toBeTruthy();
  });

  it('does not show the resend link for a wrong-password failure', async () => {
    mockSearchParams.current = new URLSearchParams();
    mockSignIn.mockResolvedValueOnce({
      success: false,
      error: 'Incorrect email or password. Check your details and try again.',
      errorCode: 'invalid-credentials',
    });
    render(withRegion(<SignInPage />));
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'a@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'wrong-password' },
    });
    fireEvent.submit(screen.getByRole('button', { name: /sign in/i }).closest('form')!);
    expect(await screen.findByText(/Incorrect email or password/)).toBeTruthy();
    expect(screen.queryByText('Resend verification email')).toBeNull();
  });
});

describe('item 60 — 44px targets and focusable password toggles', () => {
  it('header country + language switchers render at 44px (h-11)', () => {
    const { container } = render(withRegion(<CountrySwitcher />));
    // getByLabelText would also match the role="group" wrapper div;
    // the selects are the interactive targets.
    for (const select of container.querySelectorAll('select[aria-label="Country"]')) {
      expect(select.className).toContain('h-11');
    }
    expect(container.querySelectorAll('select[aria-label="Country"]')).toHaveLength(2);
    cleanup();
    const lang = render(withRegion(<LanguageSwitcher />));
    for (const select of lang.container.querySelectorAll('select[aria-label="Language"]')) {
      expect(select.className).toContain('h-11');
    }
    expect(lang.container.querySelectorAll('select[aria-label="Language"]')).toHaveLength(2);
  });

  it('password toggles are 44px, labelled, and keyboard-reachable on sign-in and sign-up', () => {
    mockSearchParams.current = new URLSearchParams();
    render(withRegion(<SignInPage />));
    const signInToggle = screen.getByLabelText('Show password');
    expect(signInToggle.className).toContain('h-11 w-11');
    expect(signInToggle.getAttribute('tabindex')).toBeNull();
    fireEvent.click(signInToggle);
    expect(screen.getByLabelText('Hide password')).toBeTruthy();
    cleanup();

    render(withRegion(<SignUpPage />));
    const signUpToggle = screen.getByLabelText('Show password');
    expect(signUpToggle.className).toContain('h-11 w-11');
    expect(signUpToggle.getAttribute('tabindex')).toBeNull();
  });
});

describe('item 62 — Google button on sign-up', () => {
  it('renders "Continue with Google" on the sign-up page', () => {
    render(withRegion(<SignUpPage />));
    expect(
      screen.getByRole('button', { name: /Continue with Google/i })
    ).toBeTruthy();
  });
});

describe('item 63 — sidebar links + sign-out confirm', () => {
  it('links /dashboard/vault and /dashboard/saved-searches', () => {
    mockSignOut.mockResolvedValue(undefined);
    render(withRegion(<DashboardSidebar />));
    expect(screen.getByRole('link', { name: 'Vault' }).getAttribute('href')).toBe(
      '/dashboard/vault'
    );
    expect(screen.getByRole('link', { name: 'Saved Searches' }).getAttribute('href')).toBe(
      '/dashboard/saved-searches'
    );
  });

  it('sign-out asks first, cancels cleanly, and redirects on confirm', async () => {
    mockSignOut.mockResolvedValue(undefined);
    mockRouter.replace.mockClear();
    render(withRegion(<DashboardSidebar />));
    expect(screen.queryByRole('alertdialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Sign Out' }));
    expect(screen.getByRole('alertdialog')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Sign Out' }));
    fireEvent.click(screen.getByRole('button', { name: /^Sign out$/ }));
    expect(await screen.findByText('Sign Out')).toBeTruthy();
    expect(mockSignOut).toHaveBeenCalled();
    expect(mockRouter.replace).toHaveBeenCalledWith('/sign-in');
  });

  it('a failed sign-out surfaces an error instead of redirecting', async () => {
    mockSignOut.mockRejectedValueOnce(new Error('network down'));
    mockRouter.replace.mockClear();
    render(withRegion(<DashboardSidebar />));
    fireEvent.click(screen.getByRole('button', { name: 'Sign Out' }));
    fireEvent.click(screen.getByRole('button', { name: /^Sign out$/ }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      "couldn't sign you out"
    );
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });
});
