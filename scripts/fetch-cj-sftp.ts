/**
 * CJ Affiliate — SFTP fetch helper for the DHGate product feed.
 *
 * Downloads the latest DHGate-shopping-*.zip from CJ's SFTP
 * server into ./tmp/feeds/ and then runs the streaming importer
 * (scripts/import-cj-feed.ts) on it.
 *
 * Credentials come ONLY from the environment — never hardcoded,
 * never committed:
 *   CJ_SFTP_HOST, CJ_SFTP_PORT (default 22),
 *   CJ_SFTP_USERNAME, CJ_SFTP_PASSWORD
 * The SFTP password is emailed to the owner by CJ ("CJ Affiliate SFTP
 * Server Information" / "New CJ Affiliate CJ SFTP Server Credentials",
 * datatransfer@cj.com) and stored in Vercel only. Do NOT reset it in
 * the CJ dashboard unless the emailed password is lost — resetting
 * invalidates the emailed password. The password is never printed or
 * logged here.
 *
 * NOTE (2026-11-22): outbound SSH is turned off in this sandbox runtime
 * (the egress proxy resets the SSH handshake before auth). The fetcher
 * then fails with "Connection lost before handshake" — retry/timeout
 * below covers transient network failures only and cannot pass a
 * blocked SSH protocol. The user must allow SSH in the runtime's
 * network permissions first.
 *
 * Usage (run from the repo root):
 *   npx tsx scripts/fetch-cj-sftp.ts
 *   npx tsx scripts/fetch-cj-sftp.ts --limit 1000 --only-with-gtin
 *   npx tsx scripts/fetch-cj-sftp.ts --no-import   # download only
 *   npm run fetch:cj-sftp
 *
 * Flags (importer flags are passed through):
 *   --limit <n>        stop the import after n ACCEPTED rows
 *   --only-with-gtin   import only rows with a GS1-valid GTIN
 *   --no-import        download only, do not run the importer
 *   --remote-dir <dir> SFTP directory to list (default: remote home)
 *
 * Exit code 0 on success, 1 on any fatal error.
 */

import fs from 'node:fs';
import path from 'node:path';
import Client from 'ssh2-sftp-client';
import { env } from '@/lib/config/env';
import { importCjFeed, type ImportStats } from '@/scripts/import-cj-feed';

const FEED_DIR = path.resolve('./tmp/feeds');
const FEED_GLOB = /^DHGate-shopping-.*\.zip$/i;

// Retry / timeout for transient network failures only (ECONNRESET,
// handshake timeouts). Auth and config errors are never retried.
const CONNECT_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [2_000, 4_000];

const TRANSIENT_PATTERNS = [
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'EPIPE',
  'ENOTFOUND',
  'Connection lost',
  'Timed out',
  'handshake',
  'Socket closed',
];

export function isTransientSftpError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && TRANSIENT_PATTERNS.includes(code)) return true;
  return TRANSIENT_PATTERNS.some((pattern) => message.includes(pattern));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface FeedListing {
  type: string;
  name: string;
  modifyTime: number;
  size: number;
}

/** Newest DHGate-shopping-*.zip in a listing, or null when there is none. */
export function pickLatestFeedFile(entries: FeedListing[]): FeedListing | null {
  const candidates = entries
    .filter((entry) => entry.type === '-' && FEED_GLOB.test(entry.name))
    .sort((a, b) => b.modifyTime - a.modifyTime);
  return candidates[0] ?? null;
}

/** Throw unless the downloaded file's size matches the SFTP listing. */
export function verifyDownloadedSize(localPath: string, expectedSize: number): void {
  const actualSize = fs.statSync(localPath).size;
  if (actualSize !== expectedSize) {
    throw new Error(
      `Downloaded file size mismatch for ${localPath}: expected ${expectedSize} bytes, ` +
        `got ${actualSize} bytes. The download may be incomplete — delete the file and re-run.`,
    );
  }
}

interface FetchOptions {
  limit: number;
  onlyWithGtin: boolean;
  noImport: boolean;
  remoteDir: string;
}

function parseArgs(argv: string[]): FetchOptions {
  const get = (flag: string, fallback: string): string => {
    const idx = argv.indexOf(flag);
    return idx >= 0 && argv[idx + 1] !== undefined ? argv[idx + 1] : fallback;
  };
  const limitRaw = get('--limit', '0');
  const limit = Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 0) {
    throw new Error(`--limit must be a non-negative integer, got "${limitRaw}"`);
  }
  return {
    limit,
    onlyWithGtin: argv.includes('--only-with-gtin'),
    noImport: argv.includes('--no-import'),
    remoteDir: get('--remote-dir', '.'),
  };
}

