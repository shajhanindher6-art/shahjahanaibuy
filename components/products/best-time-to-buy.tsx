'use client';

import { cn } from '@/lib/utils';
import {
  TrendingDown,
  Clock,
  CheckCircle2,
  Bell,
  ArrowLeftRight,
} from 'lucide-react';

interface BestTimeToBuyProps {
  discountProbability: number;
  currentPrice: number | null;
  averagePrice: number | null;
  lowestPrice: number | null;
  /**
   * RETIRED — accepted for backward compatibility, never rendered.
   * Exact-date forecasts ("Next predicted sale: <date>") are not
   * shown: with few recorded points SmartBuy shows an estimate
   * with its confidence, not a predicted sale date (Section 19,
   * Phase 3, §12 #31). Any caller passing a date gets no date
   * rendered back — there is no code path that renders it.
   */
  expectedSaleDate: string | null;
  /**
   * Price of a cheaper alternative product in USD (Section 19,
   * Phase 3, §12 #32). When the current price is at least 5%
   * above it, the card says Compare Alternatives. Null when no
   * alternative is known — the component never invents one.
   */
  cheaperAlternativePrice?: number | null;
  className?: string;
}

type Recommendation =
  | 'buy_now'
  | 'wait'
  | 'monitor'
  | 'track_price'
  | 'compare_alternatives';

/** TRACK PRICE when the price is near — but not at — its recorded low. */
const TRACK_PRICE_NEAR_LOW_FACTOR = 1.05;
/** COMPARE ALTERNATIVES when the alternative is at least 5% cheaper. */
const COMPARE_ALTERNATIVE_MIN_FACTOR = 1.05;

function getRecommendation(
  discountProbability: number,
  currentPrice: number | null,
  averagePrice: number | null,
  lowestPrice: number | null,
  cheaperAlternativePrice?: number | null
): Recommendation {
  if (currentPrice && averagePrice && currentPrice <= averagePrice * 0.95) {
    return 'buy_now';
  }
  if (
    currentPrice &&
    typeof cheaperAlternativePrice === 'number' &&
    Number.isFinite(cheaperAlternativePrice) &&
    cheaperAlternativePrice > 0 &&
    currentPrice > cheaperAlternativePrice * COMPARE_ALTERNATIVE_MIN_FACTOR
  ) {
    return 'compare_alternatives';
  }
  if (discountProbability >= 60) {
    return 'wait';
  }
  if (
    currentPrice &&
    lowestPrice &&
    currentPrice <= lowestPrice * TRACK_PRICE_NEAR_LOW_FACTOR
  ) {
    return 'track_price';
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
    // No timing is claimed: the legacy prediction carries a
    // probability, not a date — "soon" used to promise one.
    description: 'High discount probability in the prediction. Consider waiting for a better deal.',
    bg: 'bg-amber-50 dark:bg-amber-950/50',
    border: 'border-amber-200 dark:border-amber-800',
    text: 'text-amber-700 dark:text-amber-300',
    iconColor: 'text-amber-500',
  },
  monitor: {
    icon: Clock,
    label: 'Monitor Price',
    // (6) "Price is stable" stated a fact the prediction does not
    // contain — it only carries a discount probability. Reworded to
    // what the number actually says: no strong drop signal.
    description: 'No strong drop signal in the prediction. Set up a price alert to be notified when it drops.',
    bg: 'bg-blue-50 dark:bg-blue-950/50',
    border: 'border-blue-200 dark:border-blue-800',
    text: 'text-blue-700 dark:text-blue-300',
    iconColor: 'text-blue-500',
  },
  track_price: {
    icon: Bell,
    label: 'Track Price',
    // Section 19, Phase 3 (§12 #32): near the recorded low but no
    // strong buy or wait signal — the honest action is to track
    // the price, not to decide now.
    description:
      'Price is near its recorded low, but there is no strong buy or wait signal. Set a price alert and decide once more prices are recorded.',
    bg: 'bg-sky-50 dark:bg-sky-950/50',
    border: 'border-sky-200 dark:border-sky-800',
    text: 'text-sky-700 dark:text-sky-300',
    iconColor: 'text-sky-500',
  },
  compare_alternatives: {
    icon: ArrowLeftRight,
    label: 'Compare Alternatives',
    // Section 19, Phase 3 (§12 #32): a cheaper alternative exists
    // — compare it before buying at this price.
    description:
      'A cheaper alternative is available. Compare it against this product before buying at the current price.',
    bg: 'bg-violet-50 dark:bg-violet-950/50',
    border: 'border-violet-200 dark:border-violet-800',
    text: 'text-violet-700 dark:text-violet-300',
    iconColor: 'text-violet-500',
  },
};

export function BestTimeToBuyIndicator({
  discountProbability,
  currentPrice,
  averagePrice,
  lowestPrice,
  // expectedSaleDate is intentionally NOT destructured: it is accepted
  // for backward compatibility but never read or rendered (see the prop
  // comment above — exact-date forecasts are retired, Section 19 #31).
  cheaperAlternativePrice,
  className,
}: BestTimeToBuyProps) {
  const rec = getRecommendation(
    discountProbability,
    currentPrice,
    averagePrice,
    lowestPrice,
    cheaperAlternativePrice
  );
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
          <p className="mt-1 text-sm text-muted-foreground">{cfg.description}</p>
        </div>
      </div>
    </div>
  );
}
