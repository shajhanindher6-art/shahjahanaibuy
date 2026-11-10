/**
 * AI Product Q&A Assistant (Section 7 item 5).
 *
 * Deterministic keyword matching ONLY — no LLM, no LLM key, no
 * external call. Answers come from the product's RECORDED specs
 * (`product_attributes`) and RECORDED reviews (`reviews` table),
 * with sentiment from the deterministic engine in
 * services/review-sentiment.ts (verified-priority headline).
 *
 * This is a SEPARATE layer from the human Q&A API
 * (app/api/v1/products/[slug]/qa/route.ts): human answers come from
 * admin and are never auto-generated. Every answer here is labeled
 * "AI answer" with its source ("specs se" / "reviews se" /
 * "specs + reviews se") and must NEVER be presented as an admin
 * answer. Nothing is stored: questions are answered in-memory and
 * never written to the product_qa table.
 *
 * HONESTY RULES:
 * - No specs and no reviews for the product → "pata nahi — is
 *   product ki specs/reviews record nahi hain". Never guess.
 * - A topic with no matching recorded spec/review → honest
 *   "recorded specs/reviews mein nahi mila", never invented.
 * - No exact claims beyond what the recorded data says.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import { getProductAttributes } from '@/services/products';
import { getReviews } from '@/services/reviews';
import { analyzeReviews } from '@/services/review-sentiment';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AiQaSource = 'specs' | 'reviews' | 'specs+reviews';

export interface AiQaSpecInput {
  key: string;
  value: string;
  unit: string | null;
}

export interface AiQaReviewInput {
  rating: number;
  title: string | null;
  content: string | null;
  verifiedPurchase: boolean;
}

export interface AiQaMatchedSpec {
  key: string;
  value: string;
  unit: string | null;
}

export interface AiQaAnswer {
  /** 'answered' when recorded data supported an answer, else 'unknown'. */
  status: 'answered' | 'unknown';
  /** The answer text (Roman Urdu + English spec values as recorded). */
  answer: string;
  /** Where the answer came from — null when nothing was found. */
  source: AiQaSource | null;
  /** Display label: 'specs se' / 'reviews se' / 'specs + reviews se'. */
  sourceLabel: string | null;
  /** Fixed UI label — every AI answer carries this, never "admin answer". */
  label: 'AI answer';
  /** Topic ids the question matched (empty when none recognised). */
  matchedTopics: string[];
  /** Recorded specs quoted in the answer. */
  matchedSpecs: AiQaMatchedSpec[];
  /** Reviews whose text matched the question's topic(s). */
  reviewCount: number;
  /** Overall sentiment of the matching reviews, when any matched. */
  sentiment: 'positive' | 'mixed' | 'negative' | null;
  /** Topics the user can ask about, from the recorded specs. */
  availableTopics: string[];
}

/** Honest answer when the product has no recorded specs or reviews. */
export const AI_QA_UNKNOWN_MESSAGE =
  'Pata nahi — is product ki specs/reviews record nahi hain.';

export const AI_QA_NO_MATCH_MESSAGE =
  'Pata nahi — is sawaal ka jawab is product ki recorded specs/reviews mein nahi mila.';

// ---------------------------------------------------------------------------
// Topics: keyword → spec keys + review words (English + Roman Urdu)
// ---------------------------------------------------------------------------

export interface AiQaTopic {
  id: string;
  label: string;
  /** Spec attribute keys (lowercase substrings) that answer this topic. */
  specKeys: string[];
  /** Words/phrases in the question that signal this topic. */
  keywords: string[];
}

