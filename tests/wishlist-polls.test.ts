import { describe, expect, it } from 'vitest';
import {
  validatePollQuestion,
  validatePollOptions,
  tallyPollResults,
  hasUserVoted,
  applyVote,
} from '@/lib/wishlist-polls';

describe('validatePollQuestion', () => {
  it('accepts a 3–500 char question', () => {
    expect(validatePollQuestion('Which one?')).toBeNull();
    expect(validatePollQuestion('abc')).toBeNull();
    expect(validatePollQuestion('x'.repeat(500))).toBeNull();
  });

  it('rejects missing, short, and over-long questions', () => {
    expect(validatePollQuestion('')).not.toBeNull();
    expect(validatePollQuestion('  ')).not.toBeNull();
    expect(validatePollQuestion('ab')).not.toBeNull();
    expect(validatePollQuestion('x'.repeat(501))).not.toBeNull();
    expect(validatePollQuestion(undefined)).not.toBeNull();
    expect(validatePollQuestion(42)).not.toBeNull();
  });
});

describe('validatePollOptions', () => {
  it('dedupes product ids and accepts two or more', () => {
    expect(validatePollOptions(['a', 'b'])).toEqual({ productIds: ['a', 'b'] });
    expect(validatePollOptions(['a', 'b', 'a', 'c'])).toEqual({ productIds: ['a', 'b', 'c'] });
  });

  it('rejects fewer than two distinct options', () => {
    expect(validatePollOptions(['a'])).toEqual({
      error: expect.stringContaining('At least 2 different'),
    });
    expect(validatePollOptions(['a', 'a'])).toEqual({
      error: expect.stringContaining('At least 2 different'),
    });
    expect(validatePollOptions([])).toEqual({
      error: expect.stringContaining('At least 2 different'),
    });
    expect(validatePollOptions('a')).toEqual({
      error: expect.stringContaining('At least two'),
    });
  });

  it('drops blank ids before counting', () => {
    expect(validatePollOptions(['a', '', '  ', 'b'])).toEqual({ productIds: ['a', 'b'] });
  });
});

describe('tallyPollResults', () => {
  const options = [
    { optionId: 'o1', productId: 'p1', productName: 'Alpha', productSlug: 'alpha' },
    { optionId: 'o2', productId: 'p2', productName: 'Beta', productSlug: 'beta' },
  ];

  it('counts real votes and shares per option', () => {
    const results = tallyPollResults(options, [
      { optionId: 'o1' },
      { optionId: 'o1' },
      { optionId: 'o2' },
    ]);
    expect(results).toEqual([
      { optionId: 'o1', productId: 'p1', productName: 'Alpha', productSlug: 'alpha', votes: 2, share: 2 / 3 },
      { optionId: 'o2', productId: 'p2', productName: 'Beta', productSlug: 'beta', votes: 1, share: 1 / 3 },
    ]);
  });

  it('reports zero votes and zero share when nobody voted', () => {
    const results = tallyPollResults(options, []);
    expect(results.every((r) => r.votes === 0 && r.share === 0)).toBe(true);
  });

  it('ignores votes for unknown options in the counts', () => {
    const results = tallyPollResults(options, [{ optionId: 'o9' }]);
    expect(results.every((r) => r.votes === 0)).toBe(true);
  });
});

describe('hasUserVoted', () => {
  it('detects an existing vote by user id', () => {
    expect(hasUserVoted([{ userId: 'u1' }], 'u1')).toBe(true);
    expect(hasUserVoted([{ userId: 'u1' }], 'u2')).toBe(false);
    expect(hasUserVoted([], 'u1')).toBe(false);
  });
});

describe('applyVote (one vote per user per poll)', () => {
  const vote = { pollId: 'poll-1', optionId: 'o1', userId: 'u1' };

  it('adds a first vote', () => {
    const { votes, changed } = applyVote([], vote);
    expect(votes).toEqual([vote]);
    expect(changed).toBe(true);
  });

  it('moves a repeat vote to the new option (no duplicate)', () => {
    const { votes, changed } = applyVote([vote], { ...vote, optionId: 'o2' });
    expect(votes).toEqual([{ ...vote, optionId: 'o2' }]);
    expect(changed).toBe(true);
    expect(votes.filter((v) => v.userId === 'u1')).toHaveLength(1);
  });

  it('is a no-op when voting for the same option again', () => {
    const { votes, changed } = applyVote([vote], vote);
    expect(votes).toEqual([vote]);
    expect(changed).toBe(false);
  });

  it('keeps other users and other polls untouched', () => {
    const existing = [
      vote,
      { pollId: 'poll-1', optionId: 'o1', userId: 'u2' },
      { pollId: 'poll-2', optionId: 'o1', userId: 'u1' },
    ];
    const { votes } = applyVote(existing, { ...vote, optionId: 'o2' });
    expect(votes).toHaveLength(3);
    expect(votes.find((v) => v.pollId === 'poll-2')).toEqual({
      pollId: 'poll-2',
      optionId: 'o1',
      userId: 'u1',
    });
  });
});
