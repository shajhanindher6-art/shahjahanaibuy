/**
 * Greenwashing & Marketing Fluff Detector (Option 10, Feature 4).
 *
 * Scans the product's REAL listing text (name + description only — never
 * text that doesn't exist) for a stated buzzword/hype lexicon. A flagged
 * phrase is quoted with its count; it is analysis, NOT a legal finding.
 * Flagged claims are "unverified" unless backed by a recorded product
 * attribute — this catalog records no certifications, so in practice a
 * flagged claim is unverified. Wording is never "lie" or "fraud": a
 * flagged phrase is not proof of deception.
 *
 * STATED FORMULA — fluff index (0-100):
 *   index = min(100, round((flaggedPhraseOccurrences / totalWords) * 500))
 * i.e. 5 flagged phrases in 100 words scores 25. The formula and the
 * flagged phrases are shown in the UI so the score is reproducible from
 * the shown text.
 */

export interface FlaggedPhrase {
  phrase: string;
  count: number;
  /** Always 'unverified' in this catalog: no certification field exists. */
  status: 'unverified';
}

export interface FluffAnalysis {
  /** 'not_enough_text' when the listing has fewer than MIN_WORDS words. */
  status: 'analyzed' | 'not_enough_text';
  wordCount: number;
  flaggedCount: number;
  fluffIndex: number | null;
  flagged: FlaggedPhrase[];
  /** The exact text that was scanned (name + description). */
  scannedText: string;
}

/** Below this many words the analyzer refuses to score — it never invents one. */
export const MIN_WORDS = 10;

/**
 * Hype/marketing phrases. Matching is case-insensitive with word
 * boundaries, so "premium" matches "Premium quality" but not "supremium".
 * Each entry is a phrase as a shopper would read it, not a legal term.
 */
const LEXICON: string[] = [
  "world's best",
  'world best',
  'best-in-class',
  'best in class',
  'revolutionary',
  'groundbreaking',
  'cutting-edge',
  'state-of-the-art',
  'next-gen',
  'next generation',
  'ultimate',
  'unparalleled',
  'unmatched',
  'premium',
  'professional-grade',
  'pro-grade',
  'superior',
  'finest',
  'exceptional',
  'incredible',
  'amazing',
  'perfect',
  'eco-friendly',
  'environmentally friendly',
  'green',
  'natural',
  'all-natural',
  'sustainable',
  'advanced',
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function analyzeFluff(name: string | null, description: string | null): FluffAnalysis {
  const scannedText = [name ?? '', description ?? ''].join(' ').replace(/\s+/g, ' ').trim();
  const words = scannedText ? scannedText.split(' ').filter(Boolean) : [];
  const wordCount = words.length;

  if (wordCount < MIN_WORDS) {
    return {
      status: 'not_enough_text',
      wordCount,
      flaggedCount: 0,
      fluffIndex: null,
      flagged: [],
      scannedText,
    };
  }

  const lower = scannedText.toLowerCase();
  const flagged: FlaggedPhrase[] = [];
  let flaggedCount = 0;
  for (const phrase of LEXICON) {
    const re = new RegExp(`\\b${escapeRegExp(phrase)}\\b`, 'g');
    const matches = lower.match(re);
    if (matches && matches.length > 0) {
      flagged.push({ phrase, count: matches.length, status: 'unverified' });
      flaggedCount += matches.length;
    }
  }

  const fluffIndex = Math.min(100, Math.round((flaggedCount / wordCount) * 500));
  return { status: 'analyzed', wordCount, flaggedCount, fluffIndex, flagged, scannedText };
}
