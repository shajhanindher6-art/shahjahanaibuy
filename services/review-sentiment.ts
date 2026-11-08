/**
 * Aspect-based review sentiment engine — deterministic, no LLM, no
 * external call. The codebase has no LLM key and sends no review text
 * to any third party; everything here is keyword/lexicon scoring over
 * reviews already stored in the database.
 *
 * WHAT IT DOES
 * Given a product's reviews it produces: an overall sentiment
 * (positive / mixed / negative), one verdict per shopping aspect
 * (battery, price/value, build quality, display, camera, performance,
 * sound, comfort/design, plus an "overall" bucket for reviews that
 * mention no specific aspect), pros/cons aspect lists, and one brief
 * contrast summary sentence in English AND in Roman Urdu.
 *
 * LANGUAGE COVERAGE
 * Reviews may be written in English or Roman Urdu (Latin script).
 * The lexicon therefore carries both: English words (good, great,
 * poor, expensive, cheap) and Roman Urdu words (achi, behtareen,
 * zabardast, kharab, mehnga, sasta). Roman Urdu here means the
 * Latin-script transliteration users actually type — this engine
 * does NOT handle Urdu in Arabic script.
 *
 * NEGATION (basic, documented limit)
 * A sentiment word's polarity flips when a negator appears within 2
 * tokens before OR after it: "not good", "never good", "achi nahi",
 * "good nahi". This covers the common cases; it does not understand
 * sarcasm, double negation ("not bad" still reads as negated "bad"
 * → positive, which happens to be right, but "not terrible" style
 * nuance is not modelled), or sentiment that depends on a clause
 * far away from the sentiment word.
 *
 * ASPECT ATTRIBUTION (documented limit)
 * Sentiment is scored per REVIEW (lexicon sum + a rating prior:
 * rating >= 4 adds +1, rating <= 2 adds -1, 3-star adds 0) and that
 * score is attributed to every aspect the review mentions. It is
 * NOT per-sentence attribution: a review praising battery but
 * criticising price in the same text will push both aspects toward
 * its net sentiment. The rating prior keeps the verdicts honest
 * when a review's words are neutral ("battery is ok, price is ok"
 * from a 5-star reviewer still counts as positive evidence).
 *
 * WORD-POLARITY DEPENDS ON ASPECT (one deliberate rule)
 * "cheap" is positive for price ("cheap and good value") but
 * negative for build ("feels cheap"). The lexicon therefore allows
 * per-aspect overrides: a word's default polarity applies unless
 * the aspect being scored overrides it.
 *
 * HONESTY RULES (enforced by the caller, mirrored here)
 * - This engine never invents a review, rating, or mention: every
 *   count derives from the reviews passed in. Empty input returns
 *   null, so callers show the "No reviews yet" state, never a
 *   generated summary.
 * - It never fetches or scrapes reviews from the internet. It
 *   summarises only reviews stored in the database (user-submitted
 *   via the review form, or imported rows carrying source_url).
 *   If the owner later imports real sourced reviews, this engine
 *   summarises them with no code change.
 */

// ---------------------------------------------------------------------------
// Natural (AFINN) English signal — deep imports only (see note below)
// ---------------------------------------------------------------------------

// natural is imported as SPECIFIC FILES, never the package root and never
// the submodule barrels. The root ('natural') pulls in wordnet /
// spellcheck / classifiers that require Node's `fs`, and even the
// tokenizers barrel pulls in tokenizer_ja / treebank (Node `util`) —
// either breaks the browser bundle, and review-authenticity.ts runs
// inside 'use client' components with no webpack `fs`/`util` fallback.
// These files are pure JavaScript (JSON lexicons, underscore,
// no Node APIs — verified by reading their require chains), so they
// bundle safely for both the server (this engine) and the browser.
// `ngrams` here IS natural's NGrams.ngrams (the barrel just re-exports
// this file as the NGrams object).
//
// The SentimentAnalyzer CLASS is deliberately NOT imported: its file
// does `require('afinn-165')`, and afinn-165 ships ESM-only
// ("type": "module"), so webpack fails the production build with
// "ESM packages (afinn-165) need to be imported" — and
// transpilePackages does NOT fix it. The class is a thin wrapper
// around the AFINN wordlist, so this engine imports the wordlist
// directly (ESM import, which webpack handles) and re-implements
// getSentiment faithfully below (see afinnAverage).
import { afinn165 } from 'afinn-165';
import PorterStemmer from 'natural/lib/natural/stemmers/porter_stemmer';
import { WordTokenizer } from 'natural/lib/natural/tokenizers/regexp_tokenizer';

