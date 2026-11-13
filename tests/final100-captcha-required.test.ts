/**
 * Final 100%, F-P1-63 — captcha requirement flag (REQUIRE_CAPTCHA).
 *
 * The flag is config-driven and defaults OFF:
 * - unset / "false" / anything else → not required (old behaviour:
 *   captcha enforces only when Turnstile is configured; the 5/min/IP
 *   rate limit is the backstop).
 * - "true" / "1" → required. When required AND Turnstile is
 *   unconfigured, sign-in/sign-up must fail CLOSED with 503
 *   (CAPTCHA_REQUIRED_NOT_CONFIGURED_MESSAGE), never silently pass.
 *
 * Both auth routes pin the fail-closed branch in source (grep test
 * below) so a future edit cannot quietly drop it.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import {
  isCaptchaConfigured,
  isCaptchaRequired,
  CAPTCHA_REQUIRED_NOT_CONFIGURED_MESSAGE,
} from '@/lib/auth/captcha';

describe('REQUIRE_CAPTCHA flag (Final 100% F-P1-63)', () => {
  const savedFlag = process.env.REQUIRE_CAPTCHA;
  const savedSite = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const savedSecret = process.env.TURNSTILE_SECRET_KEY;

  beforeEach(() => {
    delete process.env.REQUIRE_CAPTCHA;
    delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    delete process.env.TURNSTILE_SECRET_KEY;
  });

  afterEach(() => {
    if (savedFlag !== undefined) process.env.REQUIRE_CAPTCHA = savedFlag;
    else delete process.env.REQUIRE_CAPTCHA;
    if (savedSite !== undefined) process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = savedSite;
    else delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    if (savedSecret !== undefined) process.env.TURNSTILE_SECRET_KEY = savedSecret;
    else delete process.env.TURNSTILE_SECRET_KEY;
  });

  it('defaults OFF when unset', () => {
    expect(isCaptchaRequired()).toBe(false);
  });

  it('is OFF for "false" / "0" / junk values', () => {
    for (const v of ['false', '0', 'no', 'yes', '']) {
      process.env.REQUIRE_CAPTCHA = v;
      expect(isCaptchaRequired()).toBe(false);
    }
  });

  it('is ON for "true" and "1" (case-insensitive, trimmed)', () => {
    for (const v of ['true', 'TRUE', '  true  ', '1']) {
      process.env.REQUIRE_CAPTCHA = v;
      expect(isCaptchaRequired()).toBe(true);
    }
  });

  it('configured is false when either Turnstile key is missing', () => {
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = 'site-key';
    expect(isCaptchaConfigured()).toBe(false);
    process.env.TURNSTILE_SECRET_KEY = 'secret-key';
    expect(isCaptchaConfigured()).toBe(true);
  });

  it('the fail-closed message names the missing keys', () => {
    expect(CAPTCHA_REQUIRED_NOT_CONFIGURED_MESSAGE).toContain('TURNSTILE_SECRET_KEY');
    expect(CAPTCHA_REQUIRED_NOT_CONFIGURED_MESSAGE).toContain('NEXT_PUBLIC_TURNSTILE_SITE_KEY');
  });

  it('both auth routes contain the fail-closed branch (source pin)', () => {
    for (const route of ['app/api/v1/auth/sign-in/route.ts', 'app/api/v1/auth/sign-up/route.ts']) {
      const src = fs.readFileSync(`${process.cwd()}/${route}`, 'utf8');
      expect(src).toContain('isCaptchaRequired() && !isCaptchaConfigured()');
      expect(src).toContain('serviceUnavailable(CAPTCHA_REQUIRED_NOT_CONFIGURED_MESSAGE)');
    }
  });

  it('REQUIRE_CAPTCHA is documented in .env.example, defaulting off', () => {
    const example = fs.readFileSync(`${process.cwd()}/.env.example`, 'utf8');
    expect(example).toContain('REQUIRE_CAPTCHA=false');
    expect(example).toContain('TURNSTILE_SECRET_KEY');
  });
});
