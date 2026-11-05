'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import type { ReactNode } from 'react';

export function ThemeProvider({
  children,
  nonce,
}: {
  children: ReactNode;
  /**
   * Per-request CSP nonce. next-themes renders an inline theme
   * script (prevents a dark/light flash before hydration); without
   * this nonce the strict script-src policy would block it.
   */
  nonce?: string | null;
}) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      nonce={nonce ?? undefined}
    >
      {children}
    </NextThemesProvider>
  );
}
