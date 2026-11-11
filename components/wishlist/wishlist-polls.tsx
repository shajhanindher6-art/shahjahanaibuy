'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Vote } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import {
  validatePollOptions,
  validatePollQuestion,
  type WishlistPoll,
} from '@/lib/wishlist-polls';

/**
 * Wishlist polls UI (Section 12, Chunk E — retention completions).
 *
 * The poll engine already existed (lib/wishlist-polls.ts + the
 * GET/POST/vote API routes) and friends could already vote on the
 * public shared-wishlist page — but the owner had nowhere to CREATE
 * a poll, and their own dashboard detail page showed no polls at
 * all. This component closes that gap: it lists the polls on a
 * wishlist with real vote counts, lets signed-in visitors vote
 * (one vote per person; voting again moves the vote), and — for the
 * owner — creates a poll from the items already on the list.
 *
 * Honesty: options are always real catalog products (the API
 * re-checks every option id); vote counts and shares come only
 * from recorded wishlist_poll_votes rows; "No votes yet" renders
 * instead of a percentage when nobody has voted; when migration
 * 033 has not been run, the API reports pollsEnabled:false and this
 * says so plainly instead of faking polls. Nothing here changes
 * the poll API behaviour.
 */

export interface WishlistPollItem {
  productId: string;
  productName: string;
  productSlug?: string | null;
}

export interface WishlistPollsProps {
  wishlistId: string;
  /** Items on the list — poll options are picked from these. */
  items: WishlistPollItem[];
  /** Owner sees the create-poll form; friends only vote. */
  canCreate?: boolean;
}

