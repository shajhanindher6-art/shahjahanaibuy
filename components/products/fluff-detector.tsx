'use client';

import { SearchCheck } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { analyzeFluff, MIN_WORDS } from '@/services/fluff-detector';

/**
 * Greenwashing & Marketing Fluff Detector (Option 10, Feature 4).
 * Scans the product's REAL listing text (name + description only) against
 * a stated buzzword lexicon. Flagged phrases are quoted with counts and
 * labeled "unverified" — analysis, never a legal finding, never "lie" or
 * "fraud". The fluff index formula is shown so the score is reproducible
 * from the shown text. Short/empty text yields "not enough text", never
 * an invented score.
 */
export function FluffDetector({
  productName,
  description,
}: {
  productName: string;
  description: string | null;
}) {
  const analysis = analyzeFluff(productName, description);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <SearchCheck className="h-5 w-5 text-teal-600" /> Marketing fluff check
        </CardTitle>
        <CardDescription>
          Scans this listing&apos;s own text for hype phrases. Analysis only — a flagged phrase is
          not proof of deception.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {analysis.status === 'not_enough_text' ? (
          <p className="text-sm text-muted-foreground">
            Not enough text to analyze — this listing has only {analysis.wordCount} word
            {analysis.wordCount === 1 ? '' : 's'} (at least {MIN_WORDS} needed). No score is shown
            rather than an invented one.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge variant="secondary">Fluff index {analysis.fluffIndex}/100</Badge>
              <Badge variant="secondary">
                {analysis.flaggedCount} flagged phrase occurrence
                {analysis.flaggedCount === 1 ? '' : 's'} in {analysis.wordCount} words
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Formula: fluff index = min(100, round((flagged occurrences ÷ total words) × 500)).
            </p>
            {analysis.flagged.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No hype phrases from the lexicon were found in this listing text.
              </p>
            ) : (
              <ul className="space-y-1 text-sm">
                {analysis.flagged.map((f) => (
                  <li key={f.phrase}>
                    <span className="font-medium">“{f.phrase}”</span> × {f.count} —{' '}
                    <span className="text-muted-foreground">
                      unverified claim (no certification or attribute in this record backs it)
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">
              “Unverified” means this record contains nothing backing the claim — it does not mean
              the claim is false.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
