'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/features/auth';
import { AuthShell } from '@/components/layout/auth-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { MailCheck } from 'lucide-react';
import { formatCooldownSeconds, useResendCooldown } from '@/lib/auth/resend-cooldown';
import { setVerifySkippedCookie } from '@/lib/auth/email-verification';

export default function VerifyEmailPage() {
  const { resendVerification, user } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState(user?.email ?? '');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  // Section 18, Phase 2, item 2 (audit §1 #11): the resend button
  // is disabled for a 60s cooldown after each send, with a visible
  // countdown — no hammering Supabase's email endpoint from here.
  const { remainingSeconds, canSend, startCooldown } = useResendCooldown();

  async function handleResend(e: React.FormEvent) {
    e.preventDefault();
    if (!canSend) return;
    setError('');
    setLoading(true);
    try {
      const result = await resendVerification(email);
      if (result.success) {
        setSent(true);
        startCooldown();
      } else {
        setError(result.error || 'Failed to resend verification email');
      }
    } catch {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  // Section 18, Phase 2, item 6: "Skip for now" records a 7-day
  // cookie so the dashboard layout's unconfirmed-email redirect
  // lets the user through instead of bouncing them back here.
  function handleSkip() {
    setVerifySkippedCookie();
    router.push('/dashboard');
  }

  return (
    <AuthShell
      title="Verify your email"
      description="Confirm your email address to complete your account"
    >
      {sent ? (
        <div className="text-center">
          <MailCheck className="mx-auto mb-4 h-12 w-12 text-emerald-500" />
          <h2 className="mb-2 text-lg font-semibold">Verification email sent</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            Check your inbox at <strong>{email}</strong> for a verification link.
          </p>
          <Button
            variant="outline"
            onClick={() => {
              setSent(false);
            }}
            disabled={!canSend}
          >
            {canSend ? 'Resend email' : `Resend email in ${formatCooldownSeconds(remainingSeconds)}`}
          </Button>
        </div>
      ) : (
        <form onSubmit={handleResend} className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
          )}
          <p className="text-sm text-muted-foreground">
            We&apos;ll send a verification link to your email address. Click the link to confirm
            your account.
          </p>
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
          <Button type="submit" className="w-full" disabled={loading || !canSend}>
            {loading
              ? <LoadingSpinner size="sm" />
              : canSend
                ? 'Send Verification Email'
                : `Send Verification Email in ${formatCooldownSeconds(remainingSeconds)}`}
          </Button>
          <div className="text-center">
            <button
              type="button"
              onClick={handleSkip}
              className="text-sm text-muted-foreground hover:text-primary"
            >
              Skip for now
            </button>
          </div>
        </form>
      )}
    </AuthShell>
  );
}