function requireSftpConfig(): {
  host: string;
  port: number;
  username: string;
  password: string;
} {
  const host = env.cjSftpHost;
  const username = env.cjSftpUsername;
  const password = env.cjSftpPassword;
  if (!host || !username || !password) {
    throw new Error(
      'CJ SFTP is not configured: set CJ_SFTP_HOST, CJ_SFTP_USERNAME and ' +
        'CJ_SFTP_PASSWORD in the environment (Vercel only, never in git). ' +
        'The password comes from CJ → Account → Subscriptions → RESET SFTP PASSWORD.',
    );
  }
  const portRaw = env.cjSftpPort;
  const port = portRaw === undefined ? 22 : Number(portRaw);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`CJ_SFTP_PORT must be a valid port number, got "${portRaw}"`);
  }
  return { host, port, username, password };
}

export async function fetchLatestCjFeed(
  options: FetchOptions,
): Promise<{ localPath: string; remoteName: string; importStats: ImportStats | null }> {
  const config = requireSftpConfig();
  fs.mkdirSync(FEED_DIR, { recursive: true });

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const sftp = new Client();
    try {
      await sftp.connect({
        host: config.host,
        port: config.port,
        username: config.username,
        password: config.password,
        readyTimeout: CONNECT_TIMEOUT_MS,
      });

      const listing = await sftp.list(options.remoteDir);
      const latest = pickLatestFeedFile(listing as FeedListing[]);
      if (!latest) {
        throw new Error(
          `No DHGate-shopping-*.zip file found in SFTP directory "${options.remoteDir}". ` +
            'The first daily export may not have run yet (check CJ → Subscriptions → Last Export Date).',
        );
      }

      const remotePath = path.posix.join(options.remoteDir, latest.name);
      const localPath = path.join(FEED_DIR, latest.name);
      // eslint-disable-next-line no-console
      console.log(
        `[fetch-cj-sftp] downloading ${latest.name} (${latest.size} bytes) → ${localPath}`,
      );
      await sftp.fastGet(remotePath, localPath);
      verifyDownloadedSize(localPath, latest.size);
      // eslint-disable-next-line no-console
      console.log(
        `[fetch-cj-sftp] download verified: ${latest.name} (${latest.size} bytes)`,
      );

      let importStats: ImportStats | null = null;
      if (!options.noImport) {
        // eslint-disable-next-line no-console
        console.log(
          '[fetch-cj-sftp] WARNING: running a LIVE import (dryRun: false). ' +
            'For a safe first run use --no-import, then a separate --dry-run import.',
        );
        importStats = await importCjFeed({
          file: localPath,
          network: 'cj',
          advertiserId: '3992613',
          advertiserName: 'DHGate',
          limit: options.limit,
          onlyWithGtin: options.onlyWithGtin,
          dryRun: false,
        });
      }
      return { localPath, remoteName: latest.name, importStats };
    } catch (err) {
      lastError = err;
      if (!isTransientSftpError(err) || attempt === MAX_ATTEMPTS) throw err;
      const delayMs = RETRY_DELAYS_MS[attempt - 1] ?? 4_000;
      // eslint-disable-next-line no-console
      console.log(
        `[fetch-cj-sftp] attempt ${attempt} failed ` +
          `(${err instanceof Error ? err.message : String(err)}), ` +
          `retrying in ${delayMs / 1000}s...`,
      );
      await sleep(delayMs);
    } finally {
      await sftp.end();
    }
  }
  throw lastError;
}

async function main(): Promise<void> {
  let options: FetchOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[fetch-cj-sftp] ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
    return;
  }

  try {
    const result = await fetchLatestCjFeed(options);
    // eslint-disable-next-line no-console
    console.log(
      `[fetch-cj-sftp] DONE downloaded=${result.remoteName} local=${result.localPath} ` +
        `import=${result.importStats ? JSON.stringify(result.importStats) : 'skipped (--no-import)'}`,
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[fetch-cj-sftp] FATAL: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

// Run as a CLI script (not when imported by tests).
if (process.argv[1]?.endsWith('fetch-cj-sftp.ts')) {
  void main();
}
