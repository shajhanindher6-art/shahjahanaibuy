/**
 * Price-accuracy "Caution" flag (Section 5 #7).
 *
 * Renders only from a computed accuracy result:
 *   * caution → a visible "Caution" badge with the recorded score
 *     and sample count (flag needs score < 95% AND ≥ 5 samples).
 *   * insufficient → a muted "No audits yet" note, never a score.
 *   * ok → nothing (a clean retailer gets no badge — the absence of
 *     a flag is not itself a claim).
 *
 * The flag is evidence, not an accusation: the copy states the
 * recorded samples behind it.
 */

'use client';

import { Badge } from '@/components/ui/badge';
import type { AccuracyCheck } from '@/lib/price-accuracy';

interface AccuracyFlagProps {
  result: AccuracyCheck;
  merchantName: string;
}

export function AccuracyFlag({ result, merchantName }: AccuracyFlagProps) {
  if (result.status === 'ok') return null;

  if (result.status === 'insufficient') {
    return (
      <p className="text-xs text-muted-foreground">
        No price-accuracy audits recorded for {merchantName} yet — no score, no flag.
      </p>
    );
  }

  return (
    <div className="space-y-1">
      <Badge variant="destructive">
        Caution — {merchantName} price accuracy {result.score}%
      </Badge>
      <p className="text-xs text-muted-foreground">
        Only {result.matchCount} of {result.sampleCount} recorded checkout prices matched the
        listed price (within 1%). Treat this retailer&apos;s listed prices with caution until
        more audits are recorded.
      </p>
    </div>
  );
}
