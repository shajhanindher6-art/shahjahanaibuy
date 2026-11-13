/**
 * FINAL 100% Product & Real Data Completion — Worker W3 (F-P1-36, F-P2-22,
 * F-P2-23, F-P1-38).
 *
 * One shared gate for every interpretive history surface, so the
 * threshold is the same everywhere it is enforced:
 *
 * - Forecast, buy-wait, discount probability, expected-lowest and the
 *   Deal Score already withhold below 5 recorded points
 *   (lib/forecast.ts FORECAST_MIN_POINTS, lib/deal-score.ts
 *   DEAL_SCORE_MIN_DATA_POINTS, services/buy-wait-prediction.ts
 *   BUY_WAIT_MIN_POINTS — all 5). Volatility ranking (2-point
 *   minimum), the explorer "biggest drop" (no minimum), the chart
 *   trend stats (1 point) and the compare page (1 point) did not.
 *   They now share this 5-point minimum plus the 7-day freshness
 *   rule (lib/price-freshness.ts STALE_PRICE_DAYS).
 *
 * - "Verified observations": per-observation verification status is
 *   NOT knowable until migration 057 applies — live rows carry no
 *   `source` column, so a recorded point cannot be told apart from
 *   a verified one. The gate therefore counts RECORDED points (the
 *   same 5-point bar the forecast/Deal Score use) and separately
 *   reports freshness; it never claims a point is verified. When
 *   057 applies, `source` distinguishes live/merchant-feed points
 *   from seed points (see getHistoryProvenance).
 *
 * - Seed provenance: migration 057's own backfill rule labels
 *   `recorded_at < 2026-11-03` rows 'seed'. A point is seed-origin
 *   when its source is 'seed', or when it claims no source and was
 *   recorded before that cutoff (the launch catalog's 40 rows are
 *   exactly those rows — see the Stage A audit, worker F §1). A
 *   point recorded after the cutoff with no source is 'unknown',
 *   never guessed as seed and never guessed as live.
 */

import { getFreshnessStatus, STALE_PRICE_DAYS } from '@/lib/price-freshness';
import type { TrendStats } from '@/lib/price-trend';
import { computeTrendStats } from '@/lib/price-trend';

/** Unified minimum recorded points for any interpretive trend verdict. */
export const HISTORY_MIN_POINTS = 5;

/**
 * Migration 057 backfill cutoff (supabase/migrations/
 * 20261113093000_057_price_history_source_flags.sql): rows recorded
 * before 2026-11-03 are labelled 'seed'. Reused here so the chart
 * label and the migration agree on what "seed" means.
 */
export const SEED_HISTORY_CUTOFF_ISO = '2026-11-03T00:00:00.000Z';

export interface HistoryGatePoint {
  price: number;
  recordedAt: string;
  /** Migration 057 source, or null/undefined when unrecorded (pre-057). */
  source?: string | null;
}

export type HistoryGateReasonCode = 'not-enough-points' | 'stale' | 'unknown-age';

export interface HistoryGate {
  pointCount: number;
  /** True when the series clears BOTH the point minimum and freshness. */
  sufficient: boolean;
  /** True when the latest point is fresh (≤ STALE_PRICE_DAYS old). */
  fresh: boolean;
  ageDays: number | null;
  lastRecordedAt: string | null;
  /** True when the gate blocks an interpretive verdict on this series. */
  gated: boolean;
  reasonCode: HistoryGateReasonCode | null;
  /** Human-readable reason, or null when the series is ungated. */
  reason: string | null;
}

/**
 * Gate a recorded series: needs at least HISTORY_MIN_POINTS points
 * AND a fresh latest point. A series with no parseable date has
 * unknown age — gated, never treated as fresh.
 */
export function assessHistoryGate(
  points: ReadonlyArray<HistoryGatePoint | null | undefined>,
  now: Date = new Date()
): HistoryGate {
  const valid = (points ?? []).filter(
    (p): p is HistoryGatePoint =>
      !!p && Number.isFinite(Number(p.price)) && !!p.recordedAt
  );
  const pointCount = valid.length;
  let lastRecordedAt: string | null = null;
  let lastMs: number | null = null;
  for (const p of valid) {
    const ms = new Date(p.recordedAt).getTime();
    if (Number.isFinite(ms) && (lastMs === null || ms > lastMs)) {
      lastMs = ms;
      lastRecordedAt = p.recordedAt;
    }
  }
  const { status, ageDays } = getFreshnessStatus(lastRecordedAt, now);
  const fresh = status === 'fresh';
  if (pointCount < HISTORY_MIN_POINTS) {
    return {
      pointCount,
      sufficient: false,
      fresh,
      ageDays,
      lastRecordedAt,
      gated: true,
      reasonCode: 'not-enough-points',
      reason:
        `Only ${pointCount} of ${HISTORY_MIN_POINTS} recorded points needed ` +
        `for a trend verdict — more recorded observations are needed first.`,
    };
  }
  if (status === 'stale') {
    return {
      pointCount,
      sufficient: false,
      fresh,
      ageDays,
      lastRecordedAt,
      gated: true,
      reasonCode: 'stale',
      reason:
        `Latest recorded price is ${ageDays ?? '?'} days old ` +
        `(stale after ${STALE_PRICE_DAYS} days) — a trend from it may be out of date.`,
    };
  }
  if (status === 'unknown') {
    return {
      pointCount,
      sufficient: false,
      fresh,
      ageDays,
      lastRecordedAt,
      gated: true,
      reasonCode: 'unknown-age',
      reason:
        'No recorded check date — the age of these prices is unknown, so no trend verdict is shown.',
    };
  }
  return {
    pointCount,
    sufficient: true,
    fresh,
    ageDays,
    lastRecordedAt,
    gated: false,
    reasonCode: null,
    reason: null,
  };
}

