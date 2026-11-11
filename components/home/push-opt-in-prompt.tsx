'use client';

import { useEffect, useState } from 'react';
import { Bell, BellOff, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth';
import {
  isPushSupported,
  isGuestPushSubscribed,
  subscribePush,
  unsubscribePush,
  subscribeGuestPush,
  unsubscribeGuestPush,
  type PushSubscribeResult,
} from '@/lib/push-client';

/**
 * Push opt-in prompt (Section 12, Chunk E — retention completions).
 *
 * The push plumbing already existed (service worker, /api/v1/push/
 * subscribe, guest token flow in lib/push-client.ts) but almost no
 * surface ever asked the visitor to turn it on, so push alerts
 * could never arrive. This is that surface: a small dismissible
 * card, mounted on product pages (and, by a parallel chunk, on the
 * homepage).
 *
 * Honesty rules, enforced here and unit-tested in
 * tests/section12-retention.test.ts:
 * - When the VAPID public key is not configured, the prompt says
 *   "Push notifications are not configured yet" and the button is
 *   disabled — it never pretends push works.
 * - Every failure from lib/push-client.ts is shown with its real
 *   reason (unsupported / denied / no-key / server / unknown) —
 *   never a generic "you're subscribed" claim.
 * - Signed-in visitors subscribe with subscribePush(); guests with
 *   subscribeGuestPush() (browser token, no account needed).
 * - Dismissing hides the prompt on this browser (localStorage
 *   flag); already-subscribed browsers see an "on" state with a
 *   turn-off button instead of a second prompt.
 * - Browsers without push support see nothing at all.
 */

export const PUSH_OPT_IN_DISMISS_KEY = 'sb-push-opt-in-dismissed';

export type PushSubscribeFailureReason = Exclude<
  PushSubscribeResult,
  { ok: true }
>['reason'];

/**
 * Honest message for each subscribe failure reason from
 * lib/push-client.ts. Pure — unit-tested. The 'no-key' message is
 * the "not configured yet" wording the prompt must show.
 */
export function pushSubscribeFailureMessage(
  reason: PushSubscribeFailureReason
): string {
  switch (reason) {
    case 'unsupported':
      return 'Push notifications are not supported in this browser.';
    case 'denied':
      return 'Notifications are blocked for this site — allow them in your browser settings to turn them on.';
    case 'no-key':
      return 'Push notifications are not configured yet — the site owner still needs to set up push notifications.';
    case 'server':
      return 'Could not save the push subscription — please try again later.';
    case 'unknown':
    default:
      return 'Something went wrong — please try again.';
  }
}

export interface PushOptInPromptProps {
  /**
   * Where the prompt is shown — tailors the copy. 'product' (the
   * default) talks about this product's price; 'home' talks about
   * watched products in general.
   */
  context?: 'home' | 'product';
  /** Extra class names for the wrapper. */
  className?: string;
}

type PromptState =
  | 'checking'
  | 'prompt'
  | 'subscribed'
  | 'not-configured'
  | 'hidden';

export function PushOptInPrompt({
  context = 'product',
  className,
}: PushOptInPromptProps) {
  const { user, isLoading: authLoading } = useAuth();
  const [state, setState] = useState<PromptState>('checking');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;
    void (async () => {
      try {
        if (window.localStorage.getItem(PUSH_OPT_IN_DISMISS_KEY) === '1') {
          if (!cancelled) setState('hidden');
          return;
        }
      } catch {
        // Storage unavailable — still show the prompt; dismissing
        // just won't stick on this browser.
      }
      if (!isPushSupported()) {
        if (!cancelled) setState('hidden');
        return;
      }
      if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) {
        if (!cancelled) setState('not-configured');
        return;
      }
      const subscribed = await isGuestPushSubscribed();
      if (!cancelled) setState(subscribed ? 'subscribed' : 'prompt');
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading]);

  const dismiss = () => {
    try {
      window.localStorage.setItem(PUSH_OPT_IN_DISMISS_KEY, '1');
    } catch {
      // Dismissal just won't stick — the card still hides now.
    }
    setState('hidden');
  };

  const handleSubscribe = async () => {
    setBusy(true);
    setError(null);
    const result = user ? await subscribePush() : await subscribeGuestPush();
    setBusy(false);
    if (result.ok) {
      setState('subscribed');
      return;
    }
    setError(pushSubscribeFailureMessage(result.reason));
  };

  const handleUnsubscribe = async () => {
    setBusy(true);
    setError(null);
    if (user) {
      await unsubscribePush();
    } else {
      await unsubscribeGuestPush();
    }
    setBusy(false);
    setState('prompt');
  };

  if (state === 'checking' || state === 'hidden') return null;

  const title =
    context === 'home'
      ? 'Get push alerts for price drops'
      : 'Get a push alert when this price drops';
  const body =
    context === 'home'
      ? 'Turn on browser notifications and we will tell you here when a product you watch drops in price.'
      : 'Turn on browser notifications and we will tell you here when this product drops in price. No account needed — turn it off anytime.';

  return (
    <section
      aria-label="Push notification opt-in"
      className={`rounded-lg border bg-white p-4 shadow-sm dark:bg-slate-900${className ? ` ${className}` : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Bell className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
          <div>
            <p className="font-medium">{title}</p>
            {state === 'not-configured' ? (
              <p className="mt-1 text-sm text-muted-foreground">
                Push notifications are not configured yet — the site
                owner still needs to set up push notifications.
                Check back later.
              </p>
            ) : state === 'subscribed' ? (
              <p className="mt-1 text-sm text-muted-foreground">
                Push alerts are on for this browser.
              </p>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">{body}</p>
            )}
            {error && (
              <p role="alert" className="mt-2 text-sm text-red-600">
                {error}
              </p>
            )}
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={dismiss}
          aria-label="Dismiss push notification prompt"
          className="h-8 w-8 shrink-0 p-0"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 pl-8">
        {state === 'not-configured' ? (
          <Button variant="outline" size="sm" disabled>
            <Bell className="mr-2 h-4 w-4" /> Turn on push alerts
          </Button>
        ) : state === 'subscribed' ? (
          <Button variant="outline" size="sm" onClick={() => void handleUnsubscribe()} disabled={busy}>
            <BellOff className="mr-2 h-4 w-4" />
            {busy ? 'Turning off…' : 'Turn off push alerts'}
          </Button>
        ) : (
          <Button size="sm" onClick={() => void handleSubscribe()} disabled={busy}>
            <Bell className="mr-2 h-4 w-4" />
            {busy ? 'Turning on…' : 'Turn on push alerts'}
          </Button>
        )}
      </div>
    </section>
  );
}
