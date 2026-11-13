/**
 * Sections 21–25, Stage B (B10) — provider config validation at startup.
 *
 * Before this, only `EBAY_MARKETPLACE_ID` had any format check
 * (a regex in services/ebay-browse.ts). A bad provider config
 * was discovered at first use — or never, when the failure was
 * silent. This module validates every provider's configuration
 * in one place and names the bad/missing value.
 *
 * FAIL-FAST, WITHOUT CRASHING THE APP: no provider is critical
 * (the catalog serves recorded data with zero providers), so a
 * bad provider config NEVER throws at startup. Each issue is
 * returned with a severity and logged once by
 * `logProviderConfigIssues()` — the provider is warned about and
 * marked NOT_CONFIGURED by the registry's own `isAvailable()`
 * checks. "Fail-fast" here means the problem is surfaced at boot
 * with the exact env var named, not discovered mid-refresh.
 *
 * Deliberately NOT in lib/config/env.ts (another worker owns the
 * env split — do not centralize keys here; this module reads
 * process.env directly, like services/ai-engine/providers.ts,
 * so it stays testable via vi.stubEnv).
 */

import { logger } from '@/lib/config/logger';
import { APIFY_NOT_CONFIGURED_REASON } from '@/services/providers/apify-provider';

export type ProviderConfigIssueSeverity = 'error' | 'warning';

export interface ProviderConfigIssue {
  providerKey: string;
  severity: ProviderConfigIssueSeverity;
  /** The env var at fault, or null when the issue is structural (no client exists yet). */
  envVar: string | null;
  /** Plain-language issue, naming the bad/missing config (never a secret value). */
  message: string;
}

const EBAY_MARKETPLACE_ID_PATTERN = /^EBAY_[A-Z]{2}$/;

function envNonEmpty(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

export function validateProviderConfig(
  env: NodeJS.ProcessEnv = process.env
): ProviderConfigIssue[] {
  const issues: ProviderConfigIssue[] = [];

  // eBay: half a credential pair is a config error, not a silent not-configured.
  const ebayId = envNonEmpty(env, 'EBAY_CLIENT_ID');
  const ebaySecret = envNonEmpty(env, 'EBAY_CLIENT_SECRET');
  if (ebayId && !ebaySecret) {
    issues.push({
      providerKey: 'ebay',
      severity: 'error',
      envVar: 'EBAY_CLIENT_SECRET',
      message:
        'EBAY_CLIENT_ID is set but EBAY_CLIENT_SECRET is missing — eBay stays NOT_CONFIGURED until both are set.',
    });
  }
  if (ebaySecret && !ebayId) {
    issues.push({
      providerKey: 'ebay',
      severity: 'error',
      envVar: 'EBAY_CLIENT_ID',
      message:
        'EBAY_CLIENT_SECRET is set but EBAY_CLIENT_ID is missing — eBay stays NOT_CONFIGURED until both are set.',
    });
  }
  // eBay: the one regex check that existed (ebay-browse.ts) is
  // re-checked here so a bad value is named at startup instead of
  // silently falling back to the default marketplace.
  const marketplaceId = envNonEmpty(env, 'EBAY_MARKETPLACE_ID');
  if (marketplaceId && !EBAY_MARKETPLACE_ID_PATTERN.test(marketplaceId)) {
    issues.push({
      providerKey: 'ebay',
      severity: 'error',
      envVar: 'EBAY_MARKETPLACE_ID',
      message:
        'EBAY_MARKETPLACE_ID is set but is not a valid marketplace id (expected EBAY_<2-letter country code>, e.g. EBAY_US) — the eBay client falls back to the US default instead.',
    });
  }

  // Amazon: a set key is not a live integration — no Creators API
  // client exists yet. Say so at boot, not at first search.
  if (envNonEmpty(env, 'AMAZON_CREATORS_API_KEY')) {
    issues.push({
      providerKey: 'amazon',
      severity: 'warning',
      envVar: 'AMAZON_CREATORS_API_KEY',
      message:
        'AMAZON_CREATORS_API_KEY is set but no Creators API client exists yet — Amazon stays NOT_CONFIGURED (affiliate tag only) until the client is built.',
    });
  }

  // Best Buy: the client exists now (services/providers/
  // bestbuy-provider.ts), so a set key is no longer a warning —
  // the provider is available and fetches. A missing key is the
  // normal off-state (same as eBay / Amazon / CSV: no issue);
  // the missing-key reason still lives in
  // BestBuyProvider.getNotConfiguredReason().

  // CSV: a configured URL must be a usable http(s) URL.
  const csvUrl = envNonEmpty(env, 'CSV_SOURCE_URL');
  if (csvUrl) {
    let parsed: URL | null = null;
    try {
      parsed = new URL(csvUrl);
    } catch {
      parsed = null;
    }
    if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
      issues.push({
        providerKey: 'csv',
        severity: 'error',
        envVar: 'CSV_SOURCE_URL',
        message:
          'CSV_SOURCE_URL is set but is not a valid http(s) URL — CSV stays NOT_CONFIGURED until it points at a public CSV feed.',
      });
    }
  }

  // Apify: banned, full stop. Set vars are a config error — the
  // vars must stay unset (standing no-scraping rule).
  if (envNonEmpty(env, 'APIFY_API_TOKEN') || envNonEmpty(env, 'APIFY_ACTOR_ID')) {
    issues.push({
      providerKey: 'apify',
      severity: 'error',
      envVar: 'APIFY_API_TOKEN',
      message: `${APIFY_NOT_CONFIGURED_REASON} Unset APIFY_API_TOKEN and APIFY_ACTOR_ID.`,
    });
  }

  return issues;
}

/**
 * Validate once and log every issue (warn for warnings, error
 * for errors). Returns the issues. Never throws, never crashes
 * startup — every provider is non-critical.
 */
export function logProviderConfigIssues(env: NodeJS.ProcessEnv = process.env): ProviderConfigIssue[] {
  const issues = validateProviderConfig(env);
  for (const issue of issues) {
    if (issue.severity === 'error') {
      logger.error('provider-config: invalid provider configuration', {
        provider: issue.providerKey,
        envVar: issue.envVar,
        message: issue.message,
      });
    } else {
      logger.warn('provider-config: provider not fully configured', {
        provider: issue.providerKey,
        envVar: issue.envVar,
        message: issue.message,
      });
    }
  }
  return issues;
}
