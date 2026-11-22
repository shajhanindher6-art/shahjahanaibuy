/**
 * Unit tests for the CJ SFTP fetcher helpers (scripts/fetch-cj-sftp).
 * Pure functions + temp files only — no network, no database.
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  isTransientSftpError,
  pickLatestFeedFile,
  verifyDownloadedSize,
  type FeedListing,
} from '@/scripts/fetch-cj-sftp';

describe('pickLatestFeedFile', () => {
  const base: FeedListing = {
    type: '-',
    name: 'DHGate-shopping-20261121.zip',
    modifyTime: 1000,
    size: 123,
  };

  it('picks the newest matching file', () => {
    const entries: FeedListing[] = [
      { ...base, name: 'DHGate-shopping-20261120.zip', modifyTime: 900 },
      { ...base, modifyTime: 1000 },
      { ...base, name: 'DHGate-shopping-20261119.zip', modifyTime: 800 },
    ];
    expect(pickLatestFeedFile(entries)?.name).toBe('DHGate-shopping-20261121.zip');
  });

  it('ignores directories and non-matching names', () => {
    const entries: FeedListing[] = [
      { type: 'd', name: 'DHGate-shopping-20261121.zip', modifyTime: 9999, size: 0 },
      { type: '-', name: 'other-feed.zip', modifyTime: 9999, size: 5 },
      { ...base },
    ];
    expect(pickLatestFeedFile(entries)?.name).toBe('DHGate-shopping-20261121.zip');
  });

  it('matches case-insensitively', () => {
    expect(
      pickLatestFeedFile([{ ...base, name: 'dhgate-shopping-20261121.ZIP' }])?.name,
    ).toBe('dhgate-shopping-20261121.ZIP');
  });

  it('returns null when nothing matches', () => {
    expect(
      pickLatestFeedFile([{ type: '-', name: 'readme.txt', modifyTime: 1, size: 1 }]),
    ).toBeNull();
    expect(pickLatestFeedFile([])).toBeNull();
  });
});

describe('verifyDownloadedSize', () => {
  it('passes when sizes match', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cj-size-'));
    const file = path.join(dir, 'feed.zip');
    fs.writeFileSync(file, Buffer.alloc(42));
    expect(() => verifyDownloadedSize(file, 42)).not.toThrow();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('throws on mismatch and on a missing file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cj-size-'));
    const file = path.join(dir, 'feed.zip');
    fs.writeFileSync(file, Buffer.alloc(42));
    expect(() => verifyDownloadedSize(file, 43)).toThrow(/size mismatch/);
    expect(() => verifyDownloadedSize(path.join(dir, 'nope.zip'), 1)).toThrow();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('isTransientSftpError', () => {
  it('treats network resets and timeouts as transient', () => {
    for (const message of [
      'read ECONNRESET',
      'Connection lost before handshake',
      'Timed out while waiting for handshake',
      'Socket closed',
    ]) {
      expect(isTransientSftpError(new Error(message))).toBe(true);
    }
    const withCode = new Error('connect failed') as Error & { code: string };
    withCode.code = 'ECONNRESET';
    expect(isTransientSftpError(withCode)).toBe(true);
  });

  it('never retries auth or config errors', () => {
    expect(
      isTransientSftpError(new Error('All configured authentication methods failed')),
    ).toBe(false);
    expect(
      isTransientSftpError(new Error('CJ SFTP is not configured: set CJ_SFTP_HOST')),
    ).toBe(false);
    expect(isTransientSftpError(new Error('Permission denied (password)'))).toBe(false);
  });
});
