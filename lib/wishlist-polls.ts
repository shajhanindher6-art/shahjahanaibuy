/**
 * Wishlist polls (Section 6, Item 13 — Social shopping, trimmed).
 *
 * Polls live on shared wishlists. Every option must resolve to a
 * real catalog product (checked in the API route against the
 * products table — this module never invents an option). One vote
 * per user per poll (UNIQUE (poll_id, user_id), migration 033);
 * voting again changes the vote, mirroring the community-deal vote
 * route. Votes never verify anything and never earn points.
 *
 * Fail-safe reads: when migration 033 has not been run yet, the
 * poll tables do not exist and the readers below return an empty
 * list with pollsEnabled:false — never a crash, never fake polls.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PollOptionResult {
  optionId: string;
  productId: string;
  productName: string | null;
  productSlug: string | null;
  votes: number;
  /** Share of all votes on this poll, 0–1 (0 when nobody voted). */
  share: number;
}

export interface WishlistPoll {
  id: string;
  wishlistId: string;
  question: string;
  status: 'open' | 'closed';
  createdBy: string;
  createdAt: string;
  options: PollOptionResult[];
  totalVotes: number;
  /** The option id the requesting user voted for, or null. */
  userVotedOptionId: string | null;
}

export interface PollsForWishlist {
  polls: WishlistPoll[];
  /** False when the 033 poll tables do not exist yet. */
  pollsEnabled: boolean;
}

// ---------------------------------------------------------------------------
// Pure validation helpers
// ---------------------------------------------------------------------------

export const POLL_QUESTION_MIN = 3;
export const POLL_QUESTION_MAX = 500;
export const POLL_MIN_OPTIONS = 2;

/** Returns an error message for an invalid question, or null when valid. */
export function validatePollQuestion(question: unknown): string | null {
  if (typeof question !== 'string' || !question.trim()) {
    return 'A question is required.';
  }
  const trimmed = question.trim();
  if (trimmed.length < POLL_QUESTION_MIN) {
    return `Question must be at least ${POLL_QUESTION_MIN} characters.`;
  }
  if (trimmed.length > POLL_QUESTION_MAX) {
    return `Question must be at most ${POLL_QUESTION_MAX} characters.`;
  }
  return null;
}

/**
 * Normalizes a raw product-id list into deduped, non-empty ids, or
 * returns an error message. A poll needs at least two distinct
 * options to be a choice at all. Whether the ids resolve to real
 * catalog products is checked by the API route, not here.
 */
export function validatePollOptions(
  productIds: unknown
): { productIds: string[] } | { error: string } {
  if (!Array.isArray(productIds)) {
    return { error: 'At least two product options are required.' };
  }
  const deduped = [...new Set(productIds.filter((id): id is string => typeof id === 'string' && id.trim() !== '').map((id) => id.trim()))];
  if (deduped.length < POLL_MIN_OPTIONS) {
    return { error: `At least ${POLL_MIN_OPTIONS} different product options are required.` };
  }
  return { productIds: deduped };
}

// ---------------------------------------------------------------------------
// Pure vote math
// ---------------------------------------------------------------------------

export interface PollVoteInput {
  pollId: string;
  optionId: string;
  userId: string;
}

/**
 * Tally votes per option. Shares are 0 when nobody has voted yet —
 * the UI renders "No votes yet" instead of a percentage.
 */
export function tallyPollResults(
  options: Array<{ optionId: string; productId: string; productName: string | null; productSlug: string | null }>,
  votes: Array<{ optionId: string }>
): PollOptionResult[] {
  const counts = new Map<string, number>();
  for (const v of votes) {
    counts.set(v.optionId, (counts.get(v.optionId) ?? 0) + 1);
  }
  const total = votes.length;
  return options.map((o) => {
    const count = counts.get(o.optionId) ?? 0;
    return {
      optionId: o.optionId,
      productId: o.productId,
      productName: o.productName,
      productSlug: o.productSlug,
      votes: count,
      share: total > 0 ? count / total : 0,
    };
  });
}

/** True when the user already voted in this poll (any option). */
export function hasUserVoted(
  votes: Array<{ userId: string }>,
  userId: string
): boolean {
  return votes.some((v) => v.userId === userId);
}

/**
 * Apply one vote to an in-memory vote list, enforcing one vote per
 * user per poll: a new vote is added, a repeat vote moves to the new
 * option. Returns the new list and whether the stored vote changed.
 * (The database enforces the same rule with UNIQUE (poll_id, user_id).)
 */
