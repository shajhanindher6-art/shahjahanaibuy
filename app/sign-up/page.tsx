'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Eye, EyeOff } from 'lucide-react';
import { useAuth } from '@/features/auth';
import {
  parseReferralCodeFromSearch,
  storePendingReferralCode,
  peekPendingReferralCode,
  clearPendingReferralCode,
  submitReferralAttribution,
} from '@/lib/referral';
import { AuthShell } from '@/components/layout/auth-shell';
import { GoogleSignInButton } from '@/components/auth/google-sign-in-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { formatCooldownSeconds, useResendCooldown } from '@/lib/auth/resend-cooldown';

export default function SignUpPage() {
  const router = useRouter();
  const { signUp, signInWithGoogle, resendVerification } = useAuth();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  // Section 18, Phase 2, item 2 (audit §1 #11): the confirmation
  // email can be re-sent from here, but only once per 60s —
  // the button is disabled during the cooldown with a visible
  // countdown. The sign-up submit itself is untouched.
  const { remainingSeconds, canSend, startCooldown } = useResendCooldown();

  async function handleResendConfirmation() {
    if (!canSend) return;
    setError('');
    const result = await resendVerification(email);
    if (result.success) {
      setMessage('Confirmation email sent! Check your inbox to confirm your account.');
      startCooldown();
    } else {
      setError(result.error || 'Failed to resend confirmation email');
    }
  }
  const [googleLoading, setGoogleLoading] = useState(false);

  // Section 15, B13 — remember a referral code from `?ref=` so
  // the signup can be attributed to its owner. An invalid code is
  // dropped here (parse returns null); a valid one is stored in
  // localStorage so it survives the email-confirmation redirect
  // and the auth callback can attribute it after sign-in.
  useEffect(() => {
    const code = parseReferralCodeFromSearch(window.location.search);
    if (code) storePendingReferralCode(code);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setMessage('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters long');
      return;
    }

    setLoading(true);
    try {
      const result = await signUp(email, password, fullName);
      if (result.success) {
        if (result.error) {
          // No session yet (email confirmation required) — the
          // code stays stored; /auth/callback attributes it once
          // the user signs in.
          setMessage(result.error);
        } else {
          // Session exists: attribute this signup to the referrer
          // (if any). Best-effort and never blocking — a failed
          // attribution never stops the redirect, and an unknown
          // code is ignored silently by the endpoint.
          const code = peekPendingReferralCode();
          if (code) {
            const outcome = await submitReferralAttribution(code);
            if (outcome !== 'retry') clearPendingReferralCode();
          }
          router.push('/dashboard');
        }
      } else {
        setError(result.error || 'Failed to create account');
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
      title="Create your account"
      description="Start making smarter shopping decisions with AI"
      footer={
        <>
          Already have an account?{' '}
          <Link href="/sign-in" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
        )}
        {message && (
          <div className="rounded-md bg-emerald-500/10 p-3 text-sm text-emerald-600 dark:text-emerald-400">
            {message}
          </div>
        )}
        {message && (
          <div className="text-center">
            <button
              type="button"
              onClick={handleResendConfirmation}
              disabled={!canSend}
              className="text-sm text-muted-foreground hover:text-primary disabled:opacity-50"
            >
              {canSend
                ? "Didn't get the email? Resend confirmation email"
                : `Resend confirmation email in ${formatCooldownSeconds(remainingSeconds)}`}
            </button>
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="fullName">Full Name</Label>
          <Input
            id="fullName"
            type="text"
            placeholder="John Doe"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            autoComplete="name"
          />
        </div>
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
          <Label htmlFor="password">Password</Label>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? 'text' : 'password'}
              placeholder="At least 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="new-password"
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
          {loading ? <LoadingSpinner size="sm" /> : 'Create Account'}
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

      {/* Section 18, item 62 — the same Google button + flow as
          sign-in; a new user no longer has to discover Google after
          creating an account. */}
      <GoogleSignInButton onClick={handleGoogle} loading={googleLoading} />

      <p className="mt-6 text-center text-xs text-muted-foreground">
        By creating an account, you agree to our{' '}
        <Link href="/terms" className="underline hover:text-foreground">
          Terms of Service
        </Link>{' '}
        and{' '}
        <Link href="/privacy" className="underline hover:text-foreground">
          Privacy Policy
        </Link>
        .
      </p>
    </AuthShell>
  );
}
