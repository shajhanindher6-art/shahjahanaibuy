// @vitest-environment jsdom
/**
 * PostHog 5-event analytics — sign-up page event tests.
 *
 * Renders `app/sign-up/page.tsx` for real in jsdom (same pattern as
 * tests/section18-signup-page.test.ts: the Supabase boundary is
 * mocked at `useAuth`, no network, no real account). The tracker is
 * mocked so the test asserts the CALL SITE, not the tracker itself
 * (the tracker has its own unit tests).
 *
 * The page's contract, as coded:
 * - signUp success WITH a session → user_signed_up fires once
 *   ({method:'email', success:true}) + router.push('/dashboard');
 * - signUp success WITHOUT a session (email confirmation required)
 *   → NO event, NO redirect (the account is not a completed signup);
 * - signUp success for an already-registered email (the
 *   anti-enumeration shape: success + a generic message) → NO event
 *   (it is not a new signup);
 * - signUp failure → NO event, NO redirect;
 * - Google sign-up → NO event here (signInWithGoogle only starts
 *   the OAuth redirect; the account is created via /auth/callback).
 *
 * (A throwing tracker is NOT tested here: the real trackEvent
 * never throws by contract — its own unit tests prove that a
 * throwing capture() is swallowed. A mock that throws would test
 * the mock, not the page.)
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
  signInWithGoogle: vi.fn(),
  resendVerification: vi.fn(),
}));

const fakeTrack = vi.hoisted(() => ({
  trackEvent: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => fakeRouter,
  usePathname: () => '/sign-up',
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
    signUp: (...args: unknown[]) => fakeAuth.signUp(...args),
    signInWithGoogle: (...args: unknown[]) =>
      fakeAuth.signInWithGoogle(...args),
    resendVerification: (...args: unknown[]) =>
      fakeAuth.resendVerification(...args),
    user: null,
    isLoading: false,
  }),
}));

vi.mock('@/components/analytics/track-event', () => ({
  trackEvent: (...args: unknown[]) => fakeTrack.trackEvent(...args),
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

describe('SignUpPage — user_signed_up event', () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
    fakeAuth.signUp.mockResolvedValue({ success: true });
    fakeAuth.signInWithGoogle.mockResolvedValue({ success: true });
  });

  it('fires user_signed_up exactly once on a full success (session exists), then redirects', async () => {
    render(createElement(SignUpPage));
    await fillAndSubmit({
      fullName: 'Test User',
      email: 'test@example.test',
      password: 'correct-horse-battery',
    });
    await waitFor(
      () => expect(fakeRouter.push).toHaveBeenCalledWith('/dashboard'),
      { timeout: 5000 }
    );
    expect(fakeTrack.trackEvent).toHaveBeenCalledTimes(1);
    expect(fakeTrack.trackEvent).toHaveBeenCalledWith('user_signed_up', {
      method: 'email',
      success: true,
    });
    // No personal data in the event: no email, no password, no name.
    const props = fakeTrack.trackEvent.mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(Object.keys(props).sort()).toEqual(['method', 'success']);
  });

  it('does NOT fire when signup fails', async () => {
    fakeAuth.signUp.mockResolvedValue({
      success: false,
      error: 'Failed to create your account.',
    });
    render(createElement(SignUpPage));
    await fillAndSubmit({
      fullName: 'Test User',
      email: 'test@example.test',
      password: 'correct-horse-battery',
    });
    await waitFor(
      () =>
        expect(
          screen.getByText('Failed to create your account.')
        ).toBeTruthy(),
      { timeout: 5000 }
    );
    expect(fakeTrack.trackEvent).not.toHaveBeenCalled();
    expect(fakeRouter.push).not.toHaveBeenCalled();
  });

  it('does NOT fire when signup succeeds without a session (email confirmation required)', async () => {
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
    await waitFor(
      () =>
        expect(
          screen.getByText(
            'Account created! Check your email to confirm your account.'
          )
        ).toBeTruthy(),
      { timeout: 5000 }
    );
    expect(fakeTrack.trackEvent).not.toHaveBeenCalled();
    expect(fakeRouter.push).not.toHaveBeenCalled();
  });

  it('does NOT fire for an already-registered email (anti-enumeration success+message shape)', async () => {
    // The auth provider returns this same success+message shape for
    // an existing email so an attacker cannot enumerate accounts.
    // It is not a new signup, so it must not be counted as one.
    fakeAuth.signUp.mockResolvedValue({
      success: true,
      error: 'Account created! Check your email to confirm your account.',
    });
    render(createElement(SignUpPage));
    await fillAndSubmit({
      fullName: 'Test User',
      email: 'existing@example.test',
      password: 'correct-horse-battery',
    });
    await waitFor(
      () =>
        expect(
          screen.getByText(
            'Account created! Check your email to confirm your account.'
          )
        ).toBeTruthy(),
      { timeout: 5000 }
    );
    expect(fakeTrack.trackEvent).not.toHaveBeenCalled();
  });

  it('does NOT fire for Google sign-up (OAuth only starts here; the account is created via /auth/callback)', async () => {
    render(createElement(SignUpPage));
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
