import { describe, expect, it } from 'vitest';
import { RELEASES, PENDING_SYNC_RELEASES } from '../app/changelog/releases';

describe('changelog releases', () => {
  it('lists all 55 releases from the sync record', () => {
    expect(RELEASES.length).toBe(55);
  });

  it('has unique full commit SHAs', () => {
    const shas = RELEASES.map((r) => r.sha);
    expect(new Set(shas).size).toBe(shas.length);
    for (const sha of shas) expect(sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it('gives every release a title and a non-empty changed-files list', () => {
    for (const release of RELEASES) {
      expect(release.title.length).toBeGreaterThan(5);
      expect(release.paths.length).toBeGreaterThan(0);
    }
  });

  it('shows a date only when confirmed — and any shown date is a valid ISO date', () => {
    const dated = RELEASES.filter((r) => r.date);
    expect(dated.length).toBeGreaterThan(0);
    for (const release of dated) {
      expect(release.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(release.date ?? ''))).toBe(false);
    }
    // The crash-fix release is the latest dated entry in the record.
    const fix = RELEASES.find((r) => r.sha.startsWith('f4a15b4f'));
    expect(fix?.date).toBe('2026-11-10');
  });

  it('keeps pending-sync releases separate, each with a confirmed date', () => {
    expect(PENDING_SYNC_RELEASES.length).toBeGreaterThan(0);
    for (const release of PENDING_SYNC_RELEASES) {
      expect(release.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(release.title.length).toBeGreaterThan(5);
    }
    expect(RELEASES.some((r) => r.sha.startsWith('83d848ac'))).toBe(false);
  });
});
