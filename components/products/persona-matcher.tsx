'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { fetchProductAttributes } from '@/lib/fetch-product-attributes';
import {
  PERSONAS,
  getPersona,
  matchVerdict,
  scorePersona,
  type PersonaId,
} from '@/services/persona-matcher';
import type { ProductAttribute } from '@/types/catalog';

/**
 * Persona Matcher — Option 15 Module 2.
 *
 * Interactive "Will it fit my needs?" widget: the visitor picks how
 * they will use the product (Work, Gaming, Student, Content
 * Creation) and gets a deterministic score from the product's REAL
 * recorded specifications plus its real category — no LLM, no
 * invented specs.
 *
 * Attributes are loaded from the existing public endpoint
 * GET /api/v1/products/[slug] (attributes[]). While loading, a
 * spinner shows; if the fetch fails the whole section hides (a
 * broken network must not render fake specs); if the fetch succeeds
 * but no specs are recorded, an honest empty state says so — and
 * the category requirement is still judged.
 */
export function PersonaMatcher({
  slug,
  category,
  productName,
}: {
  slug: string;
  category: string | null;
  productName: string;
}) {
  const [selectedId, setSelectedId] = useState<PersonaId>('work');
  const [attributes, setAttributes] = useState<ProductAttribute[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setAttributes(null);
    setFailed(false);
    (async () => {
      const result = await fetchProductAttributes(slug);
      if (cancelled) return;
      if (!result.ok) {
        setFailed(true);
        return;
      }
      setAttributes(result.attributes);
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // A failed fetch hides the section entirely — never show an empty
  // state for data the endpoint never actually returned.
  if (failed) return null;

  const persona = getPersona(selectedId);
  const result = attributes === null ? null : scorePersona(persona, attributes, category);
  const verdict = result ? matchVerdict(result.scorePct) : null;

  const verdictColor =
    verdict === 'Great fit'
      ? 'text-green-600 dark:text-green-400'
      : verdict === 'Good fit'
        ? 'text-amber-600 dark:text-amber-400'
        : verdict === 'Not ideal'
          ? 'text-rose-600 dark:text-rose-400'
          : 'text-muted-foreground';
  const barColor =
    verdict === 'Great fit'
      ? 'bg-green-500'
      : verdict === 'Good fit'
        ? 'bg-amber-500'
        : verdict === 'Not ideal'
          ? 'bg-rose-500'
          : 'bg-slate-300 dark:bg-slate-700';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Will it fit my needs?</CardTitle>
        <CardDescription>
          Pick how you will use {productName} — scored from its recorded specifications only.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Choose a use case">
          {PERSONAS.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={selectedId === p.id}
              onClick={() => setSelectedId(p.id)}
              className={
                selectedId === p.id
                  ? 'rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-slate-900'
                  : 'rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
              }
            >
              {p.label}
            </button>
          ))}
        </div>
        <p className="mt-3 text-sm text-muted-foreground">{persona.description}</p>

        {result === null ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <LoadingSpinner size="sm" />
            Loading specifications…
          </div>
        ) : (
          <>
            {attributes !== null && attributes.length === 0 && (
              <p className="mt-4 rounded-md bg-slate-50 px-3 py-2 text-sm text-muted-foreground dark:bg-slate-800">
                No specifications recorded for this product yet — only the category can be
                judged.
              </p>
            )}

            <div className="mt-4 flex items-end gap-3">
              <span className="text-4xl font-bold tracking-tight">
                {result.scorePct === null ? '—' : `${result.scorePct}%`}
              </span>
              {verdict && <span className={`pb-1 text-lg font-semibold ${verdictColor}`}>{verdict}</span>}
            </div>
            <div
              className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
              role="progressbar"
              aria-valuenow={result.scorePct ?? undefined}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Fit score for ${persona.label}`}
            >
              <div
                className={`h-full rounded-full ${barColor}`}
                style={{ width: `${result.scorePct ?? 0}%` }}
              />
            </div>
            {result.scorePct === null && (
              <p className="mt-2 text-sm text-muted-foreground">
                Not enough recorded data to judge this product for {persona.label}.
              </p>
            )}

            <ul className="mt-4 space-y-2">
              {result.matched.map((entry) => (
                <li key={entry.requirement.id} className="flex items-start gap-2 text-sm">
                  <span className="font-semibold text-green-600 dark:text-green-400" aria-hidden>
                    ✓
                  </span>
                  <span>
                    <span className="font-medium">{entry.requirement.label}</span>
                    {': '}
                    {entry.requirement.id === 'category' ? (
                      <span className="text-muted-foreground">
                        {entry.actual} is a typical {persona.label} category
                      </span>
                    ) : (
                      <span className="text-muted-foreground">
                        {entry.actual} — meets the {entry.requirement.min}{' '}
                        {entry.requirement.unit} bar
                      </span>
                    )}
                  </span>
                </li>
              ))}
              {result.below.map((entry) => (
                <li key={entry.requirement.id} className="flex items-start gap-2 text-sm">
                  <span className="font-semibold text-amber-600 dark:text-amber-400" aria-hidden>
                    ✗
                  </span>
                  <span>
                    <span className="font-medium">{entry.requirement.label}</span>
                    {': '}
                    {entry.requirement.id === 'category' ? (
                      <span className="text-muted-foreground">
                        {entry.actual} isn&rsquo;t usually a {persona.label} category
                      </span>
                    ) : (
                      <span className="text-muted-foreground">
                        {entry.actual} — needs at least {entry.requirement.min}{' '}
                        {entry.requirement.unit}
                      </span>
                    )}
                  </span>
                </li>
              ))}
              {result.unknown.map((entry) => (
                <li key={entry.requirement.id} className="flex items-start gap-2 text-sm">
                  <span className="font-semibold text-muted-foreground" aria-hidden>
                    ?
                  </span>
                  <span>
                    <span className="font-medium">{entry.requirement.label}</span>
                    {': '}
                    <span className="text-muted-foreground">
                      {entry.requirement.id === 'category'
                        ? 'category not recorded for this product'
                        : 'not recorded for this product'}
                    </span>
                  </span>
                </li>
              ))}
            </ul>

            <p className="mt-4 text-xs text-muted-foreground">
              Scores use recorded specifications only. Missing specs score 0 — nothing is
              guessed.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
