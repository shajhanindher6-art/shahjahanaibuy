/**
 * AI Product Review Summarizer — display component (Option 4 Part 2).
 *
 * Renders the template-based review summary produced by
 * services/review-summary.ts and served by
 * GET /api/v1/products/[slug]/review-summary:
 * - NEW: one brief aspect-contrast summary sentence, in the
 *   visitor's UI language (English or Roman Urdu; every other UI
 *   language falls back to the English sentence — a documented
 *   fallback, not a fake translation),
 * - NEW: aspect chips (aspect + sentiment + mention count),
 *   pros/cons from aspect verdicts, verified-purchase attribution,
 *   and original-review source links when reviews carry source_url,
 * - KEPT: overall verdict badge, average rating line, theme chips,
 *   and the most helpful review.
 *
 * Presentational only: it fetches nothing itself. The product page
 * already fetches the summary and passes it in, so this card never
 * blocks the page. Returns null when `summary` is null — that is the
 * 0-reviews case, where the page's existing "No reviews yet" empty
 * state shows instead (plus its line that a sentiment summary will
 * appear once reviews arrive). No summary, aspect, or verdict is
 * ever rendered from zero reviews.
 *
 * Styling is Tailwind + the project's shadcn Card/Badge primitives,
 * matching the rest of the product page (including dark mode).
 */

import { BadgeCheck, Check, ExternalLink, Sparkles, Star, ThumbsDown, ThumbsUp, X } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { ReviewAISummary, ReviewSentimentLabel } from '@/types/ai';
import type { Language } from '@/lib/region';

export type { ReviewAISummary };

interface AIReviewSummarizerProps {
  summary: ReviewAISummary | null;
  /** Visitor UI language; only 'en' and 'ur' change the summary text. */
  language?: Language;
  className?: string;
}

function verdictBadgeClass(averageRating: number): string {
  if (averageRating >= 4.5) return 'bg-green-600 text-white hover:bg-green-600';
  if (averageRating >= 4) return 'bg-green-100 text-green-800 hover:bg-green-100 dark:bg-green-900 dark:text-green-100';
  if (averageRating >= 3) return 'bg-amber-100 text-amber-800 hover:bg-amber-100 dark:bg-amber-900 dark:text-amber-100';
  return 'bg-red-100 text-red-800 hover:bg-red-100 dark:bg-red-900 dark:text-red-100';
}

function sentimentBadgeClass(sentiment: ReviewSentimentLabel): string {
  if (sentiment === 'positive') return 'bg-green-100 text-green-800 hover:bg-green-100 dark:bg-green-900 dark:text-green-100';
  if (sentiment === 'negative') return 'bg-red-100 text-red-800 hover:bg-red-100 dark:bg-red-900 dark:text-red-100';
  return 'bg-amber-100 text-amber-800 hover:bg-amber-100 dark:bg-amber-900 dark:text-amber-100';
}

function sentimentLabel(sentiment: ReviewSentimentLabel, isUr: boolean): string {
  if (isUr) {
    if (sentiment === 'positive') return 'Musbat';
    if (sentiment === 'negative') return 'Manfi';
    return 'Mila jula';
  }
  if (sentiment === 'positive') return 'Positive';
  if (sentiment === 'negative') return 'Negative';
  return 'Mixed';
}

