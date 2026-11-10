import { describe, expect, it } from 'vitest';
import {
  normalizeQuestion,
  validateQuestion,
  validateAnswer,
  qaStatusLabel,
  QA_QUESTION_MIN_LENGTH,
  QA_QUESTION_MAX_LENGTH,
} from '@/lib/product-qa';

describe('normalizeQuestion', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeQuestion('  Does  it\n ship\tto PK?  ')).toBe('Does it ship to PK?');
  });

  it('leaves a clean question unchanged', () => {
    expect(normalizeQuestion('Is there a warranty?')).toBe('Is there a warranty?');
  });
});

describe('validateQuestion', () => {
  it('accepts a normal question', () => {
    expect(validateQuestion('Does this laptop come with an international warranty?')).toBeNull();
  });

  it('rejects non-strings, empty, and too-short questions', () => {
    expect(validateQuestion(undefined)).not.toBeNull();
    expect(validateQuestion(42)).not.toBeNull();
    expect(validateQuestion('')).not.toBeNull();
    expect(validateQuestion('  ')).not.toBeNull();
    expect(validateQuestion('ab')).not.toBeNull();
    expect(validateQuestion('a'.repeat(QA_QUESTION_MIN_LENGTH - 1))).not.toBeNull();
  });

  it('accepts a question exactly at the minimum length', () => {
    expect(validateQuestion('a'.repeat(QA_QUESTION_MIN_LENGTH))).toBeNull();
  });

  it('rejects questions over the maximum length', () => {
    expect(validateQuestion('a'.repeat(QA_QUESTION_MAX_LENGTH + 1))).not.toBeNull();
  });

  it('counts the normalised (trimmed) length, not raw whitespace', () => {
    expect(validateQuestion(`  ${'a'.repeat(QA_QUESTION_MIN_LENGTH)}   `)).toBeNull();
  });
});

describe('validateAnswer', () => {
  it('accepts a normal admin answer', () => {
    expect(validateAnswer('Yes — one year, international.')).toBeNull();
  });

  it('rejects empty and non-string answers', () => {
    expect(validateAnswer('')).not.toBeNull();
    expect(validateAnswer('   ')).not.toBeNull();
    expect(validateAnswer(null)).not.toBeNull();
  });

  it('rejects answers over 5000 characters', () => {
    expect(validateAnswer('a'.repeat(5001))).not.toBeNull();
    expect(validateAnswer('a'.repeat(5000))).toBeNull();
  });
});

describe('qaStatusLabel', () => {
  it('labels every status in plain language', () => {
    expect(qaStatusLabel('pending')).toBe('Awaiting an answer');
    expect(qaStatusLabel('answered')).toBe('Answered');
    expect(qaStatusLabel('hidden')).toBe('Hidden');
  });
});
