'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AuthShell } from '@/components/layout/auth-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { CheckCircle2 } from 'lucide-react';
import { formatCooldownSeconds, useResendCooldown } from '@/lib/auth/resend-cooldown';

export default function ForgotPasswordPage() {
  // Section 18, Phase 2, item 2 (audit §1 #11): the reset request
  // goes through the rate-limited proxy route
  // POST /api/v1/auth/reset-password (5/min per IP) instead of
  // calling Supabase directly from the browser, and the send button
  // is disabled for a 60s cooldown after each send with a visible
  // countdown. The flow itself is unchanged: Supabase still sends
  // the email and the link still lands on /auth/callback.
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const { remainingSeconds, canSend, startCooldown } = useResendCooldown();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSend) return;
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/v1/auth/reset-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (res.status === 429) {
        setError('Too many reset requests. Please wait a minute and try again.');
        return;
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setError(data?.error?.message || 'Failed to send reset email');
        return;
      }
      setSent(true);
      startCooldown();
    } catch {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="Forgot password"
      description="Enter your email to receive a password reset link"
      footer={
        <Link href="/sign-in" className="font-medium text-primary hover:underline">
          Back to sign in
        </Link>
      }
    >
      {sent ? (
        <div className="text-center">
          <CheckCircle2 className="mx-auto mb-4 h-12 w-12 text-emerald-500" />
          <h2 className="mb-2 text-lg font-semibold">Check your email</h2>
          <p className="text-sm text-muted-foreground">
            We&apos;ve sent a password reset link to <strong>{email}</strong>. Follow the link in
            the email to reset your password.
          </p>
          <div className="mt-6">
            <Button
              variant="outline"
              onClick={handleSubmit}
              disabled={loading || !canSend}
            >
              {loading
                ? <LoadingSpinner size="sm" />
                : canSend
                  ? 'Resend reset link'
                  : `Resend reset link in ${formatCooldownSeconds(remainingSeconds)}`}
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
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
          <Button type="submit" className="w-full" disabled={loading || !canSend}>
            {loading
              ? <LoadingSpinner size="sm" />
              : canSend
                ? 'Send Reset Link'
                : `Send Reset Link in ${formatCooldownSeconds(remainingSeconds)}`}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
