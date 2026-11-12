/**
 * Simulator → real alert button (Section 16, #33).
 *
 * The Price Alert Simulator is simulation-only by design — this
 * button is the one-click bridge to a REAL alert: it POSTs the
 * simulated product + target to the existing POST /api/v1/alerts
 * (price_drop, conditionValue = target), so the alert cap (Free
 * = 5), tier checks, and ownership all come from the alerts API
 * itself — nothing is re-implemented here.
 *
 * Guests see a sign-in link instead of the button (the alerts API
 * requires auth); a 403 from the API surfaces its real message
 * (e.g. the alert cap), never a generic failure.
 */

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Bell, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PushOptInPrompt } from '@/components/home/push-opt-in-prompt';
import { useAuth } from '@/features/auth';

export interface SimulatorToAlertButtonProps {
  productId: string;
  productName: string;
  /** The simulated target price (USD). */
  targetPrice: number;
}

export function SimulatorToAlertButton({
  productId,
  productName,
  targetPrice,
}: SimulatorToAlertButtonProps) {
  const { user } = useAuth();
  const [state, setState] = useState<'idle' | 'saving' | 'created' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  if (!user) {
    return (
      <p className="text-sm text-muted-foreground">
        <Link href="/sign-in" className="font-medium underline">
          Sign in
        </Link>{' '}
        to turn this simulation into a real price alert for {productName} at $
        {targetPrice.toFixed(2)}.
      </p>
    );
  }

  if (state === 'created') {
    return (
      <div className="space-y-3">
        <p className="flex items-center gap-2 text-sm font-medium text-emerald-600 dark:text-emerald-400">
          <Check className="h-4 w-4" /> Real alert created — we will notify you when{' '}
          {productName} drops to ${targetPrice.toFixed(2)}.{' '}
          <Link href="/dashboard/tracking" className="underline">
            View your alerts
          </Link>
        </p>
        {/* Section 16, #35 — push opt-in right after the alert is
            created, so the new alert can actually reach the user. */}
        <PushOptInPrompt context="product" />
      </div>
    );
  }

  const handleCreate = async () => {
    setState('saving');
    setError(null);
    try {
      const res = await fetch('/api/v1/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId,
          alertType: 'price_drop',
          conditionValue: targetPrice,
          channel: 'both',
        }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success) {
        setState('created');
        return;
      }
      setState('error');
      setError(
        typeof data?.error?.message === 'string' && data.error.message
          ? data.error.message
          : 'Could not create the alert. Try again.'
      );
    } catch {
      setState('error');
      setError('Could not create the alert. Try again.');
    }
  };

  return (
    <div>
      <Button onClick={() => void handleCreate()} disabled={state === 'saving'}>
        <Bell className="mr-2 h-4 w-4" />
        {state === 'saving' ? 'Creating alert…' : `Create a real alert at $${targetPrice.toFixed(2)}`}
      </Button>
      {state === 'error' && error && (
        <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
