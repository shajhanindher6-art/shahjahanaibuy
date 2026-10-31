/**
 * AI Product Review Summarizer — display component.
 *
 * Renders the template-based review summary produced by
 * services/review-summary.ts and served by
 * GET /api/v1/products/[slug]/review-summary:
 * a short summary, pros (what buyers like), cons (what buyers
 * complain about) and one overall verdict badge.
 *
 * Presentational only: it fetches nothing itself. The product page
 * already fetches the summary and passes it in, so this card never
 * blocks the page. Returns null when `summary` is null — that is the
 * 0-reviews case, where the page's existing "No reviews yet" empty
 * state shows instead.
 *
 * Styling is Tailwind + the project's shadcn Card/Badge primitives,
 * matching the rest of the product page (including dark mode).
 */

import { Check, Sparkles, Star, ThumbsDown, ThumbsUp, X } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { ReviewAISummary } from '@/types/ai';

export type { ReviewAISummary };

interface AIReviewSummarizerProps {
  summary: ReviewAISummary | null;
  className?: string;
}

function verdictBadgeClass(averageRating: number): string {
  if (averageRating >= 4.5) return 'bg-green-600 text-white hover:bg-green-600';
  if (averageRating >= 4) return 'bg-green-100 text-green-800 hover:bg-green-100 dark:bg-green-900 dark:text-green-100';
  if (averageRating >= 3) return 'bg-amber-100 text-amber-800 hover:bg-amber-100 dark:bg-amber-900 dark:text-amber-100';
  return 'bg-red-100 text-red-800 hover:bg-red-100 dark:bg-red-900 dark:text-red-100';
}

export function AIReviewSummarizer({ summary, className }: AIReviewSummarizerProps) {
  if (!summary) return null;

  return (
    <Card className={cn('mb-4', className)}>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4" /> AI Review Summary
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
        {/* Short summary */}
        <p className="text-sm leading-relaxed">{summary.summary}</p>

        {/* Pros / Cons */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg bg-green-50 p-4 dark:bg-green-950/40">
            <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-green-700 dark:text-green-300">
              <ThumbsUp className="h-4 w-4" /> Pros — what buyers like
            </p>
            {summary.positives.length > 0 ? (
              <ul className="space-y-1.5">
                {summary.positives.map((item, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-sm text-muted-foreground">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No clear pros mentioned yet.</p>
            )}
          </div>

          <div className="rounded-lg bg-red-50 p-4 dark:bg-red-950/40">
            <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-red-700 dark:text-red-300">
              <ThumbsDown className="h-4 w-4" /> Cons — what buyers complain about
            </p>
            {summary.concerns.length > 0 ? (
              <ul className="space-y-1.5">
                {summary.concerns.map((item, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-sm text-muted-foreground">
                    <X className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No recurring complaints mentioned yet.</p>
            )}
          </div>
        </div>

        {/* Most-discussed themes */}
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
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Summarised from real customer reviews only — no review text is sent to any external AI service.
        </p>
      </CardContent>
    </Card>
  );
}
