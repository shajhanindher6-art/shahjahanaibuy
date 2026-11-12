'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Eye, EyeOff } from 'lucide-react';
import { useAuth } from '@/features/auth';
import type { AuthErrorCode } from '@/features/auth/auth-errors';
import { isSafeRedirectPath } from '@/lib/utils/safe-redirect';
import { AuthShell } from '@/components/layout/auth-shell';
import { GoogleSignInButton } from '@/components/auth/google-sign-in-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { tFor } from '@/lib/i18n';
import { useRegion } from '@/components/region/region-provider';

function SignInContent() {
  // Section 16, #42: the submit label renders through tFor
  // (existing key only) like the deals page.
  const { language } = useRegion();
  const router = useRouter();
  const searchParams = useSearchParams();
  // Only same-origin paths are honoured (see lib/utils/safe-redirect.ts):
  // an unvalidated `?redirect=https://evil.example` used to send a
  // freshly signed-in user to an attacker's page (open redirect).
  const redirectParam = searchParams.get('redirect');
  const redirect = isSafeRedirectPath(redirectParam) ? (redirectParam as string) : '/dashboard';
  // Section 18, item 58 — a layout guard redirects here with
  // ?reason=session-expired when the session ends mid-use.
  const sessionExpired = searchParams.get('reason') === 'session-expired';
  const { signIn, signInWithGoogle } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  // Section 18, item 57 — the mapped error code from the provider,
  // so the resend link keys off the code, not the message text.
  const [errorCode, setErrorCode] = useState<AuthErrorCode | null>(null);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setErrorCode(null);
    setLoading(true);
    try {
      const result = await signIn(email, password);
      if (result.success) {
        router.push(redirect);
      } else {
        setError(result.error || 'Failed to sign in');
        setErrorCode(result.errorCode ?? null);
      }
    } catch {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setError('');
    setGoogleLoading(true);
    try {
      const result = await signInWithGoogle();
      if (!result.success) {
        setError(result.error || 'Google Sign-In is not available');
        setGoogleLoading(false);
      }
    } catch {
      setError('Google Sign-In is not available. Please use email/password.');
      setGoogleLoading(false);
    }
  }

  return (
    <AuthShell
      title="Welcome back"
      description="Sign in to your SmartBuy AI account"
      footer={
        <>
          Don&apos;t have an account?{' '}
          <Link href="/sign-up" className="font-medium text-primary hover:underline">
            Sign up
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {sessionExpired && (
          <div
            role="status"
            className="rounded-md bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400"
          >
            Your session expired — please sign in again.
          </div>
        )}
        {error && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {error}
            {/* Section 18, item 57 — the resend link keys off the
                mapped error code, not the raw message text (the old
                `'not confirmed'` string-match broke if Supabase
                ever reworded the message). */}
            {errorCode === 'email-not-confirmed' && (
              <div className="mt-2">
                <Link href="/verify-email" className="font-medium underline">
                  Resend verification email
                </Link>
              </div>
            )}
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link
              href="/forgot-password"
              className="text-xs text-muted-foreground hover:text-primary"
            >
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? 'text' : 'password'}
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="pr-14"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setShowPassword((s) => !s)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className="absolute right-3 top-1/2 h-11 w-11 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showPassword ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? <LoadingSpinner size="sm" /> : tFor(language, 'navSignIn')}
        </Button>
      </form>

      <div className="relative my-6">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-card px-2 text-muted-foreground">Or continue with</span>
        </div>
      </div>

      <GoogleSignInButton onClick={handleGoogle} loading={googleLoading} />
    </AuthShell>
  );
}

export default function SignInPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <LoadingSpinner size="lg" />
        </div>
      }
    >
      <SignInContent />
    </Suspense>
  );
}
