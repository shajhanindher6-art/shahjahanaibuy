'use client';

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
    bg: 'bg-slate-400',
    text: 'text-slate-600 dark:text-slate-400',
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

  return (
    <div className={cn('flex items-center', dims.gap, className)}>
      <div
        className={cn(
          'flex items-center justify-center rounded-full font-bold text-white shadow-sm ring-2',
          dims.badge,
          colors.bg,
          colors.ring
        )}
        title={`Deal Score: ${clampedScore}/100`}
      >
        {clampedScore}
      </div>
      {showLabel && (
        <span className={cn('font-medium', dims.font, colors.text)}>{colors.label}</span>
      )}
    </div>
  );
}