export function AIReviewSummarizer({ summary, language = 'en', className }: AIReviewSummarizerProps) {
  if (!summary) return null;

  const isUr = language === 'ur';
  const sentiment = summary.sentiment ?? null;

  // Brief contrast sentence in the visitor's language. Other UI
  // languages (de/fr/es/it/pt/tr) fall back to English by design.
  const brief =
    sentiment !== null
      ? (isUr ? sentiment.briefSummaryUr : sentiment.briefSummaryEn) ??
        (isUr
          ? `Khareedaron ne is product ko 5 mein se ${sentiment.averageRating.toFixed(1)} number diye hain.`
          : `Buyers rate this product ${sentiment.averageRating.toFixed(1)} out of 5.`)
      : null;

  // Pros/cons: sentiment aspect lists when available (the upgrade),
  // otherwise the legacy theme-based lists (defensive fallback).
  const pros = sentiment !== null
    ? (isUr ? sentiment.prosUr : sentiment.pros)
    : summary.positives;
  const cons = sentiment !== null
    ? (isUr ? sentiment.consUr : sentiment.cons)
    : summary.concerns;
  const prosEmptyText = sentiment !== null
    ? isUr
      ? 'Abhi koi wazeh achaiyan nahi mili.'
      : 'No clear pros mentioned yet.'
    : 'No clear pros mentioned yet.';
  const consEmptyText = sentiment !== null
    ? isUr
      ? 'Abhi koi baar baar shikayat nahi mili.'
      : 'No recurring complaints mentioned yet.'
    : 'No recurring complaints mentioned yet.';

  return (
    <Card className={cn('mb-4', className)}>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4" /> {isUr ? 'AI Review Khulasa' : 'AI Review Summary'}
          </CardTitle>
          {/* Overall verdict */}
          <Badge className={verdictBadgeClass(summary.averageRating)}>{summary.verdict}</Badge>
        </div>
        <CardDescription className="flex flex-wrap items-center gap-1">
          <span className="flex items-center gap-1">
            <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
            {summary.averageRating.toFixed(1)} average from {summary.totalReviews} review
            {summary.totalReviews === 1 ? '' : 's'}
          </span>
          {summary.verifiedAverageRating !== null && summary.verifiedCount > 0 && (
            <span>
              · Verified buyers average {summary.verifiedAverageRating.toFixed(1)} ({summary.verifiedCount} verified)
            </span>
          )}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* Brief language-aware sentiment sentence */}
        {sentiment !== null && brief !== null && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={sentimentBadgeClass(sentiment.overall)}>
                {sentimentLabel(sentiment.overall, isUr)}
              </Badge>
              {sentiment.basis === 'verified' && (
                <span className="flex items-center gap-1 text-xs font-medium text-green-700 dark:text-green-300">
                  <BadgeCheck className="h-3.5 w-3.5" />
                  {isUr
                    ? `${sentiment.verifiedCount} tasdeeq shuda reviews ki bunyad par`
                    : `Based on ${sentiment.verifiedCount} verified review${sentiment.verifiedCount === 1 ? '' : 's'}`}
                </span>
              )}
            </div>
            <p className="text-base font-medium leading-relaxed">{brief}</p>
            {sentiment.basis === 'all' && (
              <p className="text-xs text-muted-foreground">
                {isUr
                  ? `Is khulase ki bunyad ${sentiment.basisReviews} reviews hain — abhi koi tasdeeq shuda review nahi hai.`
                  : `Based on ${sentiment.basisReviews} review${sentiment.basisReviews === 1 ? '' : 's'} — none verified yet.`}
              </p>
            )}
            {sentiment.lowConfidence && (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                {isUr
                  ? `Ibtidai andaza hai — sirf ${sentiment.basisReviews} review${sentiment.basisReviews === 1 ? '' : 's'} ki bunyad par, mazeed reviews aane par ye badal sakta hai.`
                  : `Early impression — based on only ${sentiment.basisReviews} review${sentiment.basisReviews === 1 ? '' : 's'}, this may change as more reviews arrive.`}
              </p>
            )}
          </div>
        )}

        {/* Legacy short summary (only when no sentiment block exists) */}
        {sentiment === null && <p className="text-sm leading-relaxed">{summary.summary}</p>}

        {/* Pros / Cons */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg bg-green-50 p-4 dark:bg-green-950/40">
            <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-green-700 dark:text-green-300">
              <ThumbsUp className="h-4 w-4" /> {isUr ? 'Achaiyan — khareedaron ko kya pasand hai' : 'Pros — what buyers like'}
            </p>
            {pros.length > 0 ? (
              <ul className="space-y-1.5">
                {pros.map((item, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-sm text-muted-foreground">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{prosEmptyText}</p>
            )}
          </div>

          <div className="rounded-lg bg-red-50 p-4 dark:bg-red-950/40">
            <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-red-700 dark:text-red-300">
              <ThumbsDown className="h-4 w-4" /> {isUr ? 'Kamzoriyan — shikayatein' : 'Cons — what buyers complain about'}
            </p>
            {cons.length > 0 ? (
              <ul className="space-y-1.5">
                {cons.map((item, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-sm text-muted-foreground">
                    <X className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{consEmptyText}</p>
            )}
          </div>
        </div>

        {/* Aspect chips */}
        {sentiment !== null && sentiment.aspects.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {sentiment.aspects.map((a) => (
              <Badge
                key={a.aspect}
                variant="outline"
                className={cn(
                  'text-xs',
                  a.sentiment === 'positive' && 'border-green-300 text-green-700 dark:border-green-700 dark:text-green-300',
                  a.sentiment === 'negative' && 'border-red-300 text-red-700 dark:border-red-700 dark:text-red-300'
                )}
              >
                {isUr ? a.labelUr : a.label}: {sentimentLabel(a.sentiment, isUr)} · {a.mentions} mention{a.mentions === 1 ? '' : 's'}
              </Badge>
            ))}
          </div>
        )}

        {/* Most-discussed themes (legacy, kept) */}
        {summary.themes.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {summary.themes.map((t) => (
              <Badge key={t.theme} variant="outline" className="text-xs">
                {t.theme}: {t.positiveCount} positive · {t.negativeCount} negative
              </Badge>
            ))}
          </div>
        )}

        {/* Most helpful review */}
        {summary.mostHelpful && (
          <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
            <p className="text-xs font-medium text-muted-foreground">
              Most helpful review · {summary.mostHelpful.helpfulCount} helpful · {summary.mostHelpful.rating} stars
              {summary.mostHelpful.authorName ? ` · ${summary.mostHelpful.authorName}` : ''}
            </p>
            {summary.mostHelpful.title && <p className="mt-1 font-medium">{summary.mostHelpful.title}</p>}
            {summary.mostHelpful.content && (
              <p className="mt-1 text-sm text-muted-foreground">{summary.mostHelpful.content}</p>
            )}
            {summary.mostHelpful.sourceUrl && (
              <a
                href={summary.mostHelpful.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
              >
                Original review <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        )}

        {/* Original-review sources */}
        {sentiment !== null && sentiment.sources.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>Original reviews:</span>
            {sentiment.sources.map((s) => (
              <a
                key={s.url}
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-medium text-blue-600 hover:underline"
              >
                {s.name} <ExternalLink className="h-3 w-3" />
              </a>
            ))}
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Summarised from real customer reviews only — no review text is sent to any external AI service.
        </p>
      </CardContent>
    </Card>
  );
}
