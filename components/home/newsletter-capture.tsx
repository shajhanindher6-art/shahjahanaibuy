'use client';

/**
 * Newsletter / deal-alert capture form (Section 12, Chunk D).
 *
 * Capture-only: posts the email to POST /api/v1/newsletter/subscribe
 * and stores it — nothing is sent. The copy says so honestly
 * ("sending starts once email delivery is configured") because
 * sending is not configured yet; there is no promise of a weekly
 * digest or any delivery schedule anywhere in this component.
 *
 * Mounting is NOT done here — a parallel chunk mounts this component
 * in the footer and on the homepage. Import it as:
 *
 *   import { NewsletterCapture } from '@/components/home/newsletter-capture';
 *   <NewsletterCapture source="footer" />
 *   <NewsletterCapture source="homepage" />
 *
 * Props:
 * - source (required): 'footer' | 'homepage' | 'deals' | 'digest' | 'notifications' — recorded with the
 *   signup so the stored row says where it came from.
 * - className (optional): extra classes on the wrapping <section>.
 * - compact (optional, default false): hides the heading/description
 *   for tight spots (e.g. the footer) and renders just the form.
 */

import { useState, type FormEvent } from 'react';
import { Mail, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NEWSLETTER_COPY, type NewsletterSource } from '@/lib/newsletter';
import { useRegion } from '@/components/region/region-provider';
import { tFor } from '@/lib/i18n';

export interface NewsletterCaptureProps {
  source: NewsletterSource;
  className?: string;
  compact?: boolean;
}

type FormState =
  | { status: 'idle'; error: string | null }
  | { status: 'submitting'; error: string | null }
  | { status: 'success'; error: null }
  | { status: 'error'; error: string };

export function NewsletterCapture({
  source,
  className,
  compact = false,
}: NewsletterCaptureProps) {
  // Section 13, chunk H (i18n Phase 1): the heading follows the
  // visitor's UI language via the dictionary; the rest of the copy
  // (description, labels, privacy note) stays in
  // NEWSLETTER_COPY until a later i18n phase.
  const { language } = useRegion();
  const [email, setEmail] = useState('');
  const [formState, setFormState] = useState<FormState>({
    status: 'idle',
    error: null,
  });

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    setFormState({ status: 'submitting', error: null });
    try {
      const res = await fetch('/api/v1/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed, source }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const message =
          typeof body?.error?.message === 'string'
            ? body.error.message
            : NEWSLETTER_COPY.errorFallback;
        setFormState({ status: 'error', error: message });
        return;
      }
      setFormState({ status: 'success', error: null });
    } catch {
      setFormState({ status: 'error', error: NEWSLETTER_COPY.errorFallback });
    }
  }

  if (formState.status === 'success') {
    return (
      <section aria-label="Newsletter signup" className={className}>
        <p className="flex items-center gap-2 font-semibold">
          <CheckCircle2 className="h-5 w-5 text-green-600" aria-hidden />
          {NEWSLETTER_COPY.successHeading}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {NEWSLETTER_COPY.successMessage}
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Newsletter signup" className={className}>
      {!compact && (
        <>
          <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight">
            <Mail className="h-5 w-5 text-blue-600" aria-hidden />
            {tFor(language, 'newsletterHeading')}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {NEWSLETTER_COPY.description}
          </p>
        </>
      )}
      <form onSubmit={handleSubmit} className="mt-3 flex flex-col gap-2 sm:flex-row">
        <label htmlFor={`newsletter-email-${source}`} className="sr-only">
          {NEWSLETTER_COPY.emailLabel}
        </label>
        <Input
          id={`newsletter-email-${source}`}
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={NEWSLETTER_COPY.emailPlaceholder}
          disabled={formState.status === 'submitting'}
          className="flex-1"
        />
        <Button type="submit" disabled={formState.status === 'submitting'}>
          {formState.status === 'submitting'
            ? NEWSLETTER_COPY.submittingLabel
            : NEWSLETTER_COPY.submitLabel}
        </Button>
      </form>
      {formState.status === 'error' && formState.error && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {formState.error}
        </p>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        {NEWSLETTER_COPY.privacyNote}
      </p>
    </section>
  );
}
