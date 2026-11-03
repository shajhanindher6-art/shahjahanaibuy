'use client';

/**
 * Country Switcher + Language Switcher for the site header.
 *
 * - Native <select> elements (reliable on every device, no extra
 *   dependency, native mobile picker). Two bound selects share one
 *   value: a compact code + currency select on small screens
 *   ("PK PKR") and a full "Pakistan (PKR)" select on sm+ screens, so
 *   the crowded mobile header never breaks. Currency alone would
 *   be ambiguous now that 60 regions share a handful of currencies
 *   (many EUR entries), so the compact option carries the code.
 * - A manual choice writes cookie + localStorage and always wins
 *   over geo detection (see RegionProvider).
 * - The Language Switcher next to it (Option 4 Part 1) lists all
 *   8 supported languages by native name: a compact 2-letter code
 *   select on small screens and the full native name on sm+
 *   screens, so the mobile header never overflows. Switching
 *   persists to localStorage `sb-language` and never forces a
 *   country change; country and language stay independent.
 */

import { Globe } from 'lucide-react';
import { LANGUAGES, REGIONS, type Language } from '@/lib/region';
import { useRegion } from './region-provider';
import { cn } from '@/lib/utils';

const selectClass =
  'h-8 rounded-md border border-input bg-background text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function CountrySwitcher() {
  const { region, setCountry } = useRegion();

  const onChange = (code: string) => {
    setCountry(code);
  };

  return (
    <div className="flex shrink-0 items-center gap-1" role="group" aria-label="Country">
      <Globe className="hidden h-4 w-4 shrink-0 text-muted-foreground sm:block" aria-hidden />
      {/* Compact: country code + currency on small screens. */}
      <select
        id="sb-country-switcher-mobile"
        aria-label="Country"
        value={region.code}
        onChange={(e) => onChange(e.target.value)}
        className={cn(selectClass, 'w-16 px-1 sm:hidden')}
      >
        {REGIONS.map((r) => (
          <option key={r.code} value={r.code}>
            {r.code} {r.currency}
          </option>
        ))}
      </select>
      {/* Full: country name + currency on sm+ screens. */}
      <select
        id="sb-country-switcher"
        aria-label="Country"
        value={region.code}
        onChange={(e) => onChange(e.target.value)}
        className={cn(selectClass, 'hidden w-auto px-2 sm:block')}
      >
        {REGIONS.map((r) => (
          <option key={r.code} value={r.code}>
            {r.name} ({r.currency})
          </option>
        ))}
      </select>
    </div>
  );
}

export function LanguageSwitcher() {
  const { language, setLanguage } = useRegion();

  const onChange = (code: string) => {
    setLanguage(code as Language);
  };

  return (
    <div className="flex shrink-0 items-center" role="group" aria-label="Language">
      {/* Compact: 2-letter code on small screens. */}
      <select
        id="sb-language-switcher-mobile"
        aria-label="Language"
        value={language}
        onChange={(e) => onChange(e.target.value)}
        className={cn(selectClass, 'w-14 px-1 sm:hidden')}
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.code.toUpperCase()}
          </option>
        ))}
      </select>
      {/* Full: native language name on sm+ screens. */}
      <select
        id="sb-language-switcher"
        aria-label="Language"
        value={language}
        onChange={(e) => onChange(e.target.value)}
        className={cn(selectClass, 'hidden w-auto px-2 sm:block')}
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.nativeName}
          </option>
        ))}
      </select>
    </div>
  );
}
