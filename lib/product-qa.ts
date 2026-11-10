/**
 * Product Q&A (Section 3 #12).
 *
 * One question + optional admin answer per row, stored in the
 * `product_qa` table (migration 028). Questions are public once asked;
 * answers come from the SmartBuy team (admin) — never auto-generated,
 * never invented. With no questions the UI shows an honest empty
 * state ("No questions yet"), never a seeded Q&A.
 *
 * Fail-safe: every DB read catches errors (including "table does not
 * exist" when migration 028 has not been run yet) and returns an
 * empty list, so the product page never breaks on a missing table.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type QaStatus = 'pending' | 'answered' | 'hidden';

export interface ProductQuestion {
  id: string;
  productId: string;
  userId: string;
  question: string;
  answer: string | null;
  answeredBy: string | null;
  status: QaStatus;
  createdAt: string;
  updatedAt: string;
}

export const QA_QUESTION_MIN_LENGTH = 3;
export const QA_QUESTION_MAX_LENGTH = 1000;
export const QA_ANSWER_MAX_LENGTH = 5000;

// ---------------------------------------------------------------------------
// Pure validation / normalisation
// ---------------------------------------------------------------------------

/** Collapse whitespace and trim. Pure — no DB, no network. */
export function normalizeQuestion(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

/**
 * Validate a question before it is stored. Returns an error message
 * for the UI, or null when the question is acceptable.
 */
export function validateQuestion(raw: unknown): string | null {
  if (typeof raw !== 'string') return 'A question is required.';
  const question = normalizeQuestion(raw);
  if (question.length < QA_QUESTION_MIN_LENGTH) {
    return `Please ask a question of at least ${QA_QUESTION_MIN_LENGTH} characters.`;
  }
  if (question.length > QA_QUESTION_MAX_LENGTH) {
    return `Please keep your question under ${QA_QUESTION_MAX_LENGTH} characters.`;
  }
  return null;
}

/** Validate an admin answer before it is stored. */
export function validateAnswer(raw: unknown): string | null {
  if (typeof raw !== 'string') return 'An answer is required.';
  const answer = raw.trim();
  if (answer.length < 1) return 'An answer is required.';
  if (answer.length > QA_ANSWER_MAX_LENGTH) {
    return `Please keep the answer under ${QA_ANSWER_MAX_LENGTH} characters.`;
  }
  return null;
}

/** Human label for a question's status (shown in the UI). */
export function qaStatusLabel(status: QaStatus): string {
  switch (status) {
    case 'answered':
      return 'Answered';
    case 'hidden':
      return 'Hidden';
    case 'pending':
    default:
      return 'Awaiting an answer';
  }
}

// ---------------------------------------------------------------------------
// Row → domain mapper
// ---------------------------------------------------------------------------

interface ProductQaRow {
  id: string;
  product_id: string;
  user_id: string;
  question: string;
  answer: string | null;
  answered_by: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

function mapQuestion(row: ProductQaRow): ProductQuestion {
  const status: QaStatus =
    row.status === 'answered' || row.status === 'hidden' ? row.status : 'pending';
  return {
    id: row.id,
    productId: row.product_id,
    userId: row.user_id,
    question: row.question,
    answer: row.answer,
    answeredBy: row.answered_by,
    status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Fail-safe reads / writes
// ---------------------------------------------------------------------------

const QA_COLUMNS =
  'id, product_id, user_id, question, answer, answered_by, status, created_at, updated_at';

/**
 * Public Q&A for a product (pending + answered, never hidden).
 * Returns [] when the table is missing or the query fails.
 */
export async function getProductQuestions(
  supabase: AnySupabaseClient,
  productId: string
): Promise<ProductQuestion[]> {
  try {
    const { data, error } = await supabase
      .from('product_qa')
      .select(QA_COLUMNS)
      .eq('product_id', productId)
      .neq('status', 'hidden')
      .order('created_at', { ascending: false });

    if (error || !data) {
      if (error) logger.warn('getProductQuestions: query failed', { error: error.message });
      return [];
    }
    return (data as ProductQaRow[]).map(mapQuestion);
  } catch (err) {
    logger.error('getProductQuestions: unexpected error', { error: String(err) });
    return [];
  }
}

/**
 * Insert a question. Returns the created row, or null when the insert
 * fails (including a duplicate exact question from the same user —
 * the migration's UNIQUE constraint — which the API reports as a
 * conflict, not a crash).
 */
export async function askQuestion(
  supabase: AnySupabaseClient,
  userId: string,
  productId: string,
  question: string
): Promise<{ question: ProductQuestion | null; duplicate: boolean }> {
  try {
    const { data, error } = await supabase
      .from('product_qa')
      .insert({ product_id: productId, user_id: userId, question })
      .select(QA_COLUMNS)
      .single();

    if (error || !data) {
      if (error) {
        logger.warn('askQuestion: insert failed', { error: error.message });
        // Postgres unique-violation (23505): same user, same product,
        // same exact question text — a duplicate ask, not a new row.
        if ((error as { code?: string }).code === '23505') {
          return { question: null, duplicate: true };
        }
      }
      return { question: null, duplicate: false };
    }
    return { question: mapQuestion(data as ProductQaRow), duplicate: false };
  } catch (err) {
    logger.error('askQuestion: unexpected error', { error: String(err) });
    return { question: null, duplicate: false };
  }
}

/**
 * Admin answer (or hide) for a question. Returns the updated row, or
 * null when the update fails.
 */
export async function answerQuestion(
  supabase: AnySupabaseClient,
  questionId: string,
  adminUserId: string,
  input: { answer?: string; status?: 'answered' | 'hidden' }
): Promise<ProductQuestion | null> {
  try {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof input.answer === 'string') {
      patch.answer = input.answer;
      patch.answered_by = adminUserId;
    }
    if (input.status) patch.status = input.status;

    const { data, error } = await supabase
      .from('product_qa')
      .update(patch)
      .eq('id', questionId)
      .select(QA_COLUMNS)
      .single();

    if (error || !data) {
      if (error) logger.warn('answerQuestion: update failed', { error: error.message });
      return null;
    }
    return mapQuestion(data as ProductQaRow);
  } catch (err) {
    logger.error('answerQuestion: unexpected error', { error: String(err) });
    return null;
  }
}