// ---------------------------------------------------------------------------
// Types (input is intentionally minimal so the engine is testable with
// fake reviews and has no database dependency)
// ---------------------------------------------------------------------------

export interface SentimentReviewInput {
  rating: number;
  title: string | null;
  content: string | null;
  verified_purchase: boolean;
}

export type SentimentLabel = 'positive' | 'mixed' | 'negative';

export type AspectId =
  | 'battery'
  | 'price'
  | 'build'
  | 'display'
  | 'camera'
  | 'performance'
  | 'sound'
  | 'comfort'
  | 'overall';

export interface AspectVerdict {
  aspect: AspectId;
  /** English display label, e.g. "Battery". */
  label: string;
  /** Roman Urdu display label, e.g. "battery". */
  labelUr: string;
  sentiment: SentimentLabel;
  /** Reviews mentioning this aspect. */
  mentions: number;
  positive: number;
  negative: number;
  /** Net strength: positive - negative, used to rank pros/cons. */
  strength: number;
}

export interface SentimentAnalysis {
  overall: SentimentLabel;
  averageRating: number;
  /** Reviews actually used for the analysis (verified subset when any exist). */
  basisReviews: number;
  totalReviews: number;
  verifiedCount: number;
  /** 'verified' = headline computed from verified reviews only. */
  basis: 'verified' | 'all';
  /** True when the basis is 1-2 reviews: an early impression, not a verdict. */
  lowConfidence: boolean;
  aspects: AspectVerdict[];
  /** Strongest positive aspects, labels only. */
  pros: string[];
  prosUr: string[];
  /** Strongest negative aspects, labels only. */
  cons: string[];
  consUr: string[];
  /** One brief contrast sentence (English). Null when no aspect verdict exists. */
  briefSummaryEn: string | null;
  /** One brief contrast sentence (Roman Urdu). Null when no aspect verdict exists. */
  briefSummaryUr: string | null;
}

// ---------------------------------------------------------------------------
// Aspect keyword maps (English + Roman Urdu, Latin script)
// ---------------------------------------------------------------------------

interface AspectDef {
  id: AspectId;
  label: string;
  labelUr: string;
  keywords: string[];
}

const ASPECTS: AspectDef[] = [
  {
    id: 'battery',
    label: 'Battery',
    labelUr: 'battery',
    keywords: ['battery', 'charge', 'charging', 'backup', 'lasts all day', 'battery life'],
  },
  {
    id: 'price',
    label: 'Price / value',
    labelUr: 'qeemat',
    keywords: ['price', 'value', 'worth', 'expensive', 'cheap', 'affordable', 'overpriced', 'qeemat', 'mehnga', 'mehngi', 'sasta', 'sasti', 'paisa', 'paisay'],
  },
  {
    id: 'display',
    label: 'Display',
    labelUr: 'display',
    keywords: ['screen', 'display', 'brightness', 'resolution', 'oled', 'retina'],
  },
  {
    id: 'camera',
    label: 'Camera',
    labelUr: 'camera',
    keywords: ['camera', 'photo', 'picture', 'tasveer'],
  },
  {
    id: 'performance',
    label: 'Performance',
    labelUr: 'performance',
    keywords: ['fast', 'speed', 'performance', 'lag', 'slow', 'processor', 'chip', 'hang', 'tez'],
  },
  {
    id: 'build',
    label: 'Build quality',
    labelUr: 'build quality',
    keywords: ['build', 'durable', 'sturdy', 'premium', 'plastic', 'fragile', 'broke', 'broken', 'mazboot', 'toot', 'tut'],
  },
  {
    id: 'sound',
    label: 'Sound',
    labelUr: 'sound',
    keywords: ['sound', 'audio', 'speaker', 'bass', 'noise', 'awaz'],
  },
  {
    id: 'comfort',
    label: 'Comfort / design',
    labelUr: 'design',
    keywords: ['comfort', 'comfortable', 'design', 'lightweight', 'heavy', 'portable', 'carry', 'compact', 'araam', 'halka', 'bhari', 'dekhne'],
  },
];