export const AI_QA_TOPICS: readonly AiQaTopic[] = [
  {
    id: 'battery',
    label: 'Battery',
    specKeys: ['battery', 'battary'],
    keywords: ['battery', 'battary', 'charge', 'charging', 'backup', 'mah', 'kitni der chalti', 'kitni der chalta'],
  },
  {
    id: 'display',
    label: 'Display',
    specKeys: ['display', 'screen', 'resolution', 'refresh'],
    keywords: ['display', 'screen', 'resolution', 'refresh rate', 'hz', 'oled', 'amoled', 'inch', 'size', 'bara screen'],
  },
  {
    id: 'camera',
    label: 'Camera',
    specKeys: ['camera', 'megapixel', 'mp'],
    keywords: ['camera', 'camra', 'photo', 'picture', 'megapixel', 'selfie', 'video recording'],
  },
  {
    id: 'performance',
    label: 'Performance',
    specKeys: ['processor', 'cpu', 'chip', 'gpu', 'performance'],
    keywords: ['processor', 'cpu', 'chip', 'performance', 'fast', 'tez', 'gaming', 'video editing', 'editing', 'lag', 'slow', 'hang'],
  },
  {
    id: 'memory',
    label: 'Memory / RAM',
    specKeys: ['ram', 'memory'],
    keywords: ['ram', 'memory', 'gb ram'],
  },
  {
    id: 'storage',
    label: 'Storage',
    specKeys: ['storage', 'ssd', 'rom', 'hard drive'],
    keywords: ['storage', 'ssd', 'rom', 'space', 'kitni storage', 'hard drive'],
  },
  {
    id: 'weight',
    label: 'Weight',
    specKeys: ['weight', 'weigh'],
    keywords: ['weight', 'wazan', 'heavy', 'bhari', 'light', 'halka', 'kitna wazan'],
  },
  {
    id: 'price',
    label: 'Price / value',
    specKeys: ['price'],
    keywords: ['price', 'qeemat', 'keemat', 'mehnga', 'sasta', 'cheap', 'expensive', 'worth', 'value', 'kitne ka'],
  },
  {
    id: 'build',
    label: 'Build / design',
    specKeys: ['build', 'material', 'design', 'dimension', 'color', 'colour'],
    keywords: ['build', 'design', 'look', 'color', 'colour', 'rang', 'strong', 'mazboot', 'premium'],
  },
  {
    id: 'sound',
    label: 'Sound',
    specKeys: ['speaker', 'sound', 'audio'],
    keywords: ['speaker', 'sound', 'audio', 'awaz', 'bass'],
  },
  {
    id: 'connectivity',
    label: 'Connectivity',
    specKeys: ['wifi', 'bluetooth', 'usb', 'port', 'connectivity', '5g', 'sim'],
    keywords: ['wifi', 'bluetooth', 'usb', 'port', '5g', 'sim', 'connectivity'],
  },
  {
    id: 'warranty',
    label: 'Warranty',
    specKeys: ['warranty'],
    keywords: ['warranty', 'guarantee', 'waranti'],
  },
];

