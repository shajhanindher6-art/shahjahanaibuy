'use client';

/**
 * RegionProvider — visitor region + UI language state.
 *
 * Precedence (highest first):
 *   1. Manual Country Switcher choice (cookie `sb-country` +
 *      localStorage `sb-country`) — always wins over detection.
 *   2. Server detection: middleware sets `sb-country` from the
 *      Vercel geo header (x-vercel-ip-country) ONLY when the
 *      visitor has no saved choice.
 *   3. Client IP lookup: free, no-key https://ipwho.is/ with a
 *      short timeout, cached in localStorage for 24h, never
 *      blocking render (it runs in an effect after first paint).
 *   4. Browser timezone / language guess (see lib/region.ts).
 *   5. US fallback (silent — no banner for the fallback).
 *
 * The region banner appears only on first *detection* (steps 2–4
 * producing a non-US region), never for a saved choice, and once
 * dismissed it stays dismissed (localStorage `sb-banner-dismissed`).
 *
 * `detectedCountryCode` is the visitor's RAW country code: the
 * saved choice when there is one, otherwise the raw code from IP
 * detection or the browser guess — even when that code is OUTSIDE
 * the region registry. `region` still falls back to US for display
 * and currency in that case, but store lookup must use the raw
 * code so a visitor from e.g. Iceland gets the global retailer
 * fallback, not US local stores (see lib/stores.ts).
 *
 * UI language (Option 4 Part 1, auto-detection — this REPLACES
 * the old "never auto-switch" rule, because auto-detection was
 * explicitly requested):
 *   (a) saved choice in localStorage `sb-language` — never
 *       overridden by detection, and always wins;
 *   (b) geo-detected country → language map
 *       (lib/region.ts COUNTRY_LANGUAGE);
 *   (c) browser navigator.language primary subtag, mapped into
 *       the supported set (only when geo yields no country);
 *   (d) English.
 * Detection runs once on load and applies to React state only —
 * it never writes `sb-language`, so a later manual switch (which
 * does persist) is never undone by a later visit's detection.
 * A manual Country Switcher choice never forces a language
 * change: country and language stay independent after first
 * detection. One subtlety: the middleware geo cookie looks like a
 * "saved" country to this provider, but a manual choice writes
 * BOTH the cookie and localStorage `sb-country`, while middleware
 * writes only the cookie — so a cookie WITHOUT a localStorage
 * country entry means server geo detection, and the language map
 * is applied for that visitor too (state only, same as above).
 * On every language change, document.documentElement.lang is set.
 *
 * FIRST-PAINT FLASH (safe fix, 2026-11-03 audit): this provider used
 * to always start at US/English and only resolve the real region in
 * a post-paint effect, so every visitor briefly saw US/English
 * prices and chrome before detection completed. Reading the cookie
 * in a useState initializer is NOT a safe fix for that — the server
 * render would still be US/English and React would report a
 * hydration mismatch. The safe fix is server-resolved initials:
 * RegionProvider accepts optional initialCountryCode /
 * initialLanguage / initialSource props (a server component such as
 * the root layout reads the sb-country / sb-language cookies — and,
 * for a first visit, the Vercel geo header — and passes them down).
 * Because the props travel in the RSC payload, server and client
 * render identically and there is no mismatch and no flash for any
 * visitor the server could already resolve. Until the layout passes
 * those props, behaviour is exactly as before (no regression).
 * A manual language choice also writes an `sb-language` cookie (in
 * addition to localStorage) so the server can resolve it on the
 * next visit; a saved localStorage language still always wins over
 * any cookie/server value in the effect below, and the effect heals
 * a stale language cookie back to the saved choice.
 * The one case no provider-side fix can remove: a brand-new visitor
 * with no cookie at all, whose region is only knowable from the
 * server geo header on that very first response — that needs the
 * layout itself to read the header (see the props above).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  FALLBACK_REGION,
  getRegionByCountry,
  guessCountryFromBrowser,
  isSupportedLanguage,
  isRtlLanguage,
  languageForCountry,
  languageFromBrowserLanguage,
  resolveRegion,
  type Language,
  type Region,
} from '@/lib/region';

const COOKIE_NAME = 'sb-country';
const COOKIE_LANGUAGE = 'sb-language';
const LS_COUNTRY = 'sb-country';
const LS_LANGUAGE = 'sb-language';
const LS_GEO = 'sb-geo';
const LS_BANNER_DISMISSED = 'sb-banner-dismissed';
const GEO_CACHE_MS = 24 * 60 * 60 * 1000;
const IP_TIMEOUT_MS = 2500;

export interface RegionContextValue {
  region: Region;
  /** ISO country code of the active region. */
  countryCode: string;
  /**
   * Raw visitor country code (saved choice, or raw IP/browser
   * detection). May be outside the region registry; null before
   * detection runs. Store lookup uses this, not countryCode.
   */
  detectedCountryCode: string | null;
  /** 'detected' when the region came from detection, 'saved' for a manual choice. */
  source: 'saved' | 'detected';
  language: Language;
  setCountry: (code: string) => void;
  setLanguage: (language: Language) => void;
  bannerVisible: boolean;
  dismissBanner: () => void;
}

