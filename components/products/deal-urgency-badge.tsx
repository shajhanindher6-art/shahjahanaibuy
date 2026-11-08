'use client';

import { Clock, Flame } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { DealUrgency } from '@/services/deal-urgency';

/**
 * Deal Urgency badge (Enterprise #11) — real signals only.
 *
 * Renders NOTHING when urgency.level is 'none' (no end time, no
 * low-stock, no recorded drop). The label names the level; the
 * title lists the exact recorded reasons (e.g. "Coupon expires in
 * 18h · Only 2 left in stock"). No demand, views, or sales rates
 * are ever shown — this project has no such data.
 */
const LEVEL_STYLE: Record<Exclude<DealUrgency['level'], 'none'>, { label: string; className: string }> = {
  high: {
    label: 'Urgent deal',
    className:
      'border-red-200 bg-red-50 text-xs text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300',
  },
  medium: {
    label: 'Ending soon',
    className:
      'border-amber-200 bg-amber-50 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300',
  },
  low: {
    label: 'Limited time',
    className: 'text-xs',
  },
};

export function DealUrgencyBadge({ urgency }: { urgency: DealUrgency }) {
  if (urgency.level === 'none') return null;
  const style = LEVEL_STYLE[urgency.level];
  const Icon = urgency.level === 'high' ? Flame : Clock;
  return (
    <Badge variant="secondary" className={style.className} title={urgency.reasons.join(' · ')}>
      <Icon className="mr-1 h-3 w-3" />
      {style.label}
    </Badge>
  );
}