// ---------------------------------------------------------------------------
// Sentiment lexicon (English + Roman Urdu). Polarity: +1 / -1.
// perAspect overrides polarity for one aspect (see "cheap" rule above).
// ---------------------------------------------------------------------------

interface LexiconEntry {
  word: string;
  polarity: 1 | -1;
  pricePolarity?: 1 | -1;
  buildPolarity?: 1 | -1;
}

const LEXICON: LexiconEntry[] = [
  // English positive
  { word: 'good', polarity: 1 },
  { word: 'great', polarity: 1 },
  { word: 'excellent', polarity: 1 },
  { word: 'amazing', polarity: 1 },
  { word: 'awesome', polarity: 1 },
  { word: 'fantastic', polarity: 1 },
  { word: 'brilliant', polarity: 1 },
  { word: 'superb', polarity: 1 },
  { word: 'perfect', polarity: 1 },
  { word: 'impressive', polarity: 1 },
  { word: 'smooth', polarity: 1 },
  { word: 'love', polarity: 1 },
  { word: 'loved', polarity: 1 },
  { word: 'best', polarity: 1 },
  { word: 'nice', polarity: 1 },
  { word: 'decent', polarity: 1 },
  { word: 'solid', polarity: 1 },
  { word: 'reliable', polarity: 1 },
  { word: 'comfortable', polarity: 1 },
  { word: 'affordable', polarity: 1 },
  { word: 'worth', polarity: 1 },
  // English negative
  { word: 'bad', polarity: -1 },
  { word: 'poor', polarity: -1 },
  { word: 'terrible', polarity: -1 },
  { word: 'awful', polarity: -1 },
  { word: 'worst', polarity: -1 },
  { word: 'disappointing', polarity: -1 },
  { word: 'disappointed', polarity: -1 },
  { word: 'weak', polarity: -1 },
  { word: 'broken', polarity: -1 },
  { word: 'defective', polarity: -1 },
  { word: 'faulty', polarity: -1 },
  { word: 'slow', polarity: -1 },
  { word: 'laggy', polarity: -1 },
  { word: 'expensive', polarity: -1 },
  { word: 'overpriced', polarity: -1 },
  { word: 'noisy', polarity: -1 },
  { word: 'uncomfortable', polarity: -1 },
  // "cheap": positive for price, negative for build, neutral-negative elsewhere.
  { word: 'cheap', polarity: -1, pricePolarity: 1 },
  // Roman Urdu positive (Latin script)
  { word: 'acha', polarity: 1 },
  { word: 'achi', polarity: 1 },
  { word: 'achha', polarity: 1 },
  { word: 'achhi', polarity: 1 },
  { word: 'behtareen', polarity: 1 },
  { word: 'zabardast', polarity: 1 },
  { word: 'shandar', polarity: 1 },
  { word: 'lajawab', polarity: 1 },
  { word: 'umda', polarity: 1 },
  { word: 'kamaal', polarity: 1 },
  { word: 'pasand', polarity: 1 },
  { word: 'mazboot', polarity: 1 },
  { word: 'khoobsurat', polarity: 1 },
  // Roman Urdu negative (Latin script)
  { word: 'kharab', polarity: -1 },
  { word: 'bura', polarity: -1 },
  { word: 'buri', polarity: -1 },
  { word: 'bekaar', polarity: -1 },
  { word: 'ghatiya', polarity: -1 },
  { word: 'mehnga', polarity: -1 },
  { word: 'mehngi', polarity: -1 },
  { word: 'sasta', polarity: 1, buildPolarity: -1 },
  { word: 'sasti', polarity: 1, buildPolarity: -1 },
];

