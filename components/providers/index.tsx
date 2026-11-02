'use client';

import { AuthProvider } from '@/features/auth/auth-provider';
import { ThemeProvider } from './theme-provider';
import { RegionProvider } from '@/components/region/region-provider';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <AuthProvider>
        <RegionProvider>{children}</RegionProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