const RegionContext = createContext<RegionContextValue | null>(null);

function readCookie(name: string): string | null {
  try {
    const match = document.cookie
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${name}=`));
    return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
  } catch {
    return null;
  }
}

// The middleware sets these cookies with `Secure` in production, but the
// client-side writes below used to drop the flag on every manual switch
// (security fix 2026-11-05). httpOnly stays absent on purpose — the
// region provider reads these cookies client-side.
function secureFlag(): string {
  return typeof window !== 'undefined' && window.location.protocol === 'https:' ? '; Secure' : '';
}

function writeCountryChoice(code: string) {
  try {
    document.cookie = `${COOKIE_NAME}=${encodeURIComponent(code)}; path=/; max-age=31536000; SameSite=Lax${secureFlag()}`;
    localStorage.setItem(LS_COUNTRY, code);
  } catch {
    // Storage unavailable (private mode etc.) — region still applies
    // for this session via React state.
  }
}

/**
 * Persist a manual language choice in BOTH the cookie (so the
 * server can resolve it on the next visit's first paint) and
 * localStorage (the authority the effect below trusts).
 */
function writeLanguageChoice(next: Language) {
  try {
    document.cookie = `${COOKIE_LANGUAGE}=${encodeURIComponent(next)}; path=/; max-age=31536000; SameSite=Lax${secureFlag()}`;
    localStorage.setItem(LS_LANGUAGE, next);
  } catch {
    // Storage unavailable — language still applies this session
    // via React state.
  }
}

function readStored<T>(key: string, parse: (raw: string) => T | null): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return parse(raw);
  } catch {
    return null;
  }
}

export interface RegionProviderProps {
  children: ReactNode;
  /**
   * Server-resolved initial country code (from the sb-country
   * cookie, or the geo header on a first visit). Raw codes outside
   * the registry are kept as detectedCountryCode with a US display
   * region, exactly like client detection. Null = unresolved: the
   * provider falls back to its existing client detection.
   */
  initialCountryCode?: string | null;
  /** Server-resolved initial UI language (from sb-language cookie). */
  initialLanguage?: Language | null;
  /**
   * How initialCountryCode was resolved: 'saved' for a cookie,
   * 'detected' for a geo header (banner may show for the latter).
   * Defaults to 'saved' when an initial country code is given.
   */
  initialSource?: 'saved' | 'detected';
}

export function RegionProvider({
  children,
  initialCountryCode = null,
  initialLanguage = null,
  initialSource,
}: RegionProviderProps) {
  // Server-resolved initials are pure (props only, no document
  // access), so server and client first renders match exactly.
  const serverRegion = getRegionByCountry(initialCountryCode) ?? FALLBACK_REGION;
  const [region, setRegion] = useState<Region>(serverRegion);
  const [detectedCountryCode, setDetectedCountryCode] = useState<string | null>(
    initialCountryCode ? initialCountryCode.toUpperCase() : null
  );
  const [source, setSource] = useState<'saved' | 'detected'>(
    initialSource ?? (initialCountryCode ? 'saved' : 'detected')
  );
  const [language, setLanguageState] = useState<Language>(
    initialLanguage && isSupportedLanguage(initialLanguage) ? initialLanguage : 'en'
  );
  const [bannerVisible, setBannerVisible] = useState(false);

  useEffect(() => {
    // UI language precedence (Option 4 Part 1):
    // (a) saved choice wins and is never overridden by detection.
    const storedLang = readStored<Language>(LS_LANGUAGE, (raw) =>
      isSupportedLanguage(raw) ? raw : null
    );
    if (storedLang) {
      setLanguageState(storedLang);
      // Heal a stale/missing language cookie (e.g. a choice saved
      // before the cookie existed, or a geo cookie middleware set)
      // so the server resolves correctly on the next visit.
      if (readCookie(COOKIE_LANGUAGE) !== storedLang) writeLanguageChoice(storedLang);
    }

    // Server-resolved first paint: region/language are already
    // correct, so skip client detection entirely (it could only
    // flash the page back to a different value). The banner is
    // additive UI, so it is still decided here from localStorage
    // (dismissed state is client-only and cannot come from props).
    if (initialCountryCode) {
      if ((initialSource ?? 'saved') === 'detected') {
        const dismissed = readStored<boolean>(LS_BANNER_DISMISSED, (raw) => raw === '1');
        if (serverRegion.code !== 'US' && !dismissed) setBannerVisible(true);
      }
      return;
    }

    // 1–2. Saved choice (cookie from middleware, or localStorage).
    const savedCode = getRegionByCountry(readCookie(COOKIE_NAME))
      ? readCookie(COOKIE_NAME)
      : readStored<string>(LS_COUNTRY, (raw) => raw);
    const savedRegion = getRegionByCountry(savedCode);
    if (savedRegion) {
      setRegion(savedRegion);
      setSource('saved');
      setDetectedCountryCode(savedRegion.code);
      // Cookie WITHOUT a localStorage country entry means the
      // country came from the middleware geo cookie, not a manual
      // choice: apply the geo language map (state only) unless
      // the visitor already has a saved language choice.
      const manualCountry = readStored<string>(LS_COUNTRY, (raw) => raw);
      if (!storedLang && !manualCountry && !initialLanguage) {
        setLanguageState(languageForCountry(savedRegion.code));
      }
      return;
    }

    // 3–5. Detection (async, never blocks render).
    let cancelled = false;
    const applyDetected = (code: string | null, showBanner: boolean) => {
      if (cancelled) return;
      const detected = resolveRegion(code);
      setRegion(detected);
      setSource('detected');
      // Raw code, even when outside the registry (resolveRegion
      // above still falls back to US for display/currency).
      setDetectedCountryCode(code ? code.toUpperCase() : null);
      // (b) geo country → language map; (c) browser language only
      // when geo yields no country at all; (d) English. Skipped
      // entirely when a saved language choice exists (step (a)),
      // or when the server already resolved a language (prop).
      if (!storedLang && !initialLanguage) {
        const detectedLang = code
          ? languageForCountry(code)
          : (languageFromBrowserLanguage(
              typeof navigator !== 'undefined' ? navigator.language : null
            ) ?? 'en');
        setLanguageState(detectedLang);
      }
      const dismissed = readStored<boolean>(LS_BANNER_DISMISSED, (raw) => raw === '1');
      // Banner only for a real non-US detection, and only if never dismissed.
      if (showBanner && detected.code !== 'US' && !dismissed) {
        setBannerVisible(true);
      }
    };

    const detect = async () => {
      // Cached IP result (24h) avoids a lookup on every visit.
      const cached = readStored<string>(LS_GEO, (raw) => {
        try {
          const parsed = JSON.parse(raw) as { country?: unknown; ts?: unknown };
          if (
            typeof parsed.country === 'string' &&
            typeof parsed.ts === 'number' &&
            Date.now() - parsed.ts < GEO_CACHE_MS
          ) {
            return parsed.country;
          }
        } catch {
          return null;
        }
        return null;
      });
      if (cached) {
        applyDetected(cached, true);
        return;
      }

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), IP_TIMEOUT_MS);
        const response = await fetch('https://ipwho.is/', { signal: controller.signal });
        clearTimeout(timer);
        if (!response.ok) throw new Error(`ipwho.is HTTP ${response.status}`);
        const data = (await response.json()) as { country_code?: unknown; success?: unknown };
        const code = typeof data.country_code === 'string' ? data.country_code : null;
        if (code) {
          try {
            localStorage.setItem(LS_GEO, JSON.stringify({ country: code, ts: Date.now() }));
          } catch {
            // Ignore cache write failures.
          }
        }
        applyDetected(code, true);
      } catch {
        // IP lookup failed (offline, blocked, timeout): fall back to
        // the browser timezone / language guess, then US.
        applyDetected(guessCountryFromBrowser(), true);
      }
    };

    void detect();
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep <html lang> and <html dir> in sync with the UI language
  // (accessibility + correct rendering of localized chrome strings,
  // incl. RTL for Arabic — applied live on switch, not just on the
  // next page load).
  useEffect(() => {
    try {
      document.documentElement.lang = language;
      document.documentElement.dir = isRtlLanguage(language) ? 'rtl' : 'ltr';
    } catch {
      // Non-DOM environment — ignore.
    }
  }, [language]);

  const setCountry = useCallback((code: string) => {
    const next = resolveRegion(code);
    setRegion(next);
    setSource('saved');
    setDetectedCountryCode(next.code);
    setBannerVisible(false);
    writeCountryChoice(next.code);
  }, []);

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    // Cookie + localStorage together, so the server can resolve
    // this choice on the next visit's first paint (see header note).
    writeLanguageChoice(next);
  }, []);

  const dismissBanner = useCallback(() => {
    setBannerVisible(false);
    try {
      localStorage.setItem(LS_BANNER_DISMISSED, '1');
    } catch {
      // Ignore storage failures.
    }
  }, []);

  const value = useMemo<RegionContextValue>(
    () => ({
      region,
      countryCode: region.code,
      detectedCountryCode,
      source,
      language,
      setCountry,
      setLanguage,
      bannerVisible,
      dismissBanner,
    }),
    [region, detectedCountryCode, source, language, setCountry, setLanguage, bannerVisible, dismissBanner]
  );

  return <RegionContext.Provider value={value}>{children}</RegionContext.Provider>;
}

export function useRegion(): RegionContextValue {
  const ctx = useContext(RegionContext);
  if (!ctx) throw new Error('useRegion must be used within RegionProvider');
  return ctx;
}
