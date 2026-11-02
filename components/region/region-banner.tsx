'use client';

/**
 * Dismissible region banner, shown once on first geo detection
 * (never for a saved Country Switcher choice, never after dismiss).
 * Example: "You're browsing from Pakistan — prices shown in PKR (≈)".
 * PK visitors also get a one-tap offer for Roman Urdu (never forced:
 * tapping is the only way the language changes).
 */

import { X } from 'lucide-react';
import { bannerText, tFor } from '@/lib/i18n';
import { useRegion } from './region-provider';

export function RegionBanner() {
  const { region, language, setLanguage, bannerVisible, dismissBanner } = useRegion();

  if (!bannerVisible) return null;

  const focusSwitcher = () => {
    // Desktop select first, compact mobile select as fallback.
    const el =
      document.getElementById('sb-country-switcher') ??
      document.getElementById('sb-country-switcher-mobile');
    el?.focus();
    el?.scrollIntoView({ block: 'nearest' });
  };

  return (
    <div className="border-b bg-blue-50 dark:bg-blue-950">
      <div className="container mx-auto flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-2 text-center text-xs sm:text-sm">
        <span className="text-blue-800 dark:text-blue-200">
          {bannerText(language, region.name, region.currency)}
        </span>
        <button
          type="button"
          onClick={focusSwitcher}
          className="font-semibold text-blue-700 underline underline-offset-2 hover:text-blue-900 dark:text-blue-300 dark:hover:text-blue-100"
        >
          {tFor(language, 'bannerChange')}
        </button>
        {region.suggestedLanguage === 'ur' && language === 'en' && (
          <button
            type="button"
            onClick={() => setLanguage('ur')}
            className="font-semibold text-blue-700 underline underline-offset-2 hover:text-blue-900 dark:text-blue-300 dark:hover:text-blue-100"
          >
            {tFor(language, 'bannerOfferUrdu')}
          </button>
        )}
        <button
          type="button"
          onClick={dismissBanner}
          aria-label={tFor(language, 'bannerDismiss')}
          className="ml-1 rounded p-0.5 text-blue-700 hover:bg-blue-100 dark:text-blue-300 dark:hover:bg-blue-900"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