export function applyVote(
  existingVotes: PollVoteInput[],
  vote: PollVoteInput
): { votes: PollVoteInput[]; changed: boolean } {
  const idx = existingVotes.findIndex(
    (v) => v.pollId === vote.pollId && v.userId === vote.userId
  );
  if (idx === -1) {
    return { votes: [...existingVotes, vote], changed: true };
  }
  if (existingVotes[idx].optionId === vote.optionId) {
    return { votes: existingVotes, changed: false };
  }
  const next = [...existingVotes];
  next[idx] = vote;
  return { votes: next, changed: true };
}

// ---------------------------------------------------------------------------
// Fail-safe reads (real vote counts only)
// ---------------------------------------------------------------------------

function isMissingTable(error: { code?: string } | null | undefined): boolean {
  return error?.code === '42P01' || error?.code === 'PGRST205';
}

interface PollRow {
  id: string;
  wishlist_id: string;
  question: string;
  status: string;
  created_by: string;
  created_at: string;
}

interface PollOptionRow {
  id: string;
  poll_id: string;
  product_id: string;
  label: string | null;
}

/**
 * All polls on a wishlist with real vote counts. `userId` is
 * optional: when given, each poll reports which option that user
 * voted for (for the "You voted for…" state); otherwise null.
 */
export async function getPollsForWishlist(
  supabase: AnySupabaseClient,
  wishlistId: string,
  userId?: string | null
): Promise<PollsForWishlist> {
  try {
    const { data: polls, error } = await supabase
      .from('wishlist_polls')
      .select('id, wishlist_id, question, status, created_by, created_at')
      .eq('wishlist_id', wishlistId)
      .order('created_at', { ascending: false });
    if (error) {
      if (isMissingTable(error)) return { polls: [], pollsEnabled: false };
      logger.warn('getPollsForWishlist: query failed', { error: error.message });
      return { polls: [], pollsEnabled: true };
    }
    const rows = (polls ?? []) as PollRow[];
    if (rows.length === 0) return { polls: [], pollsEnabled: true };

    const pollIds = rows.map((p) => p.id);
    const { data: options } = await supabase
      .from('wishlist_poll_options')
      .select('id, poll_id, product_id, label')
      .in('poll_id', pollIds);
    const optionRows = (options ?? []) as PollOptionRow[];

    const { data: votes } = await supabase
      .from('wishlist_poll_votes')
      .select('poll_id, option_id, user_id')
      .in('poll_id', pollIds);
    const voteRows = (votes ?? []) as Array<{ poll_id: string; option_id: string; user_id: string }>;

    const productIds = [...new Set(optionRows.map((o) => o.product_id))];
    const productById = new Map<string, { name: string; slug: string }>();
    if (productIds.length > 0) {
      const { data: products } = await supabase
        .from('products')
        .select('id, name, slug')
        .in('id', productIds)
        .is('deleted_at', null);
      for (const p of (products ?? []) as Array<{ id: string; name: string; slug: string }>) {
        productById.set(p.id, { name: p.name, slug: p.slug });
      }
    }

    const optionsByPoll = new Map<string, PollOptionRow[]>();
    for (const o of optionRows) {
      const list = optionsByPoll.get(o.poll_id) ?? [];
      list.push(o);
      optionsByPoll.set(o.poll_id, list);
    }
    const votesByPoll = new Map<string, Array<{ option_id: string; user_id: string }>>();
    for (const v of voteRows) {
      const list = votesByPoll.get(v.poll_id) ?? [];
      list.push(v);
      votesByPoll.set(v.poll_id, list);
    }

    const result: WishlistPoll[] = rows.map((p) => {
      const pollOptions = (optionsByPoll.get(p.id) ?? []).map((o) => {
        const product = productById.get(o.product_id);
        return {
          optionId: o.id,
          productId: o.product_id,
          // label is a free-text fallback the creator could set; the
          // catalog name is the source of truth when it resolves.
          productName: product?.name ?? o.label ?? null,
          productSlug: product?.slug ?? null,
        };
      });
      const pollVotes = votesByPoll.get(p.id) ?? [];
      const tallied = tallyPollResults(pollOptions, pollVotes.map((v) => ({ optionId: v.option_id })));
      const userVote = userId
        ? pollVotes.find((v) => v.user_id === userId)?.option_id ?? null
        : null;
      return {
        id: p.id,
        wishlistId: p.wishlist_id,
        question: p.question,
        status: p.status === 'closed' ? 'closed' : 'open',
        createdBy: p.created_by,
        createdAt: p.created_at,
        options: tallied,
        totalVotes: pollVotes.length,
        userVotedOptionId: userVote,
      };
    });
    return { polls: result, pollsEnabled: true };
  } catch (err) {
    logger.error('getPollsForWishlist: unexpected error', { error: String(err) });
    return { polls: [], pollsEnabled: true };
  }
}

