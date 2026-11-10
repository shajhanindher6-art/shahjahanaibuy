/**
 * Tests for the AI Product Q&A Assistant (Section 7 item 5).
 * Pure functions — no DB, no network, no LLM.
 */
import { describe, it, expect } from 'vitest';
import {
  answerAiQuestion,
  classifyQuestion,
  topicsFromSpecs,
  normalizeQaText,
  AI_QA_UNKNOWN_MESSAGE,
  AI_QA_NO_MATCH_MESSAGE,
} from '@/lib/ai-product-qa';

const SPECS = [
  { key: 'battery_capacity', value: '5000', unit: 'mAh' },
  { key: 'display_size', value: '6.1', unit: 'inch' },
  { key: 'processor', value: 'Snapdragon 8 Gen 2', unit: null },
  { key: 'ram', value: '8', unit: 'GB' },
];

const REVIEWS = [
  { rating: 5, title: 'Great battery', content: 'Battery lasts all day, easily.', verifiedPurchase: true },
  { rating: 2, title: 'Weak camera', content: 'Camera is poor in low light.', verifiedPurchase: false },
];

describe('normalizeQaText', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normalizeQaText('  Battery   LIFE? ')).toBe('battery life');
  });
});

describe('classifyQuestion', () => {
  it('matches the battery topic from English keywords', () => {
    expect(classifyQuestion('How is the battery life?')).toContain('battery');
  });

  it('matches the camera topic', () => {
    expect(classifyQuestion('Is the camera good at night?')).toContain('camera');
  });

  it('matches performance from a use-case phrase', () => {
    expect(classifyQuestion('Is this laptop good for video editing?')).toContain('performance');
  });

  it('returns empty when no topic is recognised', () => {
    expect(classifyQuestion('What is the meaning of life?')).toEqual([]);
  });
});

describe('topicsFromSpecs', () => {
  it('lists topics covered by recorded specs', () => {
    const topics = topicsFromSpecs(SPECS);
    expect(topics).toContain('battery');
    expect(topics).toContain('display');
    expect(topics).toContain('performance');
    expect(topics).not.toContain('camera');
  });
});

describe('answerAiQuestion', () => {
  it('says pata nahi when there are no specs and no reviews', () => {
    const answer = answerAiQuestion('How is the battery?', [], []);
    expect(answer.status).toBe('unknown');
    expect(answer.answer).toBe(AI_QA_UNKNOWN_MESSAGE);
    expect(answer.source).toBeNull();
    expect(answer.label).toBe('AI answer');
  });

  it('answers from specs with source "specs se"', () => {
    const answer = answerAiQuestion('What is the battery capacity?', SPECS, []);
    expect(answer.status).toBe('answered');
    expect(answer.source).toBe('specs');
    expect(answer.sourceLabel).toBe('specs se');
    expect(answer.answer).toContain('5000');
    expect(answer.answer).toContain('mAh');
    expect(answer.matchedSpecs.length).toBeGreaterThan(0);
  });

  it('answers from reviews with source "reviews se" and sentiment', () => {
    const answer = answerAiQuestion('How is the camera?', [], REVIEWS);
    expect(answer.status).toBe('answered');
    expect(answer.source).toBe('reviews');
    expect(answer.sourceLabel).toBe('reviews se');
    expect(answer.reviewCount).toBe(1);
    expect(answer.sentiment).toBe('negative');
  });

  it('combines specs + reviews when both match', () => {
    const answer = answerAiQuestion('How is the battery?', SPECS, REVIEWS);
    expect(answer.status).toBe('answered');
    expect(answer.source).toBe('specs+reviews');
    expect(answer.sourceLabel).toBe('specs + reviews se');
    expect(answer.sentiment).toBe('positive');
  });

  it('says pata nahi when the topic has no recorded match', () => {
    const answer = answerAiQuestion('How is the camera?', SPECS, []);
    expect(answer.status).toBe('unknown');
    expect(answer.answer).toBe(AI_QA_NO_MATCH_MESSAGE);
    expect(answer.source).toBeNull();
  });

  it('never presents the answer as an admin answer', () => {
    const answer = answerAiQuestion('What is the battery capacity?', SPECS, REVIEWS);
    expect(answer.label).toBe('AI answer');
    expect(answer.answer.toLowerCase()).not.toContain('admin');
  });
});
