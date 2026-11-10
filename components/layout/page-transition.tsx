'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

/**
 * Page transition (Section 4 item 3, motion guidelines).
 *
 * One transition for the whole site: every route change replays
 * the `animate-fade-in` entrance (400ms, standard easing — see
 * app/globals.css and docs/design-system.md). The key on the
 * wrapper is the pathname, so same-page query changes do not
 * replay the animation.
 *
 * Accessibility: the animation is disabled for visitors who
 * prefer reduced motion — both by the `motion-reduce:animate-none`
 * class here and by the global `prefers-reduced-motion` rule in
 * app/globals.css, which forces all animation durations to ~0ms.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="animate-fade-in motion-reduce:animate-none">
      {children}
    </div>
  );
}
