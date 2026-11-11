/**
 * Guided Shopping Quiz — /tools/help-me-choose (Section 11).
 *
 * "Help me choose": a 4-step structured form (use-case → budget →
 * brand → must-haves) that returns ranked priced picks, each with a
 * short "why" line. No LLM, no account needed.
 *
 * - The page is a client component: only the step form needs
 *   interactivity. Ranking happens server-side in
 *   GET /api/v1/guided-finder, which uses the ONE shared helper in
 *   services/guided-finder.ts (same as the Budget Finder).
 * - The finished answers live in a shareable `?answers=` URL:
 *   finishing the quiz replaces the URL, and opening a shared link
 *   restores the same answers and the same results.
 * - Honesty: many answer combos return 1–3 picks or NOTHING — the
 *   empty state says so plainly ("no priced match for these
 *   answers") and suggests loosening the budget or a must-have.
 *   Picks are priced products only; nothing is forced or invented.
 */

'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Compass, Share2 } from 'lucide-react';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import {
  GUIDED_BRANDS,
  GUIDED_BUDGETS,
  GUIDED_MUST_HAVES,
  GUIDED_USE_CASES,
  decodeQuizAnswers,
  encodeQuizAnswers,
  type GuidedAnswers,
  type GuidedPick,
} from '@/services/guided-finder';

const STEPS = ['What do you need?', 'Your budget', 'Preferred brand', 'Must-haves'] as const;

interface GuidedFinderResponse {
  success: boolean;
  data: GuidedPick[];
  meta?: { total?: number; catalogSize?: number };
  error?: { message?: string };
}

function emptyAnswers(): GuidedAnswers {
  return { useCase: '', budgetUsd: null, brand: null, mustHaves: [] };
}

function QuizInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<GuidedAnswers>(emptyAnswers());
  const [picks, setPicks] = useState<GuidedPick[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [restored, setRestored] = useState(false);

  const fetchPicks = useCallback(async (a: GuidedAnswers) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/guided-finder?answers=${encodeQuizAnswers(a)}`);
      const body = (await res.json()) as GuidedFinderResponse;
      if (!res.ok || !body.success) {
        setError(body.error?.message ?? 'Could not load picks — please try again.');
        setPicks(null);
        return;
      }
      setPicks(body.data ?? []);
    } catch {
      setError('Could not load picks — please check your connection and try again.');
      setPicks(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // A shared ?answers= link restores the same answers + results.
  useEffect(() => {
    if (restored) return;
    const raw = searchParams.get('answers');
    if (!raw) return;
    const decoded = decodeQuizAnswers(raw);
    if (!decoded) return;
    setRestored(true);
    setAnswers(decoded);
    setStep(STEPS.length);
    setShareUrl(`${window.location.origin}/tools/help-me-choose?answers=${encodeQuizAnswers(decoded)}`);
    void fetchPicks(decoded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, restored, fetchPicks]);

  const finish = () => {
    const url = `${window.location.origin}/tools/help-me-choose?answers=${encodeQuizAnswers(answers)}`;
    setShareUrl(url);
    router.replace(`/tools/help-me-choose?answers=${encodeQuizAnswers(answers)}`);
    setStep(STEPS.length);
    void fetchPicks(answers);
  };

  const toggleMustHave = (value: string) => {
    setAnswers((prev) => ({
      ...prev,
      mustHaves: prev.mustHaves.includes(value)
        ? prev.mustHaves.filter((m) => m !== value)
        : [...prev.mustHaves, value],
    }));
  };

  const copyShareUrl = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const stepComplete =
    step === 0
      ? answers.useCase.length > 0
      : step === 1
        ? true // budget always has a value (including "No limit")
        : step === 2
          ? true // brand always has a value (including "Any brand")
          : true; // must-haves are optional

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <Compass className="h-7 w-7 text-blue-600" /> Help me choose
          </h1>
          <p className="mt-2 text-muted-foreground">
            Answer four quick questions and get ranked picks from real
            priced products — with one line each saying why it fits.
            No account, no waiting: the catalog is small, so some
            answers honestly return only a few picks, or none at all.
          </p>

          {/* Step indicator */}
          <ol className="mt-8 flex gap-2" aria-label="Quiz progress">
            {STEPS.map((label, i) => (
              <li
                key={label}
                className={`flex-1 rounded-md px-2 py-2 text-center text-xs font-medium ${
                  i === step
                    ? 'bg-primary text-primary-foreground'
                    : i < step || step === STEPS.length
                      ? 'bg-muted text-muted-foreground'
                      : 'bg-muted/50 text-muted-foreground'
                }`}
              >
                {i + 1}. {label}
              </li>
            ))}
          </ol>

          {step < STEPS.length && (
            <section className="mt-8 rounded-lg border p-6" aria-live="polite">
              {step === 0 && (
                <>
                  <h2 className="text-xl font-semibold">What do you need it for?</h2>
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    {GUIDED_USE_CASES.map((u) => (
                      <button
                        key={u.value}
                        type="button"
                        onClick={() => setAnswers((prev) => ({ ...prev, useCase: u.value }))}
                        className={`min-h-[44px] rounded-md border px-4 py-3 text-left text-sm font-medium ${
                          answers.useCase === u.value
                            ? 'border-primary bg-primary/10'
                            : 'hover:border-primary/50'
                        }`}
                        aria-pressed={answers.useCase === u.value}
                      >
                        {u.label}
                      </button>
                    ))}
                  </div>
                </>
              )}

              {step === 1 && (
                <>
                  <h2 className="text-xl font-semibold">What is your budget?</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    A hard limit — picks above it are never shown.
                  </p>
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    {GUIDED_BUDGETS.map((b) => (
                      <button
                        key={b.label}
                        type="button"
                        onClick={() => setAnswers((prev) => ({ ...prev, budgetUsd: b.value }))}
                        className={`min-h-[44px] rounded-md border px-4 py-3 text-left text-sm font-medium ${
                          answers.budgetUsd === b.value
                            ? 'border-primary bg-primary/10'
                            : 'hover:border-primary/50'
                        }`}
                        aria-pressed={answers.budgetUsd === b.value}
                      >
                        {b.label}
                      </button>
                    ))}
                  </div>
                </>
              )}

              {step === 2 && (
                <>
                  <h2 className="text-xl font-semibold">Any preferred brand?</h2>
                  <div className="mt-4 grid gap-2 sm:grid-cols-3">
                    <button
                      type="button"
                      onClick={() => setAnswers((prev) => ({ ...prev, brand: null }))}
                      className={`min-h-[44px] rounded-md border px-4 py-3 text-left text-sm font-medium ${
                        answers.brand === null
                          ? 'border-primary bg-primary/10'
                          : 'hover:border-primary/50'
                      }`}
                      aria-pressed={answers.brand === null}
                    >
                      Any brand
                    </button>
                    {GUIDED_BRANDS.map((brand) => (
                      <button
                        key={brand}
                        type="button"
                        onClick={() => setAnswers((prev) => ({ ...prev, brand }))}
                        className={`min-h-[44px] rounded-md border px-4 py-3 text-left text-sm font-medium ${
                          answers.brand === brand
                            ? 'border-primary bg-primary/10'
                            : 'hover:border-primary/50'
                        }`}
                        aria-pressed={answers.brand === brand}
                      >
                        {brand}
                      </button>
                    ))}
                  </div>
                </>
              )}

              {step === 3 && (
                <>
                  <h2 className="text-xl font-semibold">Any must-haves?</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Optional — a pick must match every must-have you
                    choose, so picking several can honestly return no
                    results.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {GUIDED_MUST_HAVES.map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => toggleMustHave(m)}
                        className={`min-h-[44px] rounded-full border px-4 py-2 text-sm font-medium ${
                          answers.mustHaves.includes(m)
                            ? 'border-primary bg-primary/10'
                            : 'hover:border-primary/50'
                        }`}
                        aria-pressed={answers.mustHaves.includes(m)}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </>
              )}

              <div className="mt-6 flex justify-between">
                <Button
                  variant="outline"
                  disabled={step === 0}
                  onClick={() => setStep((s) => Math.max(0, s - 1))}
                >
                  ← Back
                </Button>
                {step < STEPS.length - 1 ? (
                  <Button disabled={!stepComplete} onClick={() => setStep((s) => s + 1)}>
                    Next →
                  </Button>
                ) : (
                  <Button disabled={!stepComplete} onClick={finish}>
                    See my picks →
                  </Button>
                )}
              </div>
            </section>
          )}

          {step === STEPS.length && (
            <section className="mt-8" aria-live="polite">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-xl font-semibold">Your picks</h2>
                <Button variant="outline" onClick={() => setStep(0)}>
                  Change answers
                </Button>
              </div>

              {shareUrl && (
                <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border p-3">
                  <Share2 className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">Share these answers:</span>
                  <input
                    readOnly
                    value={shareUrl}
                    className="min-w-0 flex-1 rounded border bg-muted px-2 py-1 text-xs"
                    aria-label="Shareable link for these quiz answers"
                    onFocus={(e) => e.target.select()}
                  />
                  <Button variant="outline" size="sm" onClick={copyShareUrl}>
                    {copied ? 'Copied!' : 'Copy link'}
                  </Button>
                </div>
              )}

              {loading && (
                <div className="mt-8 flex justify-center">
                  <LoadingSpinner />
                </div>
              )}

              {error && !loading && (
                <div className="mt-8">
                  <EmptyState
                    eyebrow="Could not load picks"
                    title="Something went wrong"
                    description={error}
                    action={<Button onClick={() => void fetchPicks(answers)}>Try again</Button>}
                  />
                </div>
              )}

              {!loading && !error && picks !== null && picks.length === 0 && (
                <div className="mt-8">
                  <EmptyState
                    eyebrow="No priced match"
                    title="No priced match for these answers"
                    description="No product with a verified price fits this combination right now — the catalog is small. Try raising the budget, picking any brand, or clearing a must-have."
                    action={<Button onClick={() => setStep(0)}>Adjust my answers</Button>}
                  />
                </div>
              )}

              {!loading && !error && picks !== null && picks.length > 0 && (
                <div className="mt-6 space-y-4">
                  {picks.map((pick, i) => (
                    <article key={pick.slug} className="rounded-lg border p-6">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Pick {i + 1} · {pick.verdict}
                          </p>
                          <h3 className="mt-1 text-lg font-semibold">
                            <Link
                              href={`/products/${pick.slug}`}
                              className="underline-offset-4 hover:underline"
                            >
                              {pick.name}
                            </Link>
                          </h3>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {pick.brand ?? 'Unknown brand'}
                            {pick.category ? ` · ${pick.category}` : ''}
                            {pick.merchantName ? ` · at ${pick.merchantName}` : ''}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-xl font-bold">
                            ${(pick.bestPriceUsd as number).toFixed(2)}
                          </p>
                          {pick.savingPct !== null && (
                            <p className="text-sm font-medium text-green-700">
                              Save {pick.savingPct}%
                            </p>
                          )}
                          {pick.dealScore !== null && (
                            <p className="text-xs text-muted-foreground">
                              Deal Score {pick.dealScore}/100
                            </p>
                          )}
                        </div>
                      </div>
                      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                        {pick.why.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                      <Link
                        href={`/products/${pick.slug}`}
                        className="mt-4 inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                      >
                        View product →
                      </Link>
                    </article>
                  ))}
                  <p className="text-xs text-muted-foreground">
                    Prices are verified merchant prices. Products
                    without a priced listing are never shown as picks.
                  </p>
                </div>
              )}
            </section>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

export default function HelpMeChoosePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen flex-col">
          <SiteHeader />
          <main className="container mx-auto flex-1 px-4 py-12">
            <div className="flex justify-center">
              <LoadingSpinner />
            </div>
          </main>
          <SiteFooter />
        </div>
      }
    >
      <QuizInner />
    </Suspense>
  );
}
