/**
 * Save-calculation button (Section 16, #36).
 *
 * Pure-local calculator tools keep their inputs only in the URL
 * (GET form) — this button adds the two things that were missing:
 *   1. "Copy shareable link" — the tool URL with the inputs in it
 *      (lib/saved-calculations.ts buildCalculationShareUrl). No
 *      account needed; opening the link re-runs the calculation.
 *   2. "Save to my account" — POSTs the tool + label + params to
 *      /api/v1/saved-calculations (migration 043 table, own-only
 *      RLS). Guests see a sign-in link instead; a 503 means the
 *      migration is unapplied and the button says so honestly —
 *      the calculation is never claimed saved when it was not.
 */

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Bookmark, Check, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth';
import {
  buildCalculationShareUrl,
  type CalculationParams,
} from '@/lib/saved-calculations';

export interface SaveCalculationButtonProps {
  /** Tool slug, e.g. 'emi-calculator'. */
  tool: string;
  /** Human label for the saved row, e.g. "EMI $999 at 12% / 12 mo". */
  label: string;
  /** The tool's input params (the same values the URL carries). */
  params: CalculationParams;
}

export function SaveCalculationButton({ tool, label, params }: SaveCalculationButtonProps) {
  const { user } = useAuth();
  const [copied, setCopied] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  const shareUrl = buildCalculationShareUrl(tool, params);
  if (!shareUrl) return null;

  const handleCopy = async () => {
    try {
      const absolute = new URL(shareUrl, window.location.origin).toString();
      await navigator.clipboard.writeText(absolute);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable — the link is still shown in the
      // address bar; there is nothing honest to claim instead.
    }
  };

  const handleSave = async () => {
    if (saveState === 'saving' || saveState === 'saved') return;
    setSaveState('saving');
    setSaveError(null);
    try {
      const res = await fetch('/api/v1/saved-calculations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool, label, params }),
      });
      if (res.ok) {
        setSaveState('saved');
        return;
      }
      setSaveState('error');
      setSaveError(
        res.status === 503
          ? 'Saved calculations are not available yet.'
          : res.status === 401
            ? 'Sign in to save calculations to your account.'
            : 'Could not save this calculation. Try again.'
      );
    } catch {
      setSaveState('error');
      setSaveError('Could not save this calculation. Try again.');
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" size="sm" onClick={() => void handleCopy()}>
        {copied ? <Check className="mr-2 h-4 w-4" /> : <Link2 className="mr-2 h-4 w-4" />}
        {copied ? 'Link copied' : 'Copy shareable link'}
      </Button>
      {user ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void handleSave()}
          disabled={saveState === 'saving' || saveState === 'saved'}
        >
          <Bookmark className="mr-2 h-4 w-4" />
          {saveState === 'saved'
            ? 'Saved to your account'
            : saveState === 'saving'
              ? 'Saving…'
              : 'Save to my account'}
        </Button>
      ) : (
        <span className="text-sm text-muted-foreground">
          <Link href="/sign-in" className="font-medium underline">
            Sign in
          </Link>{' '}
          to save this calculation to your account.
        </span>
      )}
      {saveState === 'error' && saveError && (
        <p role="alert" className="w-full text-sm text-red-600 dark:text-red-400">
          {saveError}
        </p>
      )}
    </div>
  );
}