/**
 * Poll counts per wishlist, in ONE query — the batched form the
 * wishlists list API (GET /api/v1/wishlists) enriches its rows
 * with, so the list page can show a poll-count badge and an
 * "Ask friends to vote" link without a fetch per list. Fail-safe:
 * a missing 033 table (or any query failure) returns an empty map,
 * so every list simply shows no polls — never a crash, never a
 * guessed count. The wishlist_polls select policy is public
 * (migration 033), so this works for any signed-in reader.
 */
export async function getPollCountsByWishlist(
  supabase: AnySupabaseClient,
  wishlistIds: string[]
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (wishlistIds.length === 0) return counts;
  try {
    const { data, error } = await supabase
      .from('wishlist_polls')
      .select('wishlist_id')
      .in('wishlist_id', wishlistIds);
    if (error) {
      if (!isMissingTable(error)) {
        logger.warn('getPollCountsByWishlist: query failed', { error: error.message });
      }
      return counts;
    }
    for (const row of (data ?? []) as Array<{ wishlist_id: string }>) {
      counts.set(row.wishlist_id, (counts.get(row.wishlist_id) ?? 0) + 1);
    }
    return counts;
  } catch (err) {
    logger.error('getPollCountsByWishlist: unexpected error', { error: String(err) });
    return counts;
  }
}

/**
 * One poll with real vote counts, or null when the poll does not
 * exist / the tables are missing. Returns pollsEnabled:false when
 * the 033 tables do not exist yet.
 */
export async function getPollResults(
  supabase: AnySupabaseClient,
  pollId: string,
  userId?: string | null
): Promise<{ poll: WishlistPoll | null; pollsEnabled: boolean }> {
  try {
    const { data: poll, error } = await supabase
      .from('wishlist_polls')
      .select('id, wishlist_id, question, status, created_by, created_at')
      .eq('id', pollId)
      .maybeSingle();
    if (error) {
      if (isMissingTable(error)) return { poll: null, pollsEnabled: false };
      logger.warn('getPollResults: query failed', { error: error.message });
      return { poll: null, pollsEnabled: true };
    }
    if (!poll) return { poll: null, pollsEnabled: true };
    const p = poll as PollRow;

    const { data: options } = await supabase
      .from('wishlist_poll_options')
      .select('id, poll_id, product_id, label')
      .eq('poll_id', pollId);
    const optionRows = (options ?? []) as PollOptionRow[];

    const { data: votes } = await supabase
      .from('wishlist_poll_votes')
      .select('poll_id, option_id, user_id')
      .eq('poll_id', pollId);
    const voteRows = (votes ?? []) as Array<{ poll_id: string; option_id: string; user_id: string }>;

    const productIds = [...new Set(optionRows.map((o) => o.product_id))];
    const productById = new Map<string, { name: string; slug: string }>();
    if (productIds.length > 0) {
      const { data: products } = await supabase
        .from('products')
        .select('id, name, slug')
        .in('id', productIds)
        .is('deleted_at', null);
      for (const prod of (products ?? []) as Array<{ id: string; name: string; slug: string }>) {
        productById.set(prod.id, { name: prod.name, slug: prod.slug });
      }
    }

    const pollOptions = optionRows.map((o) => {
      const product = productById.get(o.product_id);
      return {
        optionId: o.id,
        productId: o.product_id,
        productName: product?.name ?? o.label ?? null,
        productSlug: product?.slug ?? null,
      };
    });
    const tallied = tallyPollResults(pollOptions, voteRows.map((v) => ({ optionId: v.option_id })));
    const userVote = userId
      ? voteRows.find((v) => v.user_id === userId)?.option_id ?? null
      : null;
    return {
      poll: {
        id: p.id,
        wishlistId: p.wishlist_id,
        question: p.question,
        status: p.status === 'closed' ? 'closed' : 'open',
        createdBy: p.created_by,
        createdAt: p.created_at,
        options: tallied,
        totalVotes: voteRows.length,
        userVotedOptionId: userVote,
      },
      pollsEnabled: true,
    };
  } catch (err) {
    logger.error('getPollResults: unexpected error', { error: String(err) });
    return { poll: null, pollsEnabled: true };
  }
}
