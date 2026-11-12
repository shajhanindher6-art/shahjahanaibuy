// @vitest-environment jsdom
/**
 * Section 18, item 72 (audit §1 #46), part 1 — the sign-up page
 * flow, rendered for real in jsdom.
 *
 * Before this file no test rendered `app/sign-up/page.tsx` (or
 * sign-in, auth-provider, or /auth/callback). The Supabase
 * boundary is mocked at `useAuth` — no network, no real account.
 *
 * The page's own contract, as coded:
 * - password < 8 chars → client-side error, signUp never called
 * - signUp success WITH a session → router.push('/dashboard')
 * - signUp success WITHOUT a session (email confirmation) →
 *   "Account created! Check your email…" message, NO redirect
 * - signUp failure → the error shown, NO redirect
 *
 * NOTE (file shape): the main vitest config includes only
 * `tests/**\/*.test.ts` with esbuild parsing `.ts` without JSX
 * support, so this file renders with `createElement` (same
 * pattern as tests/bnpl-line.test.ts) instead of JSX syntax.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from '@testing-library/react';

const fakeRouter = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
}));

const fakeAuth = vi.hoisted(() => ({
  signUp: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => fakeRouter,
  usePathname: () => '/sign-up',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('lucide-react', () => {
  // Explicit stubs for the icons this tree renders (Eye/EyeOff
  // on the page, Sparkles in AuthShell, Sun/Moon in ThemeToggle,
  // Loader2 in LoadingSpinner). A Proxy-based mock is NOT usable
  // here: vitest checks named exports against the mock's own
  // keys and throws "No 'Eye' export is defined", and a Proxy
  // that answers `then` makes the mocked namespace thenable and
  // hangs module loading outright.
  const stub = () => null;
  return {
    Eye: stub,
    EyeOff: stub,
    Sparkles: stub,
    Sun: stub,
    Moon: stub,
    Loader2: stub,
  };
});

vi.mock('@/features/auth', () => ({
  useAuth: () => ({
    signUp: (...args: unknown[]) => fakeAuth.signUp(...args),
    user: null,
    isLoading: false,
  }),
}));

// Imported after the mocks so the page uses the fakes.
import SignUpPage from '@/app/sign-up/page';

async function fillAndSubmit(values: {
  fullName: string;
  email: string;
  password: string;
}) {
  fireEvent.change(screen.getByLabelText('Full Name'), {
    target: { value: values.fullName },
  });
  fireEvent.change(screen.getByLabelText('Email'), {
    target: { value: values.email },
  });
  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: values.password },
  });
  fireEvent.click(screen.getByRole('button', { name: /create account/i }));
}

describe('SignUpPage — signup → dashboard flow', () => {
  // The main vitest config does not set `globals: true`, so
  // @testing-library/react does NOT auto-cleanup between tests:
  // without this, every render() appends a second copy of the
  // page to the document and getByRole finds duplicates.
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
    fakeAuth.signUp.mockResolvedValue({ success: true });
  });

  it('renders the signup form (name, email, password, submit, sign-in link)', () => {
    render(createElement(SignUpPage));
    expect(screen.getByText('Create your account')).toBeTruthy();
    expect(screen.getByLabelText('Full Name')).toBeTruthy();
    expect(screen.getByLabelText('Email')).toBeTruthy();
    expect(screen.getByLabelText('Password')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /create account/i })
    ).toBeTruthy();
    expect(screen.getByText('Sign in')).toBeTruthy();
  });

  it('blocks a short password client-side: error shown, signUp never called, no redirect', async () => {
    render(createElement(SignUpPage));
    await fillAndSubmit({
      fullName: 'Test User',
      email: 'test@example.test',
      password: 'short',
    });
    await waitFor(() =>
      expect(
        screen.getByText('Password must be at least 8 characters long')
      ).toBeTruthy()
    );
    expect(fakeAuth.signUp).not.toHaveBeenCalled();
    expect(fakeRouter.push).not.toHaveBeenCalled();
  });

  it('redirects to /dashboard when signup returns a session', async () => {
    fakeAuth.signUp.mockResolvedValue({ success: true });
    render(createElement(SignUpPage));
    await fillAndSubmit({
      fullName: 'Test User',
      email: 'test@example.test',
      password: 'correct-horse-battery',
    });
    await waitFor(() =>
      expect(fakeRouter.push).toHaveBeenCalledWith('/dashboard')
    );
    expect(fakeAuth.signUp).toHaveBeenCalledWith(
      'test@example.test',
      'correct-horse-battery',
      'Test User'
    );
  });

  it('shows the verify-email message and does NOT redirect when signup returns no session', async () => {
    fakeAuth.signUp.mockResolvedValue({
      success: true,
      error: 'Account created! Check your email to confirm your account.',
    });
    render(createElement(SignUpPage));
    await fillAndSubmit({
      fullName: 'Test User',
      email: 'test@example.test',
      password: 'correct-horse-battery',
    });
    await waitFor(() =>
      expect(
        screen.getByText('Account created! Check your email to confirm your account.')
      ).toBeTruthy()
    );
    expect(fakeRouter.push).not.toHaveBeenCalled();
  });

  it('shows the error and does NOT redirect when signup fails', async () => {
    fakeAuth.signUp.mockResolvedValue({
      success: false,
      error: 'Failed to create your account. Check your connection and try again.',
    });
    render(createElement(SignUpPage));
    await fillAndSubmit({
      fullName: 'Test User',
      email: 'test@example.test',
      password: 'correct-horse-battery',
    });
    await waitFor(() =>
      expect(
        screen.getByText(
          'Failed to create your account. Check your connection and try again.'
        )
      ).toBeTruthy()
    );
    expect(fakeRouter.push).not.toHaveBeenCalled();
  });
});
