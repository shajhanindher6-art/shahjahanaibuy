'use client';

import { poolMilestones, POOL_NO_GUARANTEE_NOTE } from '@/services/smartpool';

/**
 * Volume-tier MILESTONES display (Option 11, Phase 3).
 * Shows group-size milestones (5 / 10 / 20 members, plus the pool's
 * own threshold) as progress toward a bigger group, from the pool's
 * REAL member count only — never invented members.
 *
 * HONESTY (standing rule, enforced on every render): milestone sizes
 * are illustrative group targets, NOT discount offers. No milestone
 * is ever worded as a discount promise — SmartBuy has no retailer
 * partnership, so no size "unlocks" any % off. The no-guarantee note
 * below is always visible.
 */
export function PoolMilestones({
  memberCount,
  threshold,
}: {
  memberCount: number;
  threshold: number;
}) {
  const { milestones, largestTarget, percent, next } = poolMilestones(memberCount, threshold);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="font-medium">Group-size milestones</span>
        <span className="text-muted-foreground">
          {memberCount} of {largestTarget} members toward the largest target ({percent}%)
        </span>
      </div>
      <div
        className="relative h-2 overflow-visible rounded bg-muted"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Pool milestones progress: ${memberCount} of ${largestTarget} members`}
      >
        <div className="h-full rounded bg-primary" style={{ width: `${percent}%` }} />
        {milestones.map((m) => (
          <span
            key={m.size}
            className={`absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 ${
              m.reached ? 'border-primary bg-primary' : 'border-muted-foreground bg-background'
            }`}
            style={{ left: `${Math.min(100, (m.size / largestTarget) * 100)}%` }}
            title={`${m.size} members${m.isThreshold ? ' (pool threshold)' : ''}${m.reached ? ' — reached' : ''}`}
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-2 text-xs">
        {milestones.map((m) => (
          <li
            key={m.size}
            className={`rounded-full border px-2 py-0.5 ${
              m.reached
                ? 'border-primary bg-primary/10 font-medium text-primary'
                : 'text-muted-foreground'
            }`}
          >
            {m.size} members{m.isThreshold ? ' (threshold)' : ''}
            {m.reached ? ' ✓' : ''}
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        {next
          ? `${next.size - memberCount} more member${next.size - memberCount === 1 ? '' : 's'} to reach the ${next.size}-member milestone.`
          : 'All group-size milestones reached — collective interest registered.'}{' '}
        Milestone sizes are illustrative group targets, not discount offers.
      </p>
      <p className="text-xs font-medium text-muted-foreground">{POOL_NO_GUARANTEE_NOTE}</p>
    </div>
  );
}
