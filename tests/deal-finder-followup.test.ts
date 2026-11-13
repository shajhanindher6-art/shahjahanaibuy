/**
 * Unit tests for multi-turn follow-up resolution (S5#2 —
 * conversational commerce): resolveFollowUpQuery in
 * lib/deal-finder-stream.ts rewrites a follow-up against the
 * previous turn's product names into a self-contained query, and
 * leaves everything else untouched.
 */

import { describe, expect, it } from 'vitest';
import { resolveFollowUpQuery } from '@/lib/deal-finder-stream';

const TWO = ['MacBook Air 13', 'Dell XPS 13'];
const THREE = ['MacBook Air 13', 'Dell XPS 13', 'HP Spectre x360'];
const ONE = ['MacBook Air 13'];

describe('resolveFollowUpQuery — compare turns (2–3 products)', () => {
  it('rewrites "which is the cheapest?" into a compare query', () => {
    expect(resolveFollowUpQuery('which is the cheapest?', TWO)).toBe(
      'Compare MacBook Air 13, Dell XPS 13 — which has the lowest price?'
    );
  });

  it('rewrites Roman Urdu "aur sasta dikhao" into a cheaper query', () => {
    expect(resolveFollowUpQuery('aur sasta dikhao', TWO)).toBe(
      'Compare MacBook Air 13, Dell XPS 13 — which has the lowest price?'
    );
  });

  it('rewrites "is se halka kaun sa hai?" into a lighter query', () => {
    expect(resolveFollowUpQuery('is se halka kaun sa hai?', TWO)).toBe(
      'Compare MacBook Air 13, Dell XPS 13 — which is the lightest?'
    );
  });

  it('rewrites "in mein best kaunsa hai?" into a best-pick query', () => {
    expect(resolveFollowUpQuery('in mein best kaunsa hai?', TWO)).toBe(
      'Compare MacBook Air 13, Dell XPS 13 and recommend the best one for most buyers.'
    );
  });

  it('rewrites "compare them" into a full comparison', () => {
    expect(resolveFollowUpQuery('compare them', TWO)).toBe(
      'Compare MacBook Air 13, Dell XPS 13 — full comparison.'
    );
  });

  it('uses at most three product names', () => {
    expect(resolveFollowUpQuery('cheapest?', THREE)).toContain(
      'MacBook Air 13, Dell XPS 13, HP Spectre x360'
    );
  });
});

describe('resolveFollowUpQuery — single product in context', () => {
  it('asks for a cheaper alternative', () => {
    expect(resolveFollowUpQuery('aur sasta dikhao', ONE)).toBe(
      'Find a cheaper alternative to MacBook Air 13.'
    );
  });

  it('asks for a lighter alternative', () => {
    expect(resolveFollowUpQuery('is se halka kaun sa hai?', ONE)).toBe(
      'Find a lighter alternative to MacBook Air 13.'
    );
  });

  it('asks for more detail on a "best one" follow-up', () => {
    expect(resolveFollowUpQuery('is this the best one?', ONE)).toBe(
      'Tell me more about MacBook Air 13 — is it the best choice?'
    );
  });
});

describe('resolveFollowUpQuery — passthrough', () => {
  it('leaves a follow-up unchanged when there is no product context', () => {
    expect(resolveFollowUpQuery('which is the cheapest?', [])).toBe('which is the cheapest?');
    expect(resolveFollowUpQuery('aur sasta dikhao', [])).toBe('aur sasta dikhao');
  });

  it('leaves fresh self-contained questions unchanged', () => {
    expect(resolveFollowUpQuery('best laptop under $1000', TWO)).toBe('best laptop under $1000');
    expect(resolveFollowUpQuery('Best deals today', TWO)).toBe('Best deals today');
    expect(resolveFollowUpQuery('Noise cancelling headphones', TWO)).toBe(
      'Noise cancelling headphones'
    );
  });

  it('leaves long messages unchanged even when they contain a keyword', () => {
    const long =
      'I am looking for a laptop for university work and light video editing, and I want to know which one is the cheapest option among all the laptops you have in your catalog with at least 16GB RAM.';
    expect(resolveFollowUpQuery(long, TWO)).toBe(long);
  });
});
