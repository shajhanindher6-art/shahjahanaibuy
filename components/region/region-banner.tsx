'use client';

/**
 * Dismissible region banner, shown once on first geo detection
 * (never for a saved Country Switcher choice, never after dismiss).
 * Example: "You're browsing from Pakistan — prices shown in PKR (≈)".
 *
 * Language offer (Option 4 Part 1): when the detected region's
 * language differs from the current UI language — e.g. a visitor
 * with a saved English choice browsing from Germany — the banner
 * offers a one-tap switch to the DETECTED language, shown by its
 * native name (e.g. "Deutsch"). It never forces a switch, and it
 * never shows a Roman-Urdu-only button inside another language's
 * UI: on a first visit the detected language is already applied
 * by auto-detection, so the offer simply does not appear then.
 * (The old `bannerOfferUrdu` dictionary key is retained for
 * 28-key parity but is no longer rendered here.)
 */

import { X } from 'lucide-react';
import { bannerText, tFor } from '@/lib/i18n';
import { languageMeta } from '@/lib/region';
import { useRegion } from './region-provider';
import { Button } from '@/components/ui/button';

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

  // Offer the detected language only when it differs from the
  // current UI language (e.g. saved English + detected Germany).
  const offerLanguage =
    region.suggestedLanguage !== language ? region.suggestedLanguage : null;

  return (
    <div className="border-b bg-blue-50 dark:bg-blue-950">
      <div className="container mx-auto flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-2 text-center text-xs sm:text-sm">
        <span className="text-blue-800 dark:text-blue-200">
          {bannerText(language, region.name, region.currency)}
        </span>
        <Button
          type="button"
          variant="link"
          onClick={focusSwitcher}
          className="h-auto p-0 font-semibold text-blue-700 underline-offset-2 hover:text-blue-900 dark:text-blue-300 dark:hover:text-blue-100"
        >
          {tFor(language, 'bannerChange')}
        </Button>
        {offerLanguage && (
          <Button
            type="button"
            variant="link"
            onClick={() => setLanguage(offerLanguage)}
            aria-label={`Switch language to ${languageMeta(offerLanguage).nativeName}`}
            className="h-auto p-0 font-semibold text-blue-700 underline-offset-2 hover:text-blue-900 dark:text-blue-300 dark:hover:text-blue-100"
          >
            {languageMeta(offerLanguage).nativeName}
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={dismissBanner}
          aria-label={tFor(language, 'bannerDismiss')}
          className="ml-1 h-8 w-8 rounded p-0.5 text-blue-700 hover:bg-blue-100 hover:text-blue-700 dark:text-blue-300 dark:hover:bg-blue-900 dark:hover:text-blue-300"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