/** Normalise text for keyword matching (lowercase, collapse spaces). */
export function normalizeQaText(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Topic ids whose keywords appear in the question. Pure. */
export function classifyQuestion(question: string): string[] {
  const text = ` ${normalizeQaText(question)} `;
  const matched: string[] = [];
  for (const topic of AI_QA_TOPICS) {
    if (topic.keywords.some((kw) => text.includes(` ${normalizeQaText(kw)} `) || text.includes(normalizeQaText(kw)))) {
      matched.push(topic.id);
    }
  }
  return matched;
}

/** Topic ids covered by the recorded specs (for "you can ask about" hints). */
export function topicsFromSpecs(specs: AiQaSpecInput[]): string[] {
  const covered: string[] = [];
  for (const topic of AI_QA_TOPICS) {
    if (
      specs.some((s) =>
        topic.specKeys.some((k) => normalizeQaText(s.key).includes(k))
      )
    ) {
      covered.push(topic.id);
    }
  }
  return covered;
}

// ---------------------------------------------------------------------------
// Answering — deterministic, recorded data only
// ---------------------------------------------------------------------------

function formatSpec(spec: AiQaMatchedSpec): string {
  return `${spec.key}: ${spec.value}${spec.unit ? ` ${spec.unit}` : ''}`;
}

function sentimentLabel(
  sentiment: 'positive' | 'mixed' | 'negative'
): string {
  switch (sentiment) {
    case 'positive':
      return 'positive';
    case 'negative':
      return 'negative';
    case 'mixed':
    default:
      return 'mixed';
  }
}

/**
 * Answer a question from recorded specs + reviews. Pure — no DB, no
 * network. Never invents: every sentence is tied to a recorded spec
 * or a counted set of matching reviews.
 */
export function answerAiQuestion(
  question: string,
  specs: AiQaSpecInput[],
  reviews: AiQaReviewInput[]
): AiQaAnswer {
  const matchedTopics = classifyQuestion(question);
  const availableTopics = topicsFromSpecs(specs);
  const base: Omit<AiQaAnswer, 'status' | 'answer' | 'source' | 'sourceLabel'> = {
    label: 'AI answer',
    matchedTopics,
    matchedSpecs: [],
    reviewCount: 0,
    sentiment: null,
    availableTopics,
  };

  // Nothing recorded at all → the honest "pata nahi".
  if (specs.length === 0 && reviews.length === 0) {
    return { ...base, status: 'unknown', answer: AI_QA_UNKNOWN_MESSAGE, source: null, sourceLabel: null };
  }

  const topics = matchedTopics.length > 0
    ? AI_QA_TOPICS.filter((t) => matchedTopics.includes(t.id))
    : [];

  // --- Specs: attribute key matches a recognised topic. ---
  const matchedSpecs: AiQaMatchedSpec[] = [];
  if (topics.length > 0) {
    for (const spec of specs) {
      const keyNorm = normalizeQaText(spec.key);
      if (
        topics.some((t) => t.specKeys.some((k) => keyNorm.includes(k))) &&
        !matchedSpecs.some((m) => m.key === spec.key && m.value === spec.value)
      ) {
        matchedSpecs.push({ key: spec.key, value: spec.value, unit: spec.unit });
      }
    }
  }

  // --- Reviews: review text mentions a recognised topic keyword. ---
  const matchingReviews: AiQaReviewInput[] = [];
  if (topics.length > 0 && reviews.length > 0) {
    for (const review of reviews) {
      const text = normalizeQaText(`${review.title ?? ''} ${review.content ?? ''}`);
      if (topics.some((t) => t.keywords.some((kw) => text.includes(normalizeQaText(kw))))) {
        matchingReviews.push(review);
      }
    }
  }

  // Price questions have no recorded price in specs/reviews: answer
  // from review sentiment on value when reviews mention it, else unknown.
  if (matchedSpecs.length === 0 && matchingReviews.length === 0) {
    // No topic recognised: if specs exist, point at what CAN be asked.
    if (matchedTopics.length === 0 && specs.length > 0) {
      const hint =
        availableTopics.length > 0
          ? ` Aap in topics ke baare mein pooch sakte hain: ${availableTopics
              .map((id) => AI_QA_TOPICS.find((t) => t.id === id)?.label ?? id)
              .join(', ')}.`
          : '';
      return {
        ...base,
        status: 'unknown',
        answer: `Pata nahi — is sawaal ka jawab recorded specs/reviews se nahi mil saka.${hint}`,
        source: null,
        sourceLabel: null,
      };
    }
    return { ...base, status: 'unknown', answer: AI_QA_NO_MATCH_MESSAGE, source: null, sourceLabel: null };
  }

  const parts: string[] = [];
  let source: AiQaSource | null = null;

  if (matchedSpecs.length > 0) {
    parts.push(
      `Specs ke mutabiq — ${matchedSpecs.map(formatSpec).join('; ')}.`
    );
    source = 'specs';
  }

  let sentiment: AiQaAnswer['sentiment'] = null;
  if (matchingReviews.length > 0) {
    const analysis = analyzeReviews(
      matchingReviews.map((r) => ({
        rating: r.rating,
        title: r.title,
        content: r.content,
        verified_purchase: r.verifiedPurchase,
      }))
    );
    sentiment = analysis ? analysis.overall : null;
    const verifiedCount = matchingReviews.filter((r) => r.verifiedPurchase).length;
    const verifiedNote =
      verifiedCount > 0 ? ` (jin mein ${verifiedCount} verified purchase hain)` : '';
    parts.push(
      `Reviews se — ${matchingReviews.length} review${
        matchingReviews.length === 1 ? '' : 's'
      } mein is topic ka zikr hai${verifiedNote}${
        sentiment ? `, aur un ka overall sentiment ${sentimentLabel(sentiment)} hai` : ''
      }.`
    );
    source = source === 'specs' ? 'specs+reviews' : 'reviews';
  }

  const sourceLabel =
    source === 'specs'
      ? 'specs se'
      : source === 'reviews'
        ? 'reviews se'
        : source === 'specs+reviews'
          ? 'specs + reviews se'
          : null;

  return {
    ...base,
    status: 'answered',
    answer: parts.join(' '),
    source,
    sourceLabel,
    matchedSpecs,
    reviewCount: matchingReviews.length,
    sentiment,
  };
}

// ---------------------------------------------------------------------------
// Fail-safe DB read: recorded specs + reviews for one product
// ---------------------------------------------------------------------------

export interface AiQaContext {
  specs: AiQaSpecInput[];
  reviews: AiQaReviewInput[];
}

/**
 * Load the recorded context for AI Q&A. Both underlying reads are
 * already fail-safe (empty on a missing table/column), so this never
 * throws for DB reasons — it returns what exists, honestly empty
 * when nothing is recorded.
 */
export async function fetchAiQaContext(
  supabase: AnySupabaseClient,
  productId: string
): Promise<AiQaContext> {
  try {
    const [attributes, reviewResult] = await Promise.all([
      getProductAttributes(supabase, productId),
      getReviews(supabase, productId, { page: 1, pageSize: 100 }),
    ]);
    return {
      specs: attributes.map((a) => ({ key: a.key, value: a.value, unit: a.unit })),
      reviews: reviewResult.reviews.map((r) => ({
        rating: r.rating,
        title: r.title,
        content: r.content,
        verifiedPurchase: r.verifiedPurchase,
      })),
    };
  } catch (err) {
    logger.warn('fetchAiQaContext: failed', { error: String(err) });
    return { specs: [], reviews: [] };
  }
}
