'use client';

/**
 * Country Switcher + language toggle for the site header.
 *
 * - Native <select> elements (reliable on every device, no extra
 *   dependency, native mobile picker). Two bound selects share one
 *   value: a compact currency-code-only select on small screens
 *   ("PKR") and a full "Pakistan (PKR)" select on sm+ screens, so
 *   the crowded mobile header never breaks.
 * - A manual choice writes cookie + localStorage and always wins
 *   over geo detection (see RegionProvider).
 * - The language toggle next to it flips English ↔ Roman Urdu.
 *   Language always defaults to English; nothing auto-switches it.
 */

import { Globe } from 'lucide-react';
import { REGIONS } from '@/lib/region';
import { tFor } from '@/lib/i18n';
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
      {/* Compact: currency code only on small screens. */}
      <select
        id="sb-country-switcher-mobile"
        aria-label="Country"
        value={region.code}
        onChange={(e) => onChange(e.target.value)}
        className={cn(selectClass, 'w-16 px-1 sm:hidden')}
      >
        {REGIONS.map((r) => (
          <option key={r.code} value={r.code}>
            {r.currency}
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

export function LanguageToggle() {
  const { language, setLanguage } = useRegion();
  const next = language === 'en' ? 'ur' : 'en';
  return (
    <button
      type="button"
      onClick={() => setLanguage(next)}
      title={
        language === 'en'
          ? tFor('en', 'languageRomanUrdu')
          : tFor('ur', 'languageEnglish')
      }
      aria-label={
        language === 'en' ? 'Switch to Roman Urdu' : 'Switch to English'
      }
      className="flex h-8 shrink-0 items-center rounded-md border border-input bg-background px-2 text-xs font-bold hover:bg-accent"
    >
      {language === 'en' ? 'UR' : 'EN'}
    </button>
  );
}
