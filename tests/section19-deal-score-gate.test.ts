/**
 * Section 19, Phase 2 — Deal Score gate enforcement (§12 #30,
 * audit §14 #7; task item 1).
 *
 * The 100/100-on-every-product problem is a DATA problem as much
 * as a formula problem: 4 recorded points → discount probability
 * 0, confidence 20 → 100 − 0 + 30 + 6 = 136, clamped to 100. No
 * re-weighting fixes that without inventing a spread the data
 * does not support, so the formula is deliberately NOT rebased.
 * Instead the score is WITHHELD below 5 data points — and this
 * test pins both halves:
 *   (a) dealScoreForDisplay returns null below 5 points and the
 *       real score at/above 5 (behavioural gate);
 *   (b) NO production caller can obtain a numeric score below 5
 *       points — a source grep over app/components/services/lib
 *       asserting that the raw formula (computeDealScore /
 *       computeDealScoreFromPrediction) is called only from
 *       lib/deal-score.ts itself and from the Deal Score
 *       Breakdown tool (lib/deal-score-breakdown.ts), the one
 *       diagnostic that shows the raw terms WITH the withheld
 *       warning. Every other surface must go through
 *       dealScoreForDisplay.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  computeDealScore,
  dealScoreForDisplay,
  DEAL_SCORE_MIN_DATA_POINTS,
} from '@/lib/deal-score';

const FOUR_POINT_PREDICTION = {
  discountProbability: 0,
  currentPrice: 999,
  lowestPrice: 999,
  confidenceScore: 20,
  dataPoints: 4,
};

describe('dealScoreForDisplay — the score is withheld below 5 data points', () => {
  it('returns null for the live 4-point case (raw formula would say 100)', () => {
    expect(computeDealScore(FOUR_POINT_PREDICTION)).toBe(100);
    expect(dealScoreForDisplay(FOUR_POINT_PREDICTION)).toBeNull();
  });

  it('returns null when the point count is unknown (never guessed)', () => {
    expect(
      dealScoreForDisplay({ ...FOUR_POINT_PREDICTION, dataPoints: null })
    ).toBeNull();
    expect(
      dealScoreForDisplay({ ...FOUR_POINT_PREDICTION, dataPoints: undefined })
    ).toBeNull();
  });

  it('returns the real score once the prediction rests on 5 points', () => {
    expect(dealScoreForDisplay({ ...FOUR_POINT_PREDICTION, dataPoints: 5 })).toBe(100);
    expect(
      dealScoreForDisplay({
        discountProbability: 50,
        currentPrice: 900,
        lowestPrice: 800,
        confidenceScore: 60,
        dataPoints: 6,
      })
      // Raw: 100 − 50×0.4 + (800/900)×30 + 60×0.3 = 124.7 → clamped to 100.
    ).toBe(100);
  });

  it('returns null for a missing prediction', () => {
    expect(dealScoreForDisplay(null)).toBeNull();
    expect(dealScoreForDisplay(undefined)).toBeNull();
  });

  it('the threshold is 5 — the stricter side of the §12 #30 unification', () => {
    expect(DEAL_SCORE_MIN_DATA_POINTS).toBe(5);
  });
});

describe('Deal Score — no production caller bypasses the gate', () => {
  // Walk the production source tree (not tests, not node_modules)
  // and collect every file that CALLS the raw formula. Comments
  // and doc mentions are stripped first so a file that merely
  // names the function in prose does not false-positive.
  function productionFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      if (statSync(full).isDirectory()) out.push(...productionFiles(full));
      else if (/\.tsx?$/.test(entry)) out.push(full);
    }
    return out;
  }

  function stripComments(source: string): string {
    return source
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|\s)\/\/.*$/gm, ' ');
  }

  it('only lib/deal-score.ts and lib/deal-score-breakdown.ts call the raw formula', () => {
    const root = process.cwd();
    const offenders: string[] = [];
    for (const dir of ['app', 'components', 'services', 'lib']) {
      for (const file of productionFiles(join(root, dir))) {
        const rel = file.slice(root.length + 1);
        if (rel === 'lib/deal-score.ts' || rel === 'lib/deal-score-breakdown.ts') continue;
        const source = stripComments(readFileSync(file, 'utf8'));
        if (
          /\bcomputeDealScore\s*\(/.test(source) ||
          /\bcomputeDealScoreFromPrediction\s*\(/.test(source)
        ) {
          offenders.push(rel);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
