'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

/**
 * Native-app waitlist form (Section 6 item 18).
 *
 * Posts { email, platform } to /api/v1/mobile-app/waitlist. No launch
 * date is promised anywhere on this page, and no email is sent on
 * joining — the row only records interest for when a native app
 * exists. Joining twice is fine (dedupe by email + platform).
 */
export function WaitlistForm() {
  const [email, setEmail] = useState('');
  const [platform, setPlatform] = useState<'ios' | 'android'>('android');
  const [state, setState] = useState<'idle' | 'saving' | 'joined' | 'already' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState('saving');
    setMessage('');
    try {
      const res = await fetch('/api/v1/mobile-app/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, platform }),
      });
      const body = await res.json().catch(() => null);
      if (res.ok && body?.success) {
        if (body.data?.alreadyJoined) {
          setState('already');
          setMessage('You are already on the waitlist for this platform — no need to join again.');
        } else {
          setState('joined');
          setMessage('You are on the waitlist. We will only use this email to tell you when a native app is available.');
        }
        return;
      }
      setState('error');
      setMessage(
        typeof body?.error?.message === 'string'
          ? body.error.message
          : 'Something went wrong. Please try again.'
      );
    } catch {
      setState('error');
      setMessage('Something went wrong. Please try again.');
    }
  };

  if (state === 'joined' || state === 'already') {
    return (
      <p role="status" className="rounded-lg border p-4 text-sm">
        {message}
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-3">
      <div>
        <label htmlFor="waitlist-email" className="text-sm font-medium">
          Email
        </label>
        <input
          id="waitlist-email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="mt-1 block w-full min-h-[44px] rounded-md border bg-background px-3 py-2 text-sm"
        />
      </div>
      <fieldset>
        <legend className="text-sm font-medium">Your phone</legend>
        <div className="mt-2 flex gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="platform"
              value="android"
              checked={platform === 'android'}
              onChange={() => setPlatform('android')}
            />
            Android
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="platform"
              value="ios"
              checked={platform === 'ios'}
              onChange={() => setPlatform('ios')}
            />
            iPhone (iOS)
          </label>
        </div>
      </fieldset>
      {state === 'error' ? (
        <p role="alert" className="text-sm text-red-600">
          {message}
        </p>
      ) : null}
      <Button type="submit" disabled={state === 'saving'} className="min-h-[44px]">
        {state === 'saving' ? 'Joining…' : 'Join the waitlist'}
      </Button>
      <p className="text-xs text-muted-foreground">
        No launch date is promised — joining only records that you want to
        hear when a native app exists. No marketing emails are sent.
      </p>
    </form>
  );
}
