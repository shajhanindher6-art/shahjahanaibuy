/**
 * Tests for the native-app waitlist validation + join helper
 * (Section 6 item 18). Validation is pure — no DB, no network.
 * The join path is tested against a stub Supabase client so the
 * dedupe (23505) and missing-table (42P01 / PGRST205) branches are
 * covered without a real database. No real secrets in tests.
 */
import { describe, it, expect, vi } from 'vitest';
import { validateWaitlistInput, joinAppWaitlist } from '@/lib/app-waitlist';

describe('validateWaitlistInput', () => {
  it('accepts a valid email for ios and android', () => {
    expect(validateWaitlistInput({ email: 'user@example.com', platform: 'ios' })).toEqual({
      ok: true,
      email: 'user@example.com',
      platform: 'ios',
      error: null,
    });
    expect(validateWaitlistInput({ email: 'user@example.com', platform: 'android' }).ok).toBe(true);
  });

  it('normalises email (trim + lowercase) and platform case', () => {
    const r = validateWaitlistInput({ email: '  USER@Example.COM  ', platform: 'IOS' });
    expect(r.ok).toBe(true);
    expect(r.email).toBe('user@example.com');
    expect(r.platform).toBe('ios');
  });

  it('rejects malformed emails', () => {
    for (const bad of ['', 'not-an-email', 'user@', 'user@example', 'user@.com', 'user name@example.com']) {
      const r = validateWaitlistInput({ email: bad, platform: 'android' });
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/valid email/i);
    }
  });

  it('rejects platforms other than ios / android', () => {
    for (const bad of ['', 'web', 'windows', 'macos', 'ios2']) {
      const r = validateWaitlistInput({ email: 'user@example.com', platform: bad });
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/ios.*android|android.*ios/i);
    }
  });
});

describe('joinAppWaitlist (stub client)', () => {
  // Minimal stub of the Supabase client surface this helper uses.
  function stubClient(insertResult: { error: { code?: string; message: string } | null }) {
    const insert = vi.fn().mockResolvedValue(insertResult);
    return {
      insert,
      from: vi.fn().mockReturnValue({ insert }),
    } as unknown as Parameters<typeof joinAppWaitlist>[0];
  }

  it('returns joined on a clean insert, with the normalised row', async () => {
    const client = stubClient({ error: null });
    const result = await joinAppWaitlist(client, { email: '  USER@Example.com ', platform: 'android' });
    expect(result).toEqual({ status: 'joined' });
    const insert = (client.from as ReturnType<typeof vi.fn>).mock.results[0].value.insert;
    expect(insert).toHaveBeenCalledWith({ email: 'user@example.com', platform: 'android' });
  });

  it('returns already_joined on the UNIQUE(email, platform) violation (23505)', async () => {
    const client = stubClient({ error: { code: '23505', message: 'duplicate key' } });
    const result = await joinAppWaitlist(client, { email: 'user@example.com', platform: 'ios' });
    expect(result).toEqual({ status: 'already_joined' });
  });

  it('returns unavailable when the table is missing (42P01 and PGRST205)', async () => {
    for (const code of ['42P01', 'PGRST205']) {
      const client = stubClient({ error: { code, message: 'table does not exist' } });
      const result = await joinAppWaitlist(client, { email: 'user@example.com', platform: 'ios' });
      expect(result).toEqual({ status: 'unavailable' });
    }
  });

  it('returns unavailable on other database errors', async () => {
    const client = stubClient({ error: { code: '42501', message: 'permission denied' } });
    const result = await joinAppWaitlist(client, { email: 'user@example.com', platform: 'ios' });
    expect(result).toEqual({ status: 'unavailable' });
  });

  it('does not call the database for invalid input', async () => {
    const client = stubClient({ error: null });
    const result = await joinAppWaitlist(client, { email: 'bad', platform: 'ios' });
    expect(result).toEqual({ status: 'unavailable' });
    expect(client.from).not.toHaveBeenCalled();
  });
});
