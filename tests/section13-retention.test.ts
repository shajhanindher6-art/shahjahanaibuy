import { describe, expect, it } from 'vitest';
import { parseNewsletterSource } from '@/lib/newsletter';
import { isValidCreatorSlug } from '@/lib/creator-storefront';
import { getPollCountsByWishlist } from '@/lib/wishlist-polls';
import type { AnySupabaseClient } from '@/lib/supabase/types';

// Section 13, Chunk G — retention & growth completions (items
// 51–62). These tests cover the pure logic the new UI relies on;
// the wiring itself (mounts, links, buttons, URL sync) is client /
// server rendering covered by `tsc --noEmit` and the build.

describe('newsletter sources (item 51)', () => {
  it('accepts the three new mount points', () => {
    for (const source of ['deals', 'digest', 'notifications'] as const) {
      const parsed = parseNewsletterSource(source);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(parsed.source).toBe(source);
    }
  });

  it('still accepts footer and homepage', () => {
    expect(parseNewsletterSource('footer')).toEqual({ ok: true, source: 'footer' });
    expect(parseNewsletterSource('homepage')).toEqual({ ok: true, source: 'homepage' });
  });

  it('rejects unknown or missing sources', () => {
    expect(parseNewsletterSource('sidebar').ok).toBe(false);
    expect(parseNewsletterSource(undefined).ok).toBe(false);
    expect(parseNewsletterSource('').ok).toBe(false);
  });
});

describe('creator slug validation (item 59)', () => {
  it('accepts lowercase slugs with digits and hyphens', () => {
    expect(isValidCreatorSlug('gadget-guru')).toBe(true);
    expect(isValidCreatorSlug('ab')).toBe(true);
    expect(isValidCreatorSlug('deals-2026')).toBe(true);
  });

  it('rejects uppercase, spaces, underscores, and bad lengths', () => {
    expect(isValidCreatorSlug('Gadget-Guru')).toBe(false);
    expect(isValidCreatorSlug('gadget guru')).toBe(false);
    expect(isValidCreatorSlug('gadget_guru')).toBe(false);
    expect(isValidCreatorSlug('a')).toBe(false);
    expect(isValidCreatorSlug('')).toBe(false);
    expect(isValidCreatorSlug('-guru')).toBe(false);
    expect(isValidCreatorSlug('guru-')).toBe(false);
    expect(isValidCreatorSlug('x'.repeat(65))).toBe(false);
    expect(isValidCreatorSlug(null)).toBe(false);
    expect(isValidCreatorSlug(42)).toBe(false);
  });

  it('accepts a 64-character slug (the maximum)', () => {
    expect(isValidCreatorSlug('a'.repeat(64))).toBe(true);
  });
});

describe('poll counts batched into the wishlists list (item 53)', () => {
  // Minimal stub of the Supabase client shape
  // getPollCountsByWishlist uses: from().select().in() → { data, error }.
  function stubClient(
    rows: Array<{ wishlist_id: string }> | null,
    error: { code?: string; message: string } | null
  ): AnySupabaseClient {
    return {
      from: () => ({
        select: () => ({
          in: async () => ({ data: rows, error }),
        }),
      }),
    } as unknown as AnySupabaseClient;
  }

  it('counts polls per wishlist from one query', async () => {
    const client = stubClient(
      [
        { wishlist_id: 'w1' },
        { wishlist_id: 'w1' },
        { wishlist_id: 'w2' },
      ],
      null
    );
    const counts = await getPollCountsByWishlist(client, ['w1', 'w2', 'w3']);
    expect(counts.get('w1')).toBe(2);
    expect(counts.get('w2')).toBe(1);
    expect(counts.get('w3')).toBeUndefined();
  });

  it('returns an empty map when there are no wishlists', async () => {
    const client = stubClient([{ wishlist_id: 'w1' }], null);
    const counts = await getPollCountsByWishlist(client, []);
    expect(counts.size).toBe(0);
  });

  it('returns an empty map when the 033 poll table is missing', async () => {
    const client = stubClient(null, { code: '42P01', message: 'relation does not exist' });
    const counts = await getPollCountsByWishlist(client, ['w1']);
    expect(counts.size).toBe(0);
  });

  it('returns an empty map on any other query failure', async () => {
    const client = stubClient(null, { code: '500', message: 'boom' });
    const counts = await getPollCountsByWishlist(client, ['w1']);
    expect(counts.size).toBe(0);
  });
});

// The mark-as-read PATCH route (item 58) and the digest ?frequency=
// URL sync (item 56) have no exported pure helper — their logic
// lives in the route handler / page and is covered by
// `tsc --noEmit` and the build, not unit-tested here.
