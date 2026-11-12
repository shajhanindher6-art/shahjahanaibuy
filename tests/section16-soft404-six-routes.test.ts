/**
 * Soft-404 middleware tests — the six additional dynamic routes
 * (Section 16, item #15).
 *
 * The layout pattern is PROVEN broken live while app/loading.tsx
 * exists (an async notFound() can never produce HTTP 404 — the
 * root shell streams 200 first), so these six routes get the same
 * middleware treatment as /products, /brands and /categories: the
 * check runs BEFORE rendering, and an unknown slug is rewritten to
 * /__smartbuy_not_found__, a path that matches NO route, so Next
 * returns its routing-level 404 (the real app/not-found.tsx UI,
 * HTTP 404) with the browser URL unchanged.
 *
 * EXISTENCE RULES — each mirrors the page's own notFound() logic
 * exactly (same getter the page calls, not a copy):
 * - /find/[query]    — getSearchTermBySlug (500 curated terms)
 * - /events/[slug]   — getEventBySlug (5 SEASONAL_EVENTS)
 * - /live/[slug]     — a row in live_shopping_sessions (one REST fetch).
 *                       A missing table (migration 033 not run) is a
 *                       POSITIVE answer: no table, no sessions, no
 *                       slug — so it rewrites. Any other non-200
 *                       still fails open.
 * - /creators/[slug] — a row in the creator_slugs VIEW (migration
 *                       044, owner-applied). Until 044 runs the view
 *                       is missing (PGRST205) and the check fails
 *                       open — the view missing proves nothing about
 *                       the slug. Checking profiles directly would
 *                       404 every real storefront (profiles RLS:
 *                       profiles_select_own only).
 * - /stores/[c]/[s]  — findStorePage (84 store pages, country+slug)
 * - /blog/[slug]     — getPostBySlug (21 posts)
 *
 * The four static-registry routes cost ZERO fetches (pure in-memory
 * lookup); /live costs exactly one REST fetch; /creators never
 * fetches. Every failure mode fails open to 'pass'.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  matchSlugRoute,
  localSlugExists,
  slugExists,
  resolveSlugRequest,
  type SlugCheckEnv,
} from '@/lib/middleware/slug-exists';
import { SEARCH_TERMS } from '@/lib/search-terms';
import { SEASONAL_EVENTS } from '@/components/seasonal/events';
import { getAllStorePages } from '@/lib/store-directory';
import { getAllPosts } from '@/lib/blog/posts';

const TEST_ENV: SlugCheckEnv = {
  supabaseUrl: 'https://test.supabase.co',
  supabaseAnonKey: 'test-anon-key',
};

function mockFetchJson(rows: unknown, ok = true, status = 200) {
  return vi.fn(async () => ({
    ok,
    status,
    json: async () => rows,
  })) as unknown as typeof fetch;
}

describe('matchSlugRoute — the six new routes', () => {
  it('matches /find, /events, /live, /creators and /blog with the right kind', () => {
    expect(matchSlugRoute('/find/macbook-air-13')).toEqual({
      kind: 'find',
      slug: 'macbook-air-13',
    });
    expect(matchSlugRoute('/events/black-friday')).toEqual({
      kind: 'event',
      slug: 'black-friday',
    });
    expect(matchSlugRoute('/live/deal-night-1')).toEqual({
      kind: 'live',
      slug: 'deal-night-1',
    });
    expect(matchSlugRoute('/creators/deal-hunter-pk')).toEqual({
      kind: 'creator',
      slug: 'deal-hunter-pk',
    });
    expect(matchSlugRoute('/blog/how-to-set-up-price-drop-alerts')).toEqual({
      kind: 'blog',
      slug: 'how-to-set-up-price-drop-alerts',
    });
  });

  it('matches /stores/[country]/[slug] with country and slug', () => {
    expect(matchSlugRoute('/stores/pk/daraz')).toEqual({
      kind: 'store',
      slug: 'daraz',
      country: 'pk',
    });
    expect(matchSlugRoute('/stores/global/amazon')).toEqual({
      kind: 'store',
      slug: 'amazon',
      country: 'global',
    });
    expect(matchSlugRoute('/stores/us/ebay')).toEqual({
      kind: 'store',
      slug: 'ebay',
      country: 'us',
    });
  });

  it('does not match index pages, deeper paths, or other routes', () => {
    expect(matchSlugRoute('/find')).toBeNull();
    expect(matchSlugRoute('/events')).toBeNull();
    expect(matchSlugRoute('/live')).toBeNull();
    expect(matchSlugRoute('/creators')).toBeNull();
    expect(matchSlugRoute('/blog')).toBeNull();
    expect(matchSlugRoute('/stores')).toBeNull();
    expect(matchSlugRoute('/stores/pk')).toBeNull();
    expect(matchSlugRoute('/stores/pk/daraz/extra')).toBeNull();
    expect(matchSlugRoute('/find/a/b')).toBeNull();
    expect(matchSlugRoute('/blog/a/b')).toBeNull();
    expect(matchSlugRoute('/deals')).toBeNull();
    expect(matchSlugRoute('/')).toBeNull();
  });

  it('decodes percent-encoded segments and rejects malformed encoding', () => {
    expect(matchSlugRoute('/find/macbook%20air%2013')).toEqual({
      kind: 'find',
      slug: 'macbook air 13',
    });
    expect(matchSlugRoute('/stores/pk/daraz%20x')).toEqual({
      kind: 'store',
      slug: 'daraz x',
      country: 'pk',
    });
    expect(matchSlugRoute('/blog/%E0%A4%A')).toBeNull();
    expect(matchSlugRoute('/stores/%E0%A4%A/daraz')).toBeNull();
  });
});

describe('localSlugExists — the static registries', () => {
  it('find: known curated term exists, unknown does not', () => {
    expect(localSlugExists('find', 'macbook-air-13')).toBe(true);
    expect(localSlugExists('find', 'best-laptop-under-500')).toBe(true);
    expect(localSlugExists('find', 'does-not-exist-xyz')).toBe(false);
    expect(localSlugExists('find', '')).toBe(false);
  });

  it('find: mirrors the page — the getter slugifies, so case/spaces resolve', () => {
    // app/find/[query]/page.tsx calls getSearchTermBySlug, which
    // slugifies its input; the middleware must agree with it.
    expect(localSlugExists('find', 'MacBook-Air-13')).toBe(true);
    expect(localSlugExists('find', 'macbook air 13')).toBe(true);
  });

  it('event: the 5 seasonal events exist, anything else does not', () => {
    for (const event of ['black-friday', '11-11', 'cyber-monday', 'eid', 'eid-al-adha']) {
      expect(localSlugExists('event', event)).toBe(true);
    }
    expect(localSlugExists('event', 'does-not-exist-xyz')).toBe(false);
    expect(localSlugExists('event', 'Black-Friday')).toBe(false);
  });

  it('blog: the 21 posts exist, anything else does not', () => {
    expect(localSlugExists('blog', 'how-to-set-up-price-drop-alerts')).toBe(true);
    expect(localSlugExists('blog', 'best-time-to-buy-a-laptop-alerts')).toBe(true);
    expect(localSlugExists('blog', 'how-to-spot-a-fake-sale')).toBe(true);
    expect(localSlugExists('blog', 'does-not-exist-xyz')).toBe(false);
    expect(localSlugExists('blog', 'How-To-Set-Up-Price-Drop-Alerts')).toBe(false);
  });

  it('store: country+slug pair must match — a slug in another country is unknown', () => {
    expect(localSlugExists('store', 'daraz', 'pk')).toBe(true);
    expect(localSlugExists('store', 'ebay', 'us')).toBe(true);
    expect(localSlugExists('store', 'ebay', 'gb')).toBe(true);
    expect(localSlugExists('store', 'amazon', 'global')).toBe(true);
    expect(localSlugExists('store', 'aliexpress', 'global')).toBe(true);
    // Same slug, wrong country (daraz is PK-only; ebay is not PK):
    expect(localSlugExists('store', 'daraz', 'us')).toBe(false);
    expect(localSlugExists('store', 'ebay', 'pk')).toBe(false);
    // Unknown country / unknown slug:
    expect(localSlugExists('store', 'ebay', 'xx')).toBe(false);
    expect(localSlugExists('store', 'does-not-exist-xyz', 'pk')).toBe(false);
    expect(localSlugExists('store', 'daraz')).toBe(false);
  });

  it('store: mirrors the page — findStorePage is case-insensitive', () => {
    expect(localSlugExists('store', 'Daraz', 'PK')).toBe(true);
    expect(localSlugExists('store', 'DARAZ', 'pk')).toBe(true);
  });
});

describe('slugExists — live sessions (one REST fetch)', () => {
  it('returns true when the session row exists', async () => {
    const fetchMock = mockFetchJson([{ slug: 'deal-night-1' }]);
    expect(
      await slugExists('live', 'deal-night-1', TEST_ENV, fetchMock)
    ).toBe(true);
    const url = String(
      (fetchMock as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0]
    );
    expect(url).toContain('/rest/v1/live_shopping_sessions?slug=eq.deal-night-1');
    expect(url).toContain('select=slug&limit=1');
  });

  it('returns false for an unknown session slug', async () => {
    const fetchMock = mockFetchJson([]);
    expect(
      await slugExists('live', 'does-not-exist-xyz', TEST_ENV, fetchMock)
    ).toBe(false);
  });

  it('returns false on the missing-table 404 — no table, no sessions, no slug', async () => {
    // PostgREST reports a table missing from its schema cache as
    // PGRST205 with HTTP 404. Sessions live ONLY in this table, so
    // a missing table is a POSITIVE "does not exist" answer — the
    // old fail-open here left /live/unknown-slug-xyz returning 200
    // live (verified 2026-11-12: "not set up yet" body). Any other
    // non-200 still throws -> fail-open.
    const missingTable = mockFetchJson(
      { code: 'PGRST205', message: 'Could not find the table' },
      false,
      404
    );
    expect(
      await slugExists('live', 'deal-night-1', TEST_ENV, missingTable)
    ).toBe(false);
    const serverError = mockFetchJson({ message: 'boom' }, false, 500);
    await expect(
      slugExists('live', 'deal-night-1', TEST_ENV, serverError)
    ).rejects.toThrow('HTTP 500');
  });

  it('throws on a 404 that is NOT a missing table (PGRST205 code required)', async () => {
    // A 404 with any other code (or an unparseable body) is a
    // generic failure, not proof the table is missing — fail open.
    const other404 = mockFetchJson(
      { code: 'PGRST116', message: 'no rows' },
      false,
      404
    );
    await expect(
      slugExists('live', 'deal-night-1', TEST_ENV, other404)
    ).rejects.toThrow('HTTP 404');
    const badBody = vi.fn(async () => ({
      ok: false,
      status: 404,
      json: async () => {
        throw new Error('not json');
      },
    })) as unknown as typeof fetch;
    await expect(
      slugExists('live', 'deal-night-1', TEST_ENV, badBody)
    ).rejects.toThrow('HTTP 404');
  });

  it('throws when env is missing, without calling fetch', async () => {
    const fetchMock = mockFetchJson([]);
    await expect(
      slugExists(
        'live',
        'deal-night-1',
        { supabaseUrl: null, supabaseAnonKey: null },
        fetchMock
      )
    ).rejects.toThrow('not configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('resolveSlugRequest — the six new routes', () => {
  it('passes known find/event/blog/store slugs without calling fetch', async () => {
    const fetchMock = mockFetchJson([]);
    expect(await resolveSlugRequest('/find/macbook-air-13', TEST_ENV, fetchMock)).toBe('pass');
    expect(await resolveSlugRequest('/events/black-friday', TEST_ENV, fetchMock)).toBe('pass');
    expect(
      await resolveSlugRequest('/blog/how-to-set-up-price-drop-alerts', TEST_ENV, fetchMock)
    ).toBe('pass');
    expect(await resolveSlugRequest('/stores/pk/daraz', TEST_ENV, fetchMock)).toBe('pass');
    expect(await resolveSlugRequest('/stores/global/amazon', TEST_ENV, fetchMock)).toBe('pass');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rewrites unknown find/event/blog/store slugs without calling fetch', async () => {
    const fetchMock = mockFetchJson([]);
    expect(await resolveSlugRequest('/find/does-not-exist-xyz', TEST_ENV, fetchMock)).toBe('rewrite');
    expect(await resolveSlugRequest('/events/does-not-exist-xyz', TEST_ENV, fetchMock)).toBe('rewrite');
    expect(await resolveSlugRequest('/blog/does-not-exist-xyz', TEST_ENV, fetchMock)).toBe('rewrite');
    expect(await resolveSlugRequest('/stores/pk/does-not-exist-xyz', TEST_ENV, fetchMock)).toBe('rewrite');
    expect(await resolveSlugRequest('/stores/xx/ebay', TEST_ENV, fetchMock)).toBe('rewrite');
    // Slug exists, but only in another country — the page 404s it.
    expect(await resolveSlugRequest('/stores/us/daraz', TEST_ENV, fetchMock)).toBe('rewrite');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('passes known live sessions and rewrites unknown ones (one fetch)', async () => {
    const known = mockFetchJson([{ slug: 'deal-night-1' }]);
    expect(await resolveSlugRequest('/live/deal-night-1', TEST_ENV, known)).toBe('pass');
    expect(known).toHaveBeenCalledTimes(1);
    const unknown = mockFetchJson([]);
    expect(await resolveSlugRequest('/live/does-not-exist-xyz', TEST_ENV, unknown)).toBe('rewrite');
    expect(unknown).toHaveBeenCalledTimes(1);
  });

  it('fails open on live fetch rejection, non-200, and missing env', async () => {
    const failing = vi.fn(async () => {
      throw new Error('fetch failed');
    }) as unknown as typeof fetch;
    expect(await resolveSlugRequest('/live/does-not-exist-xyz', TEST_ENV, failing)).toBe('pass');
    const bad = mockFetchJson({ message: 'boom' }, false, 500);
    expect(await resolveSlugRequest('/live/does-not-exist-xyz', TEST_ENV, bad)).toBe('pass');
    // Missing table (migration 033 not run) -> 404 PGRST205 ->
    // rewrite: no table means no session with any slug exists.
    const missingTable = mockFetchJson({ code: 'PGRST205' }, false, 404);
    expect(await resolveSlugRequest('/live/does-not-exist-xyz', TEST_ENV, missingTable)).toBe('rewrite');
    const fetchMock = mockFetchJson([]);
    expect(
      await resolveSlugRequest('/live/does-not-exist-xyz', { supabaseUrl: null, supabaseAnonKey: null }, fetchMock)
    ).toBe('pass');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('creators: known passes, unknown rewrites; missing view fails open', async () => {
    const known = mockFetchJson([{ creator_slug: 'deal-hunter-pk' }]);
    expect(await resolveSlugRequest('/creators/deal-hunter-pk', TEST_ENV, known)).toBe('pass');
    expect(known).toHaveBeenCalledTimes(1);
    const unknown = mockFetchJson([]);
    expect(await resolveSlugRequest('/creators/does-not-exist-xyz', TEST_ENV, unknown)).toBe('rewrite');
    expect(unknown).toHaveBeenCalledTimes(1);
    // View missing (migration 044 not run) -> 404 PGRST205 -> pass:
    // the view missing proves nothing about the slug.
    const missingView = mockFetchJson({ code: 'PGRST205' }, false, 404);
    expect(await resolveSlugRequest('/creators/does-not-exist-xyz', TEST_ENV, missingView)).toBe('pass');
    const failing = vi.fn(async () => {
      throw new Error('fetch failed');
    }) as unknown as typeof fetch;
    expect(await resolveSlugRequest('/creators/does-not-exist-xyz', TEST_ENV, failing)).toBe('pass');
  });

  it('passes non-slug routes through without calling fetch', async () => {
    const fetchMock = mockFetchJson([]);
    expect(await resolveSlugRequest('/find', TEST_ENV, fetchMock)).toBe('pass');
    expect(await resolveSlugRequest('/stores', TEST_ENV, fetchMock)).toBe('pass');
    expect(await resolveSlugRequest('/stores/pk', TEST_ENV, fetchMock)).toBe('pass');
    expect(await resolveSlugRequest('/deals', TEST_ENV, fetchMock)).toBe('pass');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('slugExists — creators (one REST fetch against the creator_slugs view)', () => {
  it('returns true when the slug is in the public view', async () => {
    const fetchMock = mockFetchJson([{ creator_slug: 'deal-hunter-pk' }]);
    expect(
      await slugExists('creator', 'deal-hunter-pk', TEST_ENV, fetchMock)
    ).toBe(true);
    const url = String(
      (fetchMock as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0]
    );
    expect(url).toContain('/rest/v1/creator_slugs?creator_slug=eq.deal-hunter-pk');
    expect(url).toContain('select=creator_slug&limit=1');
  });

  it('returns false when the view exists but the slug is not in it', async () => {
    const fetchMock = mockFetchJson([]);
    expect(
      await slugExists('creator', 'does-not-exist-xyz', TEST_ENV, fetchMock)
    ).toBe(false);
  });

  it('throws when the view is missing (migration 044 not run) — fail-open, never a false 404', async () => {
    // The view missing proves NOTHING about the slug: profiles may
    // hold creators the anon key cannot see, so the check must
    // throw (resolveSlugRequest turns it into 'pass') until 044
    // is applied — never return false here.
    const missingView = mockFetchJson(
      { code: 'PGRST205', message: 'Could not find the table' },
      false,
      404
    );
    await expect(
      slugExists('creator', 'deal-hunter-pk', TEST_ENV, missingView)
    ).rejects.toThrow('creator_slugs view missing');
    const serverError = mockFetchJson({ message: 'boom' }, false, 500);
    await expect(
      slugExists('creator', 'deal-hunter-pk', TEST_ENV, serverError)
    ).rejects.toThrow('HTTP 500');
  });
});

describe('registry sizes the checks rely on', () => {
  it('pins the curated counts: 500 find terms, 5 events, 84 store pages, 21 posts', () => {
    // If a sibling section legitimately grows a registry, update
    // the count here AND the header comment in
    // lib/middleware/slug-exists.ts — the middleware reads the
    // live registry either way, so a count change alone never
    // breaks the check; this pin only stops silent drift.
    expect(SEARCH_TERMS.length).toBe(500);
    expect(SEASONAL_EVENTS.length).toBe(5);
    expect(getAllStorePages().length).toBe(84);
    expect(getAllPosts().length).toBe(21);
  });
});

describe('middleware wiring + rewrite-target pins (structural)', () => {
  it('middleware.ts already routes every request through resolveSlugRequest before the session work', () => {
    const src = readFileSync(join(process.cwd(), 'middleware.ts'), 'utf8');
    expect(src).toContain('resolveSlugRequest');
    expect(src).toContain("'/__smartbuy_not_found__'");
    expect(src.indexOf('await resolveSlugRequest')).toBeLessThan(
      src.indexOf('await updateSession')
    );
  });

  it('the middleware matcher is the broad catch-all, so all six new routes are actually matched', () => {
    // The proven matcher gotcha: a per-route pattern like
    // '/products/:slug' matches NOTHING in Next 13.5.9. This
    // middleware uses one negative-lookahead catch-all (static
    // assets only), so /find/*, /events/*, /live/*, /creators/*,
    // /stores/*/* and /blog/* all reach the middleware.
    const src = readFileSync(join(process.cwd(), 'middleware.ts'), 'utf8');
    expect(src).toContain('_next/static');
    expect(src).not.toMatch(/matcher:\s*\[\s*'\/find/);
    expect(src).not.toMatch(/matcher:\s*\[\s*'\/products\/:slug'/);
  });

  it('no route exists at the rewrite target /__smartbuy_not_found__', () => {
    // A route there would silently break the 404 (the rewrite
    // would render it with 200 instead of the routing-level 404).
    expect(existsSync(join(process.cwd(), 'app/__smartbuy_not_found__'))).toBe(false);
  });

  it('the creators check is grounded: profiles stays private, the public view carries the slugs', () => {
    // profiles has no public select policy (only select_own), so
    // the middleware must never query profiles directly — and the
    // page still resolves creators via the service client.
    const migration001 = readFileSync(
      join(process.cwd(), 'supabase/migrations/20260710063738_001_core_foundation_tables.sql'),
      'utf8'
    );
    expect(migration001).toContain('profiles_select_own');
    expect(migration001).toContain('TO authenticated USING (auth.uid() = id)');
    const storefront = readFileSync(
      join(process.cwd(), 'lib/creator-storefront.ts'),
      'utf8'
    );
    expect(storefront).toContain('createSupabaseServiceClient');
    // Migration 044 is the public read: a security_invoker=false
    // view exposing ONLY id + creator_slug (a public policy on
    // profiles would leak email/full_name), granted to anon.
    const migration044 = readFileSync(
      join(process.cwd(), 'supabase/migrations/20261112170000_044_creator_slugs_public_view.sql'),
      'utf8'
    );
    expect(migration044).toContain('CREATE OR REPLACE VIEW public.creator_slugs');
    expect(migration044).toContain('security_invoker = false');
    expect(migration044).toContain('creator_slug');
    // The view selects ONLY id + creator_slug — no email/full_name
    // (the word "email" appears in the explanatory comment only).
    expect(migration044).toContain('SELECT id, creator_slug\nFROM public.profiles');
    expect(migration044).not.toMatch(/GRANT SELECT ON public\.profiles/);
    expect(migration044).toContain('GRANT SELECT ON public.creator_slugs TO anon');
    // And the middleware queries the view, never profiles.
    const slugExistsSrc = readFileSync(
      join(process.cwd(), 'lib/middleware/slug-exists.ts'),
      'utf8'
    );
    expect(slugExistsSrc).toContain('/rest/v1/creator_slugs');
    expect(slugExistsSrc).not.toContain('/rest/v1/profiles');
  });
});
