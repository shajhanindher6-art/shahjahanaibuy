'use client';

import { cn } from '@/lib/utils';
import { TrendingDown, TrendingUp, Clock, CheckCircle2 } from 'lucide-react';

interface BestTimeToBuyProps {
  discountProbability: number;
  currentPrice: number | null;
  averagePrice: number | null;
  lowestPrice: number | null;
  expectedSaleDate: string | null;
  className?: string;
}

type Recommendation = 'buy_now' | 'wait' | 'monitor';

function getRecommendation(
  discountProbability: number,
  currentPrice: number | null,
  averagePrice: number | null
): Recommendation {
  if (currentPrice && averagePrice && currentPrice <= averagePrice * 0.95) {
    return 'buy_now';
  }
  if (discountProbability >= 60) {
    return 'wait';
  }
  return 'monitor';
}

const config = {
  buy_now: {
    icon: CheckCircle2,
    label: 'Buy Now',
    description: 'Current price is at or below the historical average — this is a good time to buy.',
    bg: 'bg-emerald-50 dark:bg-emerald-950/50',
    border: 'border-emerald-200 dark:border-emerald-800',
    text: 'text-emerald-700 dark:text-emerald-300',
    iconColor: 'text-emerald-500',
  },
  wait: {
    icon: TrendingDown,
    label: 'Wait for Sale',
    description: 'High probability of a price drop soon. Consider waiting for a better deal.',
    bg: 'bg-amber-50 dark:bg-amber-950/50',
    border: 'border-amber-200 dark:border-amber-800',
    text: 'text-amber-700 dark:text-amber-300',
    iconColor: 'text-amber-500',
  },
  monitor: {
    icon: Clock,
    label: 'Monitor Price',
    description: 'Price is stable. Set up a price alert to be notified when it drops.',
    bg: 'bg-blue-50 dark:bg-blue-950/50',
    border: 'border-blue-200 dark:border-blue-800',
    text: 'text-blue-700 dark:text-blue-300',
    iconColor: 'text-blue-500',
  },
};

export function BestTimeToBuyIndicator({
  discountProbability,
  currentPrice,
  averagePrice,
  expectedSaleDate,
  className,
}: BestTimeToBuyProps) {
  const rec = getRecommendation(discountProbability, currentPrice, averagePrice);
  const cfg = config[rec];
  const Icon = cfg.icon;

  return (
    <div className={cn('rounded-xl border p-4', cfg.bg, cfg.border, className)}>
      <div className="flex items-start gap-3">
        <Icon className={cn('mt-0.5 h-6 w-6 flex-shrink-0', cfg.iconColor)} />
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h4 className={cn('font-bold', cfg.text)}>{cfg.label}</h4>
            <span className={cn('text-xs font-medium', cfg.text)}>
              {Math.round(discountProbability)}% discount probability
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{cfg.description}</p>
          {expectedSaleDate && rec !== 'buy_now' && (
            <p className={cn('mt-1.5 text-xs font-medium', cfg.text)}>
              Next predicted sale: {new Date(expectedSaleDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
