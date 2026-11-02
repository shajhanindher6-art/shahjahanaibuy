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
 * UI language always defaults to English. A PK visitor is *offered*
 * Roman Urdu in the banner; it is never switched automatically.
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
  resolveRegion,
  type Language,
  type Region,
} from '@/lib/region';

const COOKIE_NAME = 'sb-country';
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

function writeCountryChoice(code: string) {
  try {
    document.cookie = `${COOKIE_NAME}=${encodeURIComponent(code)}; path=/; max-age=31536000; SameSite=Lax`;
    localStorage.setItem(LS_COUNTRY, code);
  } catch {
    // Storage unavailable (private mode etc.) — region still applies
    // for this session via React state.
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

export function RegionProvider({ children }: { children: ReactNode }) {
  const [region, setRegion] = useState<Region>(FALLBACK_REGION);
  const [source, setSource] = useState<'saved' | 'detected'>('detected');
  const [language, setLanguageState] = useState<Language>('en');
  const [bannerVisible, setBannerVisible] = useState(false);

  useEffect(() => {
    // UI language: stored choice only, never auto-derived from region.
    const storedLang = readStored<Language>(LS_LANGUAGE, (raw) =>
      raw === 'ur' || raw === 'en' ? raw : null
    );
    if (storedLang) setLanguageState(storedLang);

    // 1–2. Saved choice (cookie from middleware, or localStorage).
    const savedCode = getRegionByCountry(readCookie(COOKIE_NAME))
      ? readCookie(COOKIE_NAME)
      : readStored<string>(LS_COUNTRY, (raw) => raw);
    const savedRegion = getRegionByCountry(savedCode);
    if (savedRegion) {
      setRegion(savedRegion);
      setSource('saved');
      return;
    }

    // 3–5. Detection (async, never blocks render).
    let cancelled = false;
    const applyDetected = (code: string | null, showBanner: boolean) => {
      if (cancelled) return;
      const detected = resolveRegion(code);
      setRegion(detected);
      setSource('detected');
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

  const setCountry = useCallback((code: string) => {
    const next = resolveRegion(code);
    setRegion(next);
    setSource('saved');
    setBannerVisible(false);
    writeCountryChoice(next.code);
  }, []);

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    try {
      localStorage.setItem(LS_LANGUAGE, next);
    } catch {
      // Ignore storage failures; language still applies this session.
    }
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
      source,
      language,
      setCountry,
      setLanguage,
      bannerVisible,
      dismissBanner,
    }),
    [region, source, language, setCountry, setLanguage, bannerVisible, dismissBanner]
  );

  return <RegionContext.Provider value={value}>{children}</RegionContext.Provider>;
}

export function useRegion(): RegionContextValue {
  const ctx = useContext(RegionContext);
  if (!ctx) throw new Error('useRegion must be used within RegionProvider');
  return ctx;
}
