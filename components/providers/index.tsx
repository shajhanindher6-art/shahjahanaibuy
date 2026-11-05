'use client';

import { AuthProvider } from '@/features/auth/auth-provider';
import { ThemeProvider } from './theme-provider';
import { RegionProvider } from '@/components/region/region-provider';
import { NonceProvider } from '@/components/csp-nonce-context';
import type { Language } from '@/lib/region';

/**
 * Pass-through for RegionProvider's server-resolved initials (see
 * components/region/region-provider.tsx, "FIRST-PAINT FLASH").
 * The root layout — a server component — may pass
 * initialCountryCode / initialLanguage / initialSource here from
 * the sb-country / sb-language cookies (or the geo header on a
 * first visit); with them, the first paint already shows the right
 * region and language instead of flashing US/English. All three
 * are optional: without them the provider behaves exactly as
 * before (client detection after first paint).
 */
export interface ProvidersProps {
  children: React.ReactNode;
  initialCountryCode?: string | null;
  initialLanguage?: Language | null;
  initialSource?: 'saved' | 'detected';
  /**
   * Per-request CSP nonce from the root layout (middleware sets the
   * x-nonce request header). Threaded through NonceProvider so
   * client components can put it on their <script> tags (the
   * product page's JSON-LD). Optional: without it, useNonce()
   * returns null and script tags render without a nonce.
   */
  nonce?: string | null;
}

export function Providers({
  children,
  initialCountryCode,
  initialLanguage,
  initialSource,
  nonce,
}: ProvidersProps) {
  return (
    <ThemeProvider nonce={nonce}>
      <AuthProvider>
        <RegionProvider
          initialCountryCode={initialCountryCode}
          initialLanguage={initialLanguage}
          initialSource={initialSource}
        >
          <NonceProvider nonce={nonce ?? null}>{children}</NonceProvider>
        </RegionProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
