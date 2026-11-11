/**
 * Animated stat card — AI Glass redesign.
 *
 * The number counts up from 0 to its real value over ~900ms with an
 * ease-out curve. The count-up is presentation only: the value is
 * always the real count from the user's own data, never a demo
 * number. Users with reduced-motion enabled see the final value
 * immediately, with no animation.
 */

'use client';

import { useEffect, useRef, useState, type ComponentType } from 'react';
import Link from 'next/link';

export function useCountUp(target: number, durationMs = 900): number {
  const [value, setValue] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setValue(target);
      return;
    }
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(target * eased));
      if (progress < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [target, durationMs]);

  return value;
}

interface AnimatedStatProps {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: number;
  subtext: string;
  href: string;
}

export function AnimatedStat({ icon: Icon, label, value, subtext, href }: AnimatedStatProps) {
  const display = useCountUp(value);
  return (
    <Link href={href} className="glass-card group block p-4 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl">
      <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600/15 to-violet-600/15 text-blue-600 transition-colors group-hover:from-blue-600 group-hover:to-violet-600 group-hover:text-white dark:text-blue-400">
        <Icon className="h-5 w-5" />
      </div>
      <p className="text-2xl font-bold tabular-nums">{display.toLocaleString()}</p>
      <p className="mt-0.5 text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{subtext}</p>
    </Link>
  );
}
