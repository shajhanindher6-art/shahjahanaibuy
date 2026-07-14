'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/features/auth';
import { AuthShell } from '@/components/layout/auth-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { MailCheck } from 'lucide-react';

export default function VerifyEmailPage() {
  const { resendVerification, user } = useAuth();
  const [email, setEmail] = useState(user?.email ?? '');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleResend(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await resendVerification(email);
      if (result.success) {
        setSent(true);
      } else {
        setError(result.error || 'Failed to resend verification email');
      }
    } catch {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
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
          <Button variant="outline" onClick={() => setSent(false)}>
            Resend email
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
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? <LoadingSpinner size="sm" /> : 'Send Verification Email'}
          </Button>
          <div className="text-center">
            <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-primary">
              Skip for now
            </Link>
          </div>
        </form>
      )}
    </AuthShell>
  );
}
