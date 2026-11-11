'use client';

import { useState } from 'react';
import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DealScoreBadgeProps {
  score: number;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  className?: string;
}

function getScoreColor(score: number): { bg: string; text: string; ring: string; label: string } {
  if (score >= 80) {
    return {
      bg: 'bg-emerald-500',
      text: 'text-emerald-700 dark:text-emerald-300',
      ring: 'ring-emerald-500/20',
      label: 'Excellent Deal',
    };
  }
  if (score >= 60) {
    return {
      bg: 'bg-blue-500',
      text: 'text-blue-700 dark:text-blue-300',
      ring: 'ring-blue-500/20',
      label: 'Good Deal',
    };
  }
  if (score >= 40) {
    return {
      bg: 'bg-amber-500',
      text: 'text-amber-700 dark:text-amber-300',
      ring: 'ring-amber-500/20',
      label: 'Fair Deal',
    };
  }
  return {
    bg: 'bg-muted-foreground',
    text: 'text-muted-foreground',
    ring: 'ring-slate-400/20',
    label: 'Wait for Better Price',
  };
}

const sizeConfig = {
  sm: { badge: 'h-7 w-7 text-xs', font: 'text-xs', gap: 'gap-1.5' },
  md: { badge: 'h-10 w-10 text-sm', font: 'text-sm', gap: 'gap-2' },
  lg: { badge: 'h-14 w-14 text-lg', font: 'text-base', gap: 'gap-2.5' },
};

export function DealScoreBadge({ score, size = 'md', showLabel = false, className }: DealScoreBadgeProps) {
  const colors = getScoreColor(score);
  const dims = sizeConfig[size];
  const clampedScore = Math.round(Math.max(0, Math.min(100, score)));
  // Section 13, Chunk C: the badge used to be a bare number with
  // only a title tooltip — zero explainer copy existed anywhere on
  // the site. The "How this score works" popover states the
  // canonical formula from lib/deal-score.ts in plain language.
  const [explainerOpen, setExplainerOpen] = useState(false);

  return (
    <div className={cn('relative flex items-center', dims.gap, className)}>
      <div
        className={cn(
          'flex items-center justify-center rounded-full font-bold text-white shadow-sm ring-2',
          dims.badge,
          colors.bg,
          colors.ring
        )}
        role="img"
        aria-label={`Deal Score ${clampedScore} out of 100: ${colors.label}`}
        title={`Deal Score: ${clampedScore}/100 — ${colors.label}`}
      >
        {clampedScore}
      </div>
      {showLabel && (
        <span className={cn('font-medium', dims.font, colors.text)}>{colors.label}</span>
      )}
      <button
        type="button"
        aria-expanded={explainerOpen}
        aria-label="How this score works"
        title="How this score works"
        onClick={() => setExplainerOpen((v) => !v)}
        className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-slate-100 hover:text-foreground dark:hover:bg-slate-800"
      >
        <Info className="h-4 w-4" />
      </button>
      {explainerOpen && (
        <div
          role="dialog"
          aria-label="How the Deal Score works"
          className="absolute left-0 top-full z-20 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-lg border bg-card p-3 text-xs leading-relaxed shadow-lg"
        >
          <p className="font-semibold text-sm">How this score works</p>
          <p className="mt-1 text-muted-foreground">
            Score = 100 − (chance of a future price drop × 0.4) + price term +
            (confidence × 0.3), rounded to 0–100.
          </p>
          <p className="mt-1 text-muted-foreground">
            The price term (up to +30) rewards a price at or near its lowest
            recorded price. A high chance of a future drop <em>lowers</em> the
            score, because waiting may pay off — so a high score means
            &ldquo;good now, no drop expected&rdquo;.
          </p>
          <p className="mt-1 text-muted-foreground">
            Built from recorded price history only — never a live retailer
            price. Any discount % shown next to it comes from the
            merchant&rsquo;s compare-at price, a different number.
          </p>
        </div>
      )}
    </div>
  );
}
