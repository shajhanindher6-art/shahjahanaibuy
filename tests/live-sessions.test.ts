/**
 * Tests for live shopping session status derivation + slug lookup
 * helpers (Section 6 item 6). Pure functions — no DB, no network.
 */
import { describe, it, expect } from 'vitest';
import {
  deriveSessionStatus,
  liveSessionStatusLabel,
  isValidLiveSessionSlug,
  isMissingTableError,
} from '@/lib/live-sessions';

function session(overrides: Partial<{ startsAt: string; endsAt: string | null; streamUrl: string | null }>) {
  return {
    startsAt: '2026-11-20T10:00:00Z',
    endsAt: '2026-11-20T12:00:00Z',
    streamUrl: 'https://example.com/live',
    ...overrides,
  };
}

describe('deriveSessionStatus', () => {
  it('is upcoming before the start when a stream URL is recorded', () => {
    expect(deriveSessionStatus(session({}), new Date('2026-11-19T10:00:00Z'))).toBe('upcoming');
  });

  it('is live_now between start and end when a stream URL is recorded', () => {
    expect(deriveSessionStatus(session({}), new Date('2026-11-20T11:00:00Z'))).toBe('live_now');
  });

  it('is live_now at exactly starts_at (boundary: start is inclusive)', () => {
    expect(deriveSessionStatus(session({}), new Date('2026-11-20T10:00:00Z'))).toBe('live_now');
  });

  it('is ended at exactly ends_at (boundary: end is inclusive)', () => {
    expect(deriveSessionStatus(session({}), new Date('2026-11-20T12:00:00Z'))).toBe('ended');
  });

  it('is ended after ends_at', () => {
    expect(deriveSessionStatus(session({}), new Date('2026-11-20T12:01:00Z'))).toBe('ended');
  });

  it('is scheduled_no_stream before the start when no stream URL is recorded', () => {
    expect(
      deriveSessionStatus(session({ streamUrl: null }), new Date('2026-11-19T10:00:00Z'))
    ).toBe('scheduled_no_stream');
  });

  it('is scheduled_no_stream after the start when no stream URL is recorded', () => {
    expect(
      deriveSessionStatus(session({ streamUrl: null }), new Date('2026-11-20T11:00:00Z'))
    ).toBe('scheduled_no_stream');
  });

  it('treats a blank stream URL the same as no stream URL', () => {
    expect(
      deriveSessionStatus(session({ streamUrl: '   ' }), new Date('2026-11-20T11:00:00Z'))
    ).toBe('scheduled_no_stream');
  });

  it('is ended after ends_at even when no stream URL was ever recorded', () => {
    expect(
      deriveSessionStatus(session({ streamUrl: null }), new Date('2026-11-21T00:00:00Z'))
    ).toBe('ended');
  });

  it('stays live_now past the start when no ends_at is recorded and a stream exists', () => {
    expect(
      deriveSessionStatus(session({ endsAt: null }), new Date('2026-12-01T00:00:00Z'))
    ).toBe('live_now');
  });

  it('never reports live_now without a stream URL, even with no ends_at', () => {
    expect(
      deriveSessionStatus(session({ endsAt: null, streamUrl: null }), new Date('2026-12-01T00:00:00Z'))
    ).toBe('scheduled_no_stream');
  });

  it('labels every status', () => {
    expect(liveSessionStatusLabel('upcoming')).toBe('Upcoming');
    expect(liveSessionStatusLabel('live_now')).toBe('Live now');
    expect(liveSessionStatusLabel('ended')).toBe('Ended');
    expect(liveSessionStatusLabel('scheduled_no_stream')).toBe('Scheduled — no stream yet');
  });
});

describe('isValidLiveSessionSlug', () => {
  it('accepts lowercase hyphenated slugs', () => {
    expect(isValidLiveSessionSlug('black-friday-live-2026')).toBe(true);
    expect(isValidLiveSessionSlug('live1')).toBe(true);
  });

  it('rejects uppercase, spaces, underscores and leading/trailing hyphens', () => {
    expect(isValidLiveSessionSlug('Black-Friday')).toBe(false);
    expect(isValidLiveSessionSlug('black friday')).toBe(false);
    expect(isValidLiveSessionSlug('black_friday')).toBe(false);
    expect(isValidLiveSessionSlug('-black-friday')).toBe(false);
    expect(isValidLiveSessionSlug('black-friday-')).toBe(false);
    expect(isValidLiveSessionSlug('')).toBe(false);
  });
});

describe('isMissingTableError', () => {
  it('treats Postgres 42P01 and PostgREST PGRST205 as missing-table', () => {
    expect(isMissingTableError({ code: '42P01' })).toBe(true);
    expect(isMissingTableError({ code: 'PGRST205' })).toBe(true);
  });

  it('does not treat other codes (or no error) as missing-table', () => {
    expect(isMissingTableError({ code: '23505' })).toBe(false);
    expect(isMissingTableError({ code: '42501' })).toBe(false);
    expect(isMissingTableError(null)).toBe(false);
    expect(isMissingTableError(undefined)).toBe(false);
  });
});
