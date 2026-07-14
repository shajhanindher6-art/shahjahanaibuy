'use client';

import { useState, Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/features/auth';
import { AuthShell } from '@/components/layout/auth-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { CheckCircle2 } from 'lucide-react';

function AuthCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { updatePassword } = useAuth();

  const type = searchParams.get('type');
  const errorDescription = searchParams.get('error_description');
  const errorCode = searchParams.get('error_code');
  const isRecovery = type === 'recovery';
  const isOAuthError = Boolean(errorCode || errorDescription);

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOAuthError) {
      return;
    }
    if (!isRecovery && !isOAuthError) {
      const timer = setTimeout(() => router.push('/dashboard'), 1500);
      return () => clearTimeout(timer);
    }
  }, [isRecovery, isOAuthError, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (password.length < 8) {
      setError('Password must be at least 8 characters long');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      const result = await updatePassword(password);
      if (result.success) {
        router.push('/dashboard');
      } else {
        setError(result.error || 'Failed to reset password');
      }
    } catch {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (isOAuthError) {
    return (
      <AuthShell
        title="Authentication Error"
        description="An error occurred during authentication"
        footer={
          <Link href="/sign-in" className="font-medium text-primary hover:underline">
            Back to sign in
          </Link>
        }
      >
        <div className="space-y-4">
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {errorDescription || 'Authentication failed. Please try again.'}
          </div>
          <Button asChild className="w-full">
            <Link href="/sign-in">Back to Sign In</Link>
          </Button>
        </div>
      </AuthShell>
    );
  }

  if (isRecovery) {
    return (
      <AuthShell
        title="Set a new password"
        description="Enter your new password below"
        footer={
          <Link href="/sign-in" className="font-medium text-primary hover:underline">
            Back to sign in
          </Link>
        }
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
          )}
          <div className="space-y-2">
            <Label htmlFor="password">New Password</Label>
            <Input
              id="password"
              type="password"
              placeholder="At least 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="new-password"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm Password</Label>
            <Input
              id="confirmPassword"
              type="password"
              placeholder="Re-enter your password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              autoComplete="new-password"
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? <LoadingSpinner size="sm" /> : 'Reset Password'}
          </Button>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Signing you in" description="Completing authentication">
      <div className="flex flex-col items-center gap-4 py-8">
        <CheckCircle2 className="h-12 w-12 text-emerald-500" />
        <p className="text-sm text-muted-foreground">
          Authentication successful. Redirecting to your dashboard...
        </p>
        <LoadingSpinner size="sm" />
      </div>
    </AuthShell>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <LoadingSpinner size="lg" />
        </div>
      }
    >
      <AuthCallbackContent />
    </Suspense>
  );
}