const LEXICON_MAP = new Map<string, LexiconEntry>();
for (const entry of LEXICON) {
  LEXICON_MAP.set(entry.word, entry);
}

/** Negators checked within 2 tokens before or after a sentiment word. */
const NEGATORS = new Set([
  'not',
  'never',
  'no',
  "n't",
  'na',
  'nahi',
  'nahin',
  'nai',
  // NOTE: 'bilkul' is deliberately NOT a negator — it is an
  // intensifier ("bilkul acha" = very good). "bilkul nahi" is
  // already caught by 'nahi' itself.
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/n't/g, " n't")
    .split(/[^a-z0-9'’]+/)
    .filter((t) => t.length > 0);
}

function detectAspects(normalizedText: string): AspectId[] {
  const found: AspectId[] = [];
  for (const aspect of ASPECTS) {
    if (aspect.keywords.some((kw) => normalizedText.includes(kw))) {
      found.push(aspect.id);
    }
  }
  return found.length > 0 ? found : ['overall'];
}

function polarityFor(entry: LexiconEntry, aspect: AspectId): 1 | -1 {
  if (aspect === 'price' && entry.pricePolarity !== undefined) return entry.pricePolarity;
  if (aspect === 'build' && entry.buildPolarity !== undefined) return entry.buildPolarity;
  return entry.polarity;
}

/** Score one review's text for one aspect: lexicon sum with negation flips. */
function scoreReviewForAspect(tokens: string[], aspect: AspectId): number {
  let score = 0;
  for (let i = 0; i < tokens.length; i++) {
    const entry = LEXICON_MAP.get(tokens[i]);
    if (!entry) continue;
    let polarity = polarityFor(entry, aspect);
    for (let d = 1; d <= 2; d++) {
      if (NEGATORS.has(tokens[i - d] ?? '') || NEGATORS.has(tokens[i + d] ?? '')) {
        polarity = (polarity * -1) as 1 | -1;
        break;
      }
    }
    score += polarity;
  }
  return score;
}

// --- Natural AFINN signal (English only) ----------------------------------

const wordTokenizer = new WordTokenizer();

// --- Local AFINN average (faithful re-implementation of natural's
// SentimentAnalyzer.getSentiment, without importing the class) --------
// The class constructor stems the vocabulary keys once (PorterStemmer)
// and getSentiment then, per token (lowercased): flips a PERSISTENT
// negator to -1 when the token is in ["not","no","never","neither"]
// (it never flips back — natural's behavior); otherwise looks the
// token up unstemmed first, then stemmed; and finally divides by the
// TOTAL token count, not the hit count. This code reproduces that
// exactly, so behavior is identical by construction; the tests in
// tests/review-sentiment.test.ts pin it.
const AFINN_NEGATIONS = ['not', 'no', 'never', 'neither'];

const afinnVocabulary: Record<string, number> = (() => {
  const stemmed: Record<string, number> = Object.create(null);
  for (const [word, score] of Object.entries(afinn165)) {
    stemmed[PorterStemmer.stem(word)] = score;
  }
  return stemmed;
})();

function afinnAverage(words: string[]): number {
  let score = 0;
  let negator = 1;
  for (const token of words) {
    const lowerCased = token.toLowerCase();
    if (AFINN_NEGATIONS.indexOf(lowerCased) > -1) {
      negator = -1;
    } else if (afinnVocabulary[lowerCased] !== undefined) {
      score += negator * afinnVocabulary[lowerCased];
    } else {
      const stemmedWord = PorterStemmer.stem(lowerCased);
      if (afinnVocabulary[stemmedWord] !== undefined) {
        score += negator * afinnVocabulary[stemmedWord];
      }
    }
  }
  return score / words.length;
}

/**
 * COMBINATION RULE — AFINN is a gap-filler, never an override.
 *
 * Final per-review score = lexiconScore + ratingPrior + afinnAdj, where
 * afinnAdj is -1, 0, or +1 from the AFINN average over the review's
 * WordTokenizer tokens (avg >= 0.5 -> +1, avg <= -0.5 -> -1, else 0) —
 * BUT afinnAdj is applied ONLY when the lexicon score for that aspect
 * is exactly 0. The curated lexicon — with negation handling and
 * per-aspect overrides — always wins when it has an opinion; AFINN
 * only fills vocabulary gaps the lexicon does not know ('outstanding',
 * 'mediocre', 'dreadful'). This is deliberate: AFINN is negation-blind
 * ('not good' still averages positive), so it must never override the
 * lexicon. AFINN is English-only; Roman Urdu words score 0 in AFINN,
 * so the adjustment is naturally silent on Roman Urdu text.
 *
 * Known limit: AFINN sees the whole review, not per-aspect text, so a
 * mixed-aspect review can dilute its average to 0 ('great battery,
 * mediocre display' averages out) and the gap stays unfilled.
 */
function afinnAdjustment(text: string): -1 | 0 | 1 {
  const words = wordTokenizer.tokenize(text.toLowerCase());
  if (words.length === 0) return 0;
  const avg = afinnAverage(words);
  if (!Number.isFinite(avg)) return 0;
  if (avg >= 0.5) return 1;
  if (avg <= -0.5) return -1;
  return 0;
}

function verdictFor(positive: number, negative: number): SentimentLabel {
  if (positive > negative) return 'positive';
  if (negative > positive) return 'negative';
  return 'mixed';
}

// ---------------------------------------------------------------------------
// Brief contrast summaries (aspect-contrast templates, EN + Roman Urdu)
// ---------------------------------------------------------------------------

function buildBriefSummaries(
  bestPositive: AspectVerdict | null,
  worstNegative: AspectVerdict | null
): { en: string | null; ur: string | null } {
  if (bestPositive && worstNegative) {
    return {
      en: `Its ${bestPositive.label.toLowerCase()} is excellent, but its ${worstNegative.label.toLowerCase()} could be better.`,
      ur: `Is product ki ${bestPositive.labelUr} bohat achi hai lekin ${worstNegative.labelUr} mazeed behtar ho sakti hai.`,
    };
  }
  if (bestPositive) {
    return {
      en: `Buyers love its ${bestPositive.label.toLowerCase()}.`,
      ur: `Khareedaron ko is product ki ${bestPositive.labelUr} bohat pasand hai.`,
    };
  }
  if (worstNegative) {
    return {
      en: `Buyers are disappointed with its ${worstNegative.label.toLowerCase()}.`,
      ur: `Khareedaron ko is product ki ${worstNegative.labelUr} se shikayat hai.`,
    };
  }
  return { en: null, ur: null };
}

// ---------------------------------------------------------------------------
// Main analysis
// ---------------------------------------------------------------------------

export function analyzeReviews(reviews: SentimentReviewInput[]): SentimentAnalysis | null {
  if (!reviews || reviews.length === 0) return null;

  const verified = reviews.filter((r) => r.verified_purchase);
  // Verified-priority rule: when verified reviews exist, the headline
  // analysis is computed from verified reviews only. Otherwise it uses
  // all reviews, and the caller labels that plainly.
  const basis: 'verified' | 'all' = verified.length > 0 ? 'verified' : 'all';
  const used = basis === 'verified' ? verified : reviews;

  const totalReviews = reviews.length;
  const verifiedCount = verified.length;
  const basisReviews = used.length;
  const averageRating =
    used.reduce((sum, r) => sum + r.rating, 0) / used.length;

  const aspectStats = new Map<AspectId, { positive: number; negative: number; mentions: number }>();
  const ensure = (id: AspectId) => {
    let entry = aspectStats.get(id);
    if (!entry) {
      entry = { positive: 0, negative: 0, mentions: 0 };
      aspectStats.set(id, entry);
    }
    return entry;
  };

  for (const review of used) {
    const text = `${review.title ?? ''} ${review.content ?? ''}`.toLowerCase();
    const tokens = tokenize(text);
    const aspects = detectAspects(text);
    const ratingPrior = review.rating >= 4 ? 1 : review.rating <= 2 ? -1 : 0;
    const afinnAdj = afinnAdjustment(text);
    for (const aspect of aspects) {
      const entry = ensure(aspect);
      entry.mentions++;
      const lexiconScore = scoreReviewForAspect(tokens, aspect);
      // AFINN gap-filler: applies only when the lexicon has no opinion
      // on this aspect (see afinnAdjustment).
      const score = lexiconScore + ratingPrior + (lexiconScore === 0 ? afinnAdj : 0);
      if (score > 0) entry.positive++;
      else if (score < 0) entry.negative++;
    }
  }

  const defById = new Map(ASPECTS.map((a) => [a.id, a]));
  defById.set('overall', { id: 'overall', label: 'Overall', labelUr: 'majmooi tor par', keywords: [] });

  // Specific aspects first, 'overall' bucket last, each by mention count.
  const aspects: AspectVerdict[] = [...aspectStats.entries()]
    .map(([aspect, stats]) => {
      const def = defById.get(aspect)!;
      return {
        aspect,
        label: def.label,
        labelUr: def.labelUr,
        sentiment: verdictFor(stats.positive, stats.negative),
        mentions: stats.mentions,
        positive: stats.positive,
        negative: stats.negative,
        strength: stats.positive - stats.negative,
      };
    })
    .sort((a, b) => {
      if (a.aspect === 'overall') return 1;
      if (b.aspect === 'overall') return -1;
      return b.mentions - a.mentions;
    });

  const specific = aspects.filter((a) => a.aspect !== 'overall');
  const pickPool = specific.length > 0 ? specific : aspects;
  const bestPositive =
    pickPool
      .filter((a) => a.sentiment === 'positive')
      .sort((a, b) => b.strength - a.strength || b.mentions - a.mentions)[0] ?? null;
  const worstNegative =
    pickPool
      .filter((a) => a.sentiment === 'negative')
      .sort((a, b) => a.strength - b.strength || b.mentions - a.mentions)[0] ?? null;

  const pros = aspects
    .filter((a) => a.sentiment === 'positive')
    .sort((a, b) => b.strength - a.strength || b.mentions - a.mentions)
    .slice(0, 3);
  const cons = aspects
    .filter((a) => a.sentiment === 'negative')
    .sort((a, b) => a.strength - b.strength || b.mentions - a.mentions)
    .slice(0, 3);

  // Overall: average rating first, aspect balance second. A product
  // with a high average but a dominant negative aspect is mixed,
  // not positive; a low average with no positive aspect is negative.
  const posAspects = aspects.filter((a) => a.sentiment === 'positive').length;
  const negAspects = aspects.filter((a) => a.sentiment === 'negative').length;
  let overall: SentimentLabel;
  if (averageRating >= 4 && negAspects <= posAspects) overall = 'positive';
  else if (averageRating <= 2.5 && posAspects === 0) overall = 'negative';
  else if (negAspects > posAspects) overall = 'negative';
  else if (averageRating >= 4) overall = 'mixed';
  else if (averageRating >= 3) overall = posAspects >= negAspects ? 'mixed' : 'negative';
  else overall = 'negative';

  const brief = buildBriefSummaries(bestPositive, worstNegative);

  return {
    overall,
    averageRating,
    basisReviews,
    totalReviews,
    verifiedCount,
    basis,
    lowConfidence: basisReviews <= 2,
    aspects,
    pros: pros.map((a) => a.label),
    prosUr: pros.map((a) => a.labelUr),
    cons: cons.map((a) => a.label),
    consUr: cons.map((a) => a.labelUr),
    briefSummaryEn: brief.en,
    briefSummaryUr: brief.ur,
  };
}
