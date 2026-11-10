/**
 * Store trust-score card (Section 3 #14).
 *
 * Renders a deterministic trust grade computed ONLY from recorded
 * policy data (return window / warranty / reputation). When any input
 * is missing — which is every merchant today — it renders an honest
 * "Not enough data" state naming exactly which facts are still
 * missing, never a guessed grade.
 */

'use client';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { TrustGradeResult } from '@/lib/merchant-trust';
import { TRUST_GRADE_INSUFFICIENT_LABEL } from '@/lib/merchant-trust';
import { cn } from '@/lib/utils';

const GRADE_STYLES: Record<string, string> = {
  A: 'border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300',
  B: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300',
  C: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300',
  D: 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300',
};

interface TrustScoreCardProps {
  merchantName: string;
  result: TrustGradeResult;
}

export function TrustScoreCard({ merchantName, result }: TrustScoreCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Store trust score — {merchantName}</CardTitle>
        <CardDescription>
          Grade A (≥85) / B (≥70) / C (≥50) / D (&lt;50) from recorded return window (0–40),
          warranty (0–30) and reputation (0–30). No values are ever assumed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {result.grade === null || result.score === null ? (
          <>
            <Badge variant="secondary">{TRUST_GRADE_INSUFFICIENT_LABEL}</Badge>
            <p className="text-muted-foreground">{result.reasons[0]}</p>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className={cn('text-sm', GRADE_STYLES[result.grade])}>
                Grade {result.grade}
              </Badge>
              <span className="font-medium">{result.score} / 100</span>
            </div>
            <ul className="space-y-1 text-muted-foreground">
              {result.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
