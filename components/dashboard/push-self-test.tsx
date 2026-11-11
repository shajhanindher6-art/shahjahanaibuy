/**
 * Push self-test card (Section 14, Chunk 7) — settings page.
 *
 * Runs five checks in order and shows each result honestly:
 * browser support → notification permission → VAPID configured
 * (GET /api/v1/push/vapid) → a browser push subscription exists
 * → a real test push is delivered (POST /api/v1/push/test). A
 * later check is skipped when an earlier one already failed, so
 * the card never claims a test push was sent when there was no
 * subscription to send it to. When VAPID keys are not configured
 * the card says so plainly instead of failing mysteriously.
 */
'use client';

import { useState } from 'react';
import { BellRing, Check, X, Minus } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { isPushSupported } from '@/lib/push-client';
import {
  summarizeSelfTest,
  selfTestVerdict,
  type SelfTestStep,
  type SelfTestStepStatus,
} from '@/lib/push-self-test';

const STEP_LABELS: Array<{ id: string; label: string }> = [
  { id: 'support', label: 'This browser supports push notifications' },
  { id: 'permission', label: 'Notification permission granted' },
  { id: 'vapid', label: 'Push is configured on the server (VAPID key)' },
  { id: 'subscription', label: 'This browser is subscribed' },
  { id: 'delivery', label: 'A test notification was delivered' },
];

export function PushSelfTest() {
  const [steps, setSteps] = useState<SelfTestStep[]>(
    STEP_LABELS.map((s) => ({ ...s, status: 'pending' as SelfTestStepStatus, detail: '' }))
  );
  const [running, setRunning] = useState(false);
  const [verdict, setVerdict] = useState<string | null>(null);

  function setStep(id: string, status: SelfTestStepStatus, detail: string) {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, status, detail } : s)));
  }

  function skipRemaining(fromIndex: number, reason: string) {
    setSteps((prev) =>
      prev.map((s, i) =>
        i >= fromIndex && s.status === 'pending'
          ? { ...s, status: 'skipped' as SelfTestStepStatus, detail: reason }
          : s
      )
    );
  }

  async function runTest() {
    if (running) return;
    setRunning(true);
    setVerdict(null);
    setSteps(STEP_LABELS.map((s) => ({ ...s, status: 'pending' as SelfTestStepStatus, detail: '' })));

    // 1. Browser support.
    if (!isPushSupported()) {
      setStep('support', 'fail', 'This browser has no service worker or PushManager.');
      skipRemaining(1, 'Needs a browser that supports push.');
      finish();
      return;
    }
    setStep('support', 'pass', 'Service worker and PushManager are available.');

    // 2. Permission.
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
      setStep(
        'permission',
        'fail',
        Notification.permission === 'denied'
          ? 'Notifications are blocked for this site — allow them in the browser settings first.'
          : 'Notifications are not allowed yet — turn push notifications on above first.'
      );
      skipRemaining(2, 'Needs notification permission first.');
      finish();
      return;
    }
    setStep('permission', 'pass', 'Notifications are allowed for this site.');

    // 3. VAPID configured on the server.
    let vapidOk = false;
    try {
      const res = await fetch('/api/v1/push/vapid');
      const json = await res.json().catch(() => null);
      vapidOk = !!json?.success && typeof json?.data?.publicKey === 'string' && json.data.publicKey !== '';
    } catch {
      vapidOk = false;
    }
    if (!vapidOk) {
      setStep('vapid', 'fail', 'Push is not configured yet — the site owner still needs to set the VAPID keys.');
      skipRemaining(3, 'Needs the server push setup first.');
      finish();
      return;
    }
    setStep('vapid', 'pass', 'The server has a VAPID public key.');

    // 4. A browser subscription exists.
    let subscribed = false;
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const sub = await registration?.pushManager.getSubscription();
      subscribed = !!sub;
    } catch {
      subscribed = false;
    }
    if (!subscribed) {
      setStep('subscription', 'fail', 'This browser is not subscribed — turn push notifications on above first.');
      skipRemaining(4, 'Needs a subscription first.');
      finish();
      return;
    }
    setStep('subscription', 'pass', 'This browser has an active push subscription.');

    // 5. Real delivery.
    try {
      const res = await fetch('/api/v1/push/test', { method: 'POST' });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.success && json?.data?.sent === true) {
        setStep('delivery', 'pass', 'Test notification sent — check your browser notifications.');
      } else {
        setStep(
          'delivery',
          'fail',
          (json?.data?.message as string | undefined) ??
            'The test notification could not be delivered.'
        );
      }
    } catch {
      setStep('delivery', 'fail', 'The test request failed — check your connection and try again.');
    }
    finish();
  }

  function finish() {
    setSteps((prev) => {
      setVerdict(selfTestVerdict(summarizeSelfTest(prev)));
      return prev;
    });
    setRunning(false);
  }

  const summary = summarizeSelfTest(steps);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BellRing className="h-5 w-5" /> Push self-test
        </CardTitle>
        <CardDescription>
          Checks push notifications end to end on this browser and sends a real test
          notification. Nothing is sent to anyone else.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button onClick={() => void runTest()} disabled={running}>
          {running ? 'Running test…' : 'Run push self-test'}
        </Button>
        {verdict && (
          <p className="text-sm font-medium" role="status">
            {verdict}
          </p>
        )}
        <ul className="space-y-2">
          {steps.map((step) => (
            <li key={step.id} className="flex items-start gap-2 text-sm">
              {step.status === 'pass' ? (
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              ) : step.status === 'fail' ? (
                <X className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
              ) : step.status === 'skipped' ? (
                <Minus className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <span className="mt-0.5 h-4 w-4 shrink-0 rounded-full border border-muted-foreground/40" />
              )}
              <span>
                <span className="font-medium">{step.label}</span>
                {step.detail && (
                  <span className="block text-xs text-muted-foreground">{step.detail}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
        {summary.overall !== 'not-run' && (
          <p className="text-xs text-muted-foreground">
            {summary.passed} passed · {summary.failed} failed · {summary.skipped} skipped
          </p>
        )}
      </CardContent>
    </Card>
  );
}
