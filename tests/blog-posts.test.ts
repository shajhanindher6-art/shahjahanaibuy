import { describe, expect, it } from 'vitest';
import { POSTS, EDITORIAL_TEAM_AUTHOR, type Block } from '../lib/blog/posts';

const EXISTING_SLUGS = [
  'how-to-read-price-history-chart-laptop',
  'how-to-spot-a-fake-sale',
  'what-a-999-laptop-really-costs-in-pakistan',
  'how-smartbuy-coupons-work-save10-bestbuy15',
  'buy-now-or-wait-how-to-decide',
  'best-time-to-buy-a-laptop-alerts',
  'online-shopping-pakistan-daraz-amazon-best-buy',
  'how-to-set-up-price-drop-alerts',
  'how-to-spot-fake-reviews',
  'best-tech-gifts-under-100',
];

const NEW_SLUGS = [
  'best-laptops-under-1000-2026',
  'headphones-buying-guide-2026',
  'tv-buying-guide-2026',
  'gaming-accessories-buying-guide',
  'kitchen-appliances-buying-guide',
  'fitness-trackers-buying-guide-2026',
  'camera-buying-guide-2026',
  'tablet-vs-laptop-which-to-buy',
  'back-to-school-tech-checklist-2026',
  'warranty-returns-guide-online-shopping',
];

/** Section 14, chunk 9 — the creator-program guide, published 2026-11-11. */
const SECTION14_SLUGS = ['how-to-become-a-creator-on-smartbuy'];

/** Rough word count over the rendered text of every block (same method used when drafting). */
function countWords(blocks: Block[]): number {
  let words = 0;
  for (const block of blocks) {
    if (block.type === 'p' || block.type === 'h2' || block.type === 'callout') {
      words += block.text.split(/\s+/).filter(Boolean).length;
    } else if (block.type === 'list') {
      for (const item of block.items) words += item.split(/\s+/).filter(Boolean).length;
    } else if (block.type === 'table') {
      for (const row of block.rows) {
        for (const cell of row) words += cell.split(/\s+/).filter(Boolean).length;
      }
    }
  }
  return words;
}

describe('blog posts', () => {
  it('has the 10 launch articles plus 10 new articles plus the Section 14 creator guide', () => {
    expect(POSTS.length).toBe(21);
    for (const slug of [...EXISTING_SLUGS, ...NEW_SLUGS, ...SECTION14_SLUGS]) {
      expect(POSTS.some((p) => p.slug === slug)).toBe(true);
    }
  });

  it('has unique slugs', () => {
    const slugs = POSTS.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('attributes every post to the generic SmartBuy Editorial Team — no invented person', () => {
    for (const post of POSTS) {
      expect(post.author).toEqual(EDITORIAL_TEAM_AUTHOR);
      expect(post.author?.name).toBe('SmartBuy Editorial Team');
      expect(post.author?.bio.length).toBeGreaterThan(20);
    }
  });

  it('records an ISO lastUpdated date on every post', () => {
    for (const post of POSTS) {
      expect(post.lastUpdated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(post.lastUpdated ?? ''))).toBe(false);
    }
  });

  it('dates the 10 new articles to 2026-11-10', () => {
    for (const slug of NEW_SLUGS) {
      const post = POSTS.find((p) => p.slug === slug);
      expect(post?.datePublished).toBe('2026-11-10');
    }
  });

  it('dates the Section 14 creator guide to 2026-11-11', () => {
    for (const slug of SECTION14_SLUGS) {
      const post = POSTS.find((p) => p.slug === slug);
      expect(post?.datePublished).toBe('2026-11-11');
    }
  });

  it('keeps every article in the ~750–900 word standard (600–950 by this counter)', () => {
    for (const post of POSTS) {
      const words = countWords(post.content);
      expect(words, `${post.slug} word count`).toBeGreaterThanOrEqual(600);
      expect(words, `${post.slug} word count`).toBeLessThanOrEqual(950);
    }
  });

  it('gives every post a title, excerpt, tags, and at least one heading', () => {
    for (const post of POSTS) {
      expect(post.title.length).toBeGreaterThan(10);
      expect(post.excerpt.length).toBeGreaterThan(20);
      expect(post.tags.length).toBeGreaterThan(0);
      expect(post.content.some((b) => b.type === 'h2')).toBe(true);
      expect(post.readMinutes).toBeGreaterThan(0);
    }
  });
});
