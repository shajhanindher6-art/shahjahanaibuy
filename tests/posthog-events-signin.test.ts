// @vitest-environment jsdom
/**
 * PostHog 5-event analytics — sign-in page event tests.
 *
 * Renders `app/sign-in/page.tsx` for real in jsdom (same pattern as
 * tests/section18-signup-page.test.ts: the Supabase boundary is
 * mocked at `useAuth`, no network, no real account). The tracker is
 * mocked so the test asserts the CALL SITE, not the tracker itself
 * (the tracker has its own unit tests).
 *
 * The page's contract, as coded:
 * - signIn success → user_logged_in fires once
 *   ({method:'email', success:true}) + router.push('/dashboard');
 * - signIn failure → NO event, NO redirect (failed logins are never
 *   tracked);
 * - Google sign-in → NO event here (signInWithGoogle only starts
 *   the OAuth redirect; the session is established via
 *   /auth/callback).
 *
 * (A throwing tracker is NOT tested here: the real trackEvent
 * never throws by contract — its own unit tests prove that a
 * throwing capture() is swallowed. A mock that throws would test
 * the mock, not the page.)
 *
 * The page reads `useRegion()` for the submit label, so the region
 * provider is mocked to English (no RegionProvider in this test).
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
  signIn: vi.fn(),
  signInWithGoogle: vi.fn(),
}));

const fakeTrack = vi.hoisted(() => ({
  trackEvent: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => fakeRouter,
  usePathname: () => '/sign-in',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('lucide-react', () => {
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
    signIn: (...args: unknown[]) => fakeAuth.signIn(...args),
    signInWithGoogle: (...args: unknown[]) =>
      fakeAuth.signInWithGoogle(...args),
    user: null,
    isLoading: false,
  }),
}));

vi.mock('@/components/region/region-provider', () => ({
  useRegion: () => ({ language: 'en' }),
}));

vi.mock('@/components/analytics/track-event', () => ({
  trackEvent: (...args: unknown[]) => fakeTrack.trackEvent(...args),
}));

// Imported after the mocks so the page uses the fakes.
import SignInPage from '@/app/sign-in/page';

async function fillAndSubmit(values: { email: string; password: string }) {
  fireEvent.change(screen.getByLabelText('Email'), {
    target: { value: values.email },
  });
  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: values.password },
  });
  fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
}

describe('SignInPage — user_logged_in event', () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
    fakeAuth.signIn.mockResolvedValue({ success: true });
    fakeAuth.signInWithGoogle.mockResolvedValue({ success: true });
  });

  it('fires user_logged_in exactly once on success, then redirects', async () => {
    render(createElement(SignInPage));
    await fillAndSubmit({
      email: 'test@example.test',
      password: 'correct-horse-battery',
    });
    await waitFor(
      () => expect(fakeRouter.push).toHaveBeenCalledWith('/dashboard'),
      { timeout: 5000 }
    );
    expect(fakeTrack.trackEvent).toHaveBeenCalledTimes(1);
    expect(fakeTrack.trackEvent).toHaveBeenCalledWith('user_logged_in', {
      method: 'email',
      success: true,
    });
    // No personal data in the event: no email, no password, no token.
    const props = fakeTrack.trackEvent.mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(Object.keys(props).sort()).toEqual(['method', 'success']);
  });

  it('does NOT fire when sign-in fails (failed logins are never tracked)', async () => {
    fakeAuth.signIn.mockResolvedValue({
      success: false,
      error: 'Invalid email or password.',
    });
    render(createElement(SignInPage));
    await fillAndSubmit({
      email: 'test@example.test',
      password: 'wrong-password',
    });
    await waitFor(
      () => expect(screen.getByText('Invalid email or password.')).toBeTruthy(),
      { timeout: 5000 }
    );
    expect(fakeTrack.trackEvent).not.toHaveBeenCalled();
    expect(fakeRouter.push).not.toHaveBeenCalled();
  });

  it('does NOT fire for Google sign-in (OAuth only starts here; the session is established via /auth/callback)', async () => {
    render(createElement(SignInPage));
    fireEvent.click(
      screen.getByRole('button', { name: /continue with google/i })
    );
    await waitFor(
      () => expect(fakeAuth.signInWithGoogle).toHaveBeenCalled(),
      { timeout: 5000 }
    );
    expect(fakeTrack.trackEvent).not.toHaveBeenCalled();
  });
});