/** Trend stats gated by assessHistoryGate: null stats + reason when gated. */
export function gateTrendStats(
  points: ReadonlyArray<HistoryGatePoint | null | undefined>,
  now: Date = new Date()
): { stats: TrendStats | null; gate: HistoryGate } {
  const gate = assessHistoryGate(points, now);
  if (gate.gated) return { stats: null, gate };
  const stats = computeTrendStats(
    (points ?? []).filter((p): p is HistoryGatePoint => !!p) as Array<{
      price: number;
      recordedAt: string;
    }>
  );
  return { stats, gate };
}

export type HistoryProvenanceOrigin = 'seed' | 'mixed' | 'live' | 'unknown';

export interface HistoryProvenance {
  origin: HistoryProvenanceOrigin;
  seedPoints: number;
  livePoints: number;
  unknownPoints: number;
  totalPoints: number;
  /** Label for the chart/footer, or null when there is nothing to label. */
  label: string | null;
}

function pointOrigin(p: HistoryGatePoint): 'seed' | 'live' | 'unknown' {
  if (p.source === 'seed') return 'seed';
  if (p.source === 'live' || p.source === 'ebay-browse-api' || p.source === 'merchant-feed') {
    return 'live';
  }
  if (p.source === 'manual-intake') return 'unknown';
  // No source claimed (pre-057 rows): seed only before the 057
  // backfill cutoff — the migration labels exactly those rows
  // 'seed'. Anything later with no source is unknown, not seed.
  if (!p.source) {
    const ms = new Date(p.recordedAt).getTime();
    if (Number.isFinite(ms) && ms < new Date(SEED_HISTORY_CUTOFF_ISO).getTime()) return 'seed';
    return 'unknown';
  }
  return 'unknown';
}

/**
 * Where a series came from. 'seed' = every point is seed-origin;
 * 'mixed' = seed points alongside live/unknown ones; 'live' =
 * every point is a live observation; 'unknown' = no point can be
 * attributed. Never invents a source: a null source after the
 * cutoff is unknown.
 */
export function getHistoryProvenance(
  points: ReadonlyArray<HistoryGatePoint | null | undefined>
): HistoryProvenance {
  const valid = (points ?? []).filter(
    (p): p is HistoryGatePoint =>
      !!p && Number.isFinite(Number(p.price)) && !!p.recordedAt
  );
  let seedPoints = 0;
  let livePoints = 0;
  let unknownPoints = 0;
  for (const p of valid) {
    const origin = pointOrigin(p);
    if (origin === 'seed') seedPoints += 1;
    else if (origin === 'live') livePoints += 1;
    else unknownPoints += 1;
  }
  const totalPoints = valid.length;
  if (totalPoints === 0) {
    return { origin: 'unknown', seedPoints, livePoints, unknownPoints, totalPoints, label: null };
  }
  if (seedPoints === totalPoints) {
    return {
      origin: 'seed',
      seedPoints,
      livePoints,
      unknownPoints,
      totalPoints,
      label:
        'Seed demo history — these points were created with the launch demo data, ' +
        'not observed from a live merchant. The downtrend, drops and moving average ' +
        'below come from that demo data, not from market movement.',
    };
  }
  if (livePoints === totalPoints) {
    return {
      origin: 'live',
      seedPoints,
      livePoints,
      unknownPoints,
      totalPoints,
      label: null,
    };
  }
  if (seedPoints > 0) {
    return {
      origin: 'mixed',
      seedPoints,
      livePoints,
      unknownPoints,
      totalPoints,
      label:
        `${seedPoints} of ${totalPoints} recorded points are seed demo data ` +
        '(launch demo, not a live observation) — trends mix demo points with later observations.',
    };
  }
  return {
    origin: 'unknown',
    seedPoints,
    livePoints,
    unknownPoints,
    totalPoints,
    label:
      'These points carry no recorded source (they predate source tracking) — ' +
      'their origin cannot be confirmed, so treat the trend as unverified.',
  };
}