export function WishlistPolls({
  wishlistId,
  items,
  canCreate = false,
}: WishlistPollsProps) {
  const [polls, setPolls] = useState<WishlistPoll[] | null>(null);
  const [pollsEnabled, setPollsEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [votingOptionId, setVotingOptionId] = useState<string | null>(null);
  const [voteError, setVoteError] = useState<string | null>(null);

  // Create-poll form state (owner only).
  const [showCreate, setShowCreate] = useState(false);
  const [question, setQuestion] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const fetchPolls = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/wishlist-polls?wishlistId=${encodeURIComponent(wishlistId)}`);
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success && Array.isArray(data.data)) {
        setPolls(data.data as WishlistPoll[]);
        setPollsEnabled(data.meta?.pollsEnabled !== false);
      } else if (data?.meta?.pollsEnabled === false) {
        setPolls([]);
        setPollsEnabled(false);
      } else {
        setPolls([]);
      }
    } catch {
      setPolls([]);
    } finally {
      setLoading(false);
    }
  }, [wishlistId]);

  useEffect(() => {
    void fetchPolls();
  }, [fetchPolls]);

  const vote = async (pollId: string, optionId: string) => {
    setVoteError(null);
    setVotingOptionId(optionId);
    try {
      const res = await fetch(`/api/v1/wishlist-polls/${pollId}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ optionId }),
      });
      if (res.status === 401) {
        setVoteError('Sign in to vote on polls.');
        return;
      }
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success || !data.data) {
        setVoteError(data?.error?.message ?? 'Could not save your vote.');
        return;
      }
      const updated = data.data as WishlistPoll;
      setPolls((prev) => (prev ?? []).map((p) => (p.id === pollId ? updated : p)));
    } catch {
      setVoteError('Could not save your vote.');
    } finally {
      setVotingOptionId(null);
    }
  };

  const toggleOption = (productId: string) => {
    setSelectedIds((prev) =>
      prev.includes(productId)
        ? prev.filter((id) => id !== productId)
        : [...prev, productId]
    );
  };

  const createPoll = async () => {
    setCreateError(null);
    const questionError = validatePollQuestion(question);
    if (questionError) {
      setCreateError(questionError);
      return;
    }
    const options = validatePollOptions(selectedIds);
    if ('error' in options) {
      setCreateError(options.error);
      return;
    }
    setCreating(true);
    try {
      const res = await fetch('/api/v1/wishlist-polls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wishlistId,
          question: question.trim(),
          productIds: options.productIds,
        }),
      });
      const data = await res.json().catch(() => null);
      if (res.status === 401) {
        setCreateError('Sign in to create a poll.');
        return;
      }
      if (res.status === 503) {
        setCreateError(
          'Wishlist polls are not set up yet — the owner still needs to run migration 033 once.'
        );
        return;
      }
      if (!res.ok || !data?.success) {
        setCreateError(data?.error?.message ?? 'Could not create the poll.');
        return;
      }
      // The create response carries no vote counts — refetch so the
      // new poll renders with its real (empty) tallies.
      setQuestion('');
      setSelectedIds([]);
      setShowCreate(false);
      await fetchPolls();
    } catch {
      setCreateError('Could not create the poll.');
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-6">
        <LoadingSpinner />
      </div>
    );
  }

  if (!pollsEnabled) {
    return (
      <p className="text-sm text-muted-foreground">
        Wishlist polls are not set up yet — the owner still needs to
        run migration 033 once.
      </p>
    );
  }

  const canOfferCreate = canCreate && items.length >= 2;

  return (
    <section aria-label="Wishlist polls" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-xl font-bold">
          <Vote className="h-5 w-5" /> Polls
        </h2>
        {canOfferCreate && !showCreate && (
          <Button variant="outline" size="sm" onClick={() => setShowCreate(true)}>
            Ask friends to vote
          </Button>
        )}
      </div>

      {voteError && (
        <p role="alert" className="text-sm text-red-600">
          {voteError}
        </p>
      )}

      {polls !== null && polls.length === 0 && !showCreate && (
        <p className="text-sm text-muted-foreground">
          {canCreate
            ? 'No polls yet — ask your friends which product to pick.'
            : 'No polls on this wishlist yet.'}
        </p>
      )}

      {polls !== null &&
        polls.map((poll) => (
          <Card key={poll.id}>
            <CardContent className="space-y-3 pt-6">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="font-semibold">{poll.question}</p>
                {poll.status === 'closed' && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    Closed
                  </span>
                )}
              </div>
              {poll.totalVotes === 0 ? (
                <p className="text-sm text-muted-foreground">No votes yet</p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {poll.totalVotes} vote{poll.totalVotes !== 1 ? 's' : ''}
                </p>
              )}
              <ul className="space-y-2">
                {poll.options.map((option) => {
                  const isMine = poll.userVotedOptionId === option.optionId;
                  return (
                    <li key={option.optionId}>
                      <Button
                        variant={isMine ? 'default' : 'outline'}
                        className="flex min-h-[44px] w-full items-center justify-between gap-2"
                        disabled={poll.status !== 'open' || votingOptionId === option.optionId}
                        onClick={() => void vote(poll.id, option.optionId)}
                        aria-pressed={isMine}
                      >
                        <span className="truncate text-left">
                          {option.productSlug ? (
                            <Link
                              href={`/products/${option.productSlug}`}
                              onClick={(e) => e.stopPropagation()}
                              className="underline-offset-2 hover:underline"
                            >
                              {option.productName ?? 'Product'}
                            </Link>
                          ) : (
                            option.productName ?? 'Product'
                          )}
                          {isMine && ' — Your vote'}
                        </span>
                        <span className="shrink-0 text-sm">
                          {option.votes} ·{' '}
                          {poll.totalVotes > 0
                            ? `${Math.round(option.share * 100)}%`
                            : '—'}
                        </span>
                      </Button>
                    </li>
                  );
                })}
              </ul>
              <p className="text-xs text-muted-foreground">
                One vote per person. Voting again moves your vote.
              </p>
            </CardContent>
          </Card>
        ))}

      {canOfferCreate && showCreate && (
        <Card>
          <CardContent className="space-y-4 pt-6">
            <h3 className="font-semibold">New poll</h3>
            <div>
              <label htmlFor="poll-question" className="text-sm font-medium">
                Question
              </label>
              <input
                id="poll-question"
                type="text"
                value={question}
                maxLength={500}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="e.g. Which laptop should I get?"
                className="mt-1 min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>
            <fieldset>
              <legend className="text-sm font-medium">
                Options — pick at least 2 products from this list
              </legend>
              <ul className="mt-2 space-y-2">
                {items.map((item) => (
                  <li key={item.productId}>
                    <label className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(item.productId)}
                        onChange={() => toggleOption(item.productId)}
                      />
                      <span className="truncate">{item.productName}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
            {createError && (
              <p role="alert" className="text-sm text-red-600">
                {createError}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void createPoll()} disabled={creating}>
                {creating ? 'Creating…' : 'Create poll'}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setShowCreate(false);
                  setCreateError(null);
                }}
                disabled={creating}
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {canCreate && items.length < 2 && (
        <p className="text-sm text-muted-foreground">
          Add at least 2 products to this wishlist to create a poll.
        </p>
      )}
    </section>
  );
}
