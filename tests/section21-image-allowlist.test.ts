/**
 * Sections 21–25, Stage K (K6) — image host allowlist tests.
 *
 * The allowlist is fail-closed by design: until the owner supplies
 * hosts (IMAGE_ALLOWED_HOSTS), the list is empty and EVERYTHING is
 * rejected — including perfectly valid public https URLs. These
 * tests pin that: an empty list rejects all, an unlisted host
 * rejects, only an exactly-listed host passes, and subdomains do
 * not inherit a listing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAllowedImageHosts, isAllowedImageHost } from '@/lib/image-allowlist';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getAllowedImageHosts', () => {
  it('returns [] when IMAGE_ALLOWED_HOSTS is unset', () => {
    vi.stubEnv('IMAGE_ALLOWED_HOSTS', '');
    expect(getAllowedImageHosts()).toEqual([]);
    delete process.env.IMAGE_ALLOWED_HOSTS;
    expect(getAllowedImageHosts()).toEqual([]);
  });

  it('parses comma-separated hosts, trimming, lower-casing, deduping', () => {
    vi.stubEnv('IMAGE_ALLOWED_HOSTS', ' CDN.Example.com , images.merchant.com,cdn.example.com ');
    expect(getAllowedImageHosts()).toEqual(['cdn.example.com', 'images.merchant.com']);
  });
});

describe('isAllowedImageHost — fail-closed (K6)', () => {
  it('an empty list rejects everything, even a valid public https URL', () => {
    expect(isAllowedImageHost('https://cdn.example.com/a.jpg', [])).toBe(false);
    expect(isAllowedImageHost('https://8.8.8.8/a.jpg', [])).toBe(false);
    expect(isAllowedImageHost('https://example.com/a.jpg')).toBe(false);
  });

  it('an unlisted host is rejected', () => {
    const allowed = ['cdn.example.com'];
    expect(isAllowedImageHost('https://evil.example.com/a.jpg', allowed)).toBe(false);
    expect(isAllowedImageHost('https://other.com/a.jpg', allowed)).toBe(false);
    expect(isAllowedImageHost('https://cdn.example.com.evil.com/a.jpg', allowed)).toBe(false);
  });

  it('a listed host is allowed — exact match, case- and port-insensitive', () => {
    const allowed = ['cdn.example.com'];
    expect(isAllowedImageHost('https://cdn.example.com/a.jpg', allowed)).toBe(true);
    expect(isAllowedImageHost('https://CDN.EXAMPLE.COM/a.jpg', allowed)).toBe(true);
    expect(isAllowedImageHost('https://cdn.example.com:8443/a.jpg', allowed)).toBe(true);
    expect(isAllowedImageHost('http://cdn.example.com/a.jpg', allowed)).toBe(true);
  });

  it('a subdomain of a listed host is NOT allowed', () => {
    const allowed = ['example.com'];
    expect(isAllowedImageHost('https://cdn.example.com/a.jpg', allowed)).toBe(false);
    expect(isAllowedImageHost('https://example.com/a.jpg', allowed)).toBe(true);
  });

  it('non-URLs and empty values are rejected', () => {
    const allowed = ['cdn.example.com'];
    expect(isAllowedImageHost('data:image/png;base64,abc', allowed)).toBe(false);
    expect(isAllowedImageHost('not a url', allowed)).toBe(false);
    expect(isAllowedImageHost('', allowed)).toBe(false);
    expect(isAllowedImageHost(null, allowed)).toBe(false);
    expect(isAllowedImageHost(undefined, allowed)).toBe(false);
  });

  it('reads the env list when no list is passed', () => {
    vi.stubEnv('IMAGE_ALLOWED_HOSTS', 'cdn.example.com');
    expect(isAllowedImageHost('https://cdn.example.com/a.jpg')).toBe(true);
    expect(isAllowedImageHost('https://other.com/a.jpg')).toBe(false);
  });
});
