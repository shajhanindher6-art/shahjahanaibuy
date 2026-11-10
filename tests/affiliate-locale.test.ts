import { describe, expect, it, afterEach } from 'vitest';
import {
  buildGeoAffiliateUrl,
  describeAffiliateCoverage,
  getAmazonTag,
  getConfiguredAmazonLocales,
  getLocaleTagStatus,
} from '@/services/affiliate-geo';

// Locale-override coverage (S3#20). The override mechanism itself
// (AMAZON_ASSOC_TAG_<CC>) predates this batch; these tests pin the
// env-gated behaviour so a US tag can never leak onto a non-US link
// and coverage reporting never claims an unconfigured locale.

const BASE = 'AMAZON_ASSOC_TAG';
const GB = 'AMAZON_ASSOC_TAG_GB';
const DE = 'AMAZON_ASSOC_TAG_DE';

const saved: Record<string, string | undefined> = {
  [BASE]: process.env[BASE],
  [GB]: process.env[GB],
  [DE]: process.env[DE],
};

function setEnv(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

afterEach(() => setEnv(saved));

describe('getAmazonTag locale overrides', () => {
  it('uses the base tag for US visitors only', () => {
    setEnv({ [BASE]: 'smartbuy-20', [GB]: undefined, [DE]: undefined });
    expect(getAmazonTag('US')).toBe('smartbuy-20');
    expect(getAmazonTag('us')).toBe('smartbuy-20');
  });

  it('never stamps the US tag on a non-US visitor without an override', () => {
    setEnv({ [BASE]: 'smartbuy-20', [GB]: undefined, [DE]: undefined });
    expect(getAmazonTag('GB')).toBeNull();
    expect(getAmazonTag('DE')).toBeNull();
    expect(getAmazonTag('JP')).toBeNull();
  });

  it('uses the per-locale override when configured', () => {
    setEnv({ [BASE]: 'smartbuy-20', [GB]: 'smartbuy-gb-21', [DE]: undefined });
    expect(getAmazonTag('GB')).toBe('smartbuy-gb-21');
    expect(getAmazonTag('DE')).toBeNull();
  });

  it('returns null everywhere when nothing is configured', () => {
    setEnv({ [BASE]: undefined, [GB]: undefined, [DE]: undefined });
    expect(getAmazonTag('US')).toBeNull();
    expect(getAmazonTag('GB')).toBeNull();
  });
});

describe('buildGeoAffiliateUrl with locale tags', () => {
  const amazonUk = 'https://www.amazon.co.uk/s?k=laptop';

  it('leaves a UK link untagged when only the US tag is set', () => {
    setEnv({ [BASE]: 'smartbuy-20', [GB]: undefined });
    expect(buildGeoAffiliateUrl(amazonUk, 'GB')).toBe(amazonUk);
  });

  it('tags a UK link with the GB override when set', () => {
    setEnv({ [BASE]: 'smartbuy-20', [GB]: 'smartbuy-gb-21' });
    const tagged = buildGeoAffiliateUrl(amazonUk, 'GB');
    expect(tagged).toContain('tag=smartbuy-gb-21');
    expect(tagged).not.toContain('smartbuy-20');
  });

  it('never tags a lookalike host such as amazon.evil.com', () => {
    setEnv({ [BASE]: 'smartbuy-20', [GB]: 'smartbuy-gb-21' });
    const phishing = 'https://www.amazon.evil.com/s?k=laptop';
    expect(buildGeoAffiliateUrl(phishing, 'GB')).toBe(phishing);
    expect(buildGeoAffiliateUrl(phishing, 'US')).toBe(phishing);
  });

  it('passes a non-Amazon URL through unchanged without Skimlinks', () => {
    setEnv({ [BASE]: 'smartbuy-20', [GB]: undefined });
    const url = 'https://www.bestbuy.com/site/searchpage.jsp?st=laptop';
    expect(buildGeoAffiliateUrl(url, 'GB')).toBe(url);
  });
});

describe('locale coverage reporting', () => {
  it('lists only locales with a tag actually configured', () => {
    setEnv({ [BASE]: 'smartbuy-20', [GB]: 'smartbuy-gb-21', [DE]: undefined });
    expect(getConfiguredAmazonLocales()).toEqual(['US', 'GB']);
    const coverage = describeAffiliateCoverage();
    expect(coverage.enabled).toBe(true);
    expect(coverage.configuredLocales).toEqual(['US', 'GB']);
    expect(coverage.skimlinksConfigured).toBe(false);
  });

  it('reports empty coverage when nothing is configured', () => {
    setEnv({ [BASE]: undefined, [GB]: undefined, [DE]: undefined });
    expect(getConfiguredAmazonLocales()).toEqual([]);
    expect(describeAffiliateCoverage().enabled).toBe(false);
  });

  it('reports base vs override tag sources per country', () => {
    setEnv({ [BASE]: 'smartbuy-20', [GB]: 'smartbuy-gb-21', [DE]: undefined });
    expect(getLocaleTagStatus('US')).toEqual({ country: 'US', tagConfigured: true, source: 'base' });
    expect(getLocaleTagStatus('GB')).toEqual({ country: 'GB', tagConfigured: true, source: 'override' });
    expect(getLocaleTagStatus('DE')).toEqual({ country: 'DE', tagConfigured: false, source: null });
  });
});
