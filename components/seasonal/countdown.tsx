'use client';

import { useEffect, useState } from 'react';

function partsUntil(targetIso: string, nowMs: number): {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  passed: boolean;
} {
  const diff = new Date(targetIso).getTime() - nowMs;
  if (diff <= 0) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, passed: true };
  }
  const totalSeconds = Math.floor(diff / 1000);
  return {
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
    passed: false,
  };
}

/**
 * Countdown to a seasonal event. Client-side only: the target date is
 * a fixed calendar fact passed in as a prop, and the ticking display
 * updates once a second. Renders a stable server-safe initial state
 * (all zeros) until the first client tick.
 */
export function EventCountdown({ targetIso, label }: { targetIso: string; label: string }) {
  const [nowMs, setNowMs] = useState<number | null>(null);

  useEffect(() => {
    setNowMs(Date.now());
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const parts = partsUntil(targetIso, nowMs ?? new Date(targetIso).getTime());

  if (parts.passed) {
    return (
      <p className="mt-2 text-muted-foreground">
        {label} has started — check the deals below and the product pages for the latest
        recorded prices.
      </p>
    );
  }

  const cells: Array<[number, string]> = [
    [parts.days, 'days'],
    [parts.hours, 'hours'],
    [parts.minutes, 'minutes'],
    [parts.seconds, 'seconds'],
  ];

  return (
    <div className="mt-4" role="timer" aria-label={`Countdown to ${label}`}>
      <div className="flex gap-3">
        {cells.map(([value, unit]) => (
          <div key={unit} className="rounded-lg bg-muted px-4 py-3 text-center">
            <div className="text-2xl font-bold tabular-nums">{String(value).padStart(2, '0')}</div>
            <div className="text-xs text-muted-foreground">{unit}</div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        {label} starts{' '}
        {new Date(targetIso).toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })}
        .
      </p>
    </div>
  );
}
