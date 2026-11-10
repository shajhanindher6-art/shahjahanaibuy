/**
 * AI "Future You" Planner — Section 7, item 20 (spec item 13 in the
 * Section 7 combined batch: "AI Future You Planner").
 *
 * Pure savings-plan math. Monthly saving is COMPUTED at read time,
 * never stored:
 *   monthly saving = (target_usd − saved so far) ÷ months remaining
 *   until target_date.
 *
 * HONESTY RULES:
 * - A passed target date is never silently extended: the plan says
 *   so plainly ("Target date guzar gayi — nayi date chuno") and the
 *   monthly amount is null.
 * - A monthly amount larger than the user's monthly budget is
 *   flagged as unrealistic, with the plain reason — never smoothed
 *   over by stretching the date on the user's behalf.
 * - A target inside the current month means "save the full remaining
 *   amount this month" (divisor 1), never a division by zero.
 * - Saved so far is the user's own figure; when none is given it is
 *   $0, never a guessed amount.
 */

export type FutureYouStatus =
  | 'on_track'
  | 'unrealistic'
  | 'date_passed'
  | 'already_saved'
  | 'invalid';

export interface FutureYouPlan {
  status: FutureYouStatus;
  /** Whole calendar months from now until the target date (0 = this month / past). */
  monthsRemaining: number;
  /** Target minus saved so far, floored at 0. */
  totalRemainingUsd: number;
  /** Monthly amount to save, or null when there is no plan to make. */
  monthlySavingUsd: number | null;
  /** Plain-language explanation, always honest about the edge case. */
  message: string;
  /** True only when the monthly amount exceeds the monthly budget. */
  unrealistic: boolean;
}

export interface FutureYouInput {
  targetUsd: number;
  savedSoFarUsd?: number;
  targetDate: string | Date;
  /** The user's monthly budget, when known — used only for the realism check. */
  monthlyBudgetUsd?: number | null;
  now?: Date;
}

function toDayStart(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

/**
 * Whole calendar months from `now` until the target date. A target
 * later this month is 0 months away; a target on the same day next
 * month is 1. Past dates give 0 or less — callers check the date
 * itself for "passed", not this number.
 */
export function monthsUntil(targetDate: Date, now: Date = new Date()): number {
  let months =
    (targetDate.getFullYear() - now.getFullYear()) * 12 +
    (targetDate.getMonth() - now.getMonth());
  if (targetDate.getDate() < now.getDate()) months -= 1;
  return months;
}

export function planFutureYou(input: FutureYouInput): FutureYouPlan {
  const now = input.now ?? new Date();
  const savedSoFar =
    typeof input.savedSoFarUsd === 'number' && Number.isFinite(input.savedSoFarUsd)
      ? Math.max(0, input.savedSoFarUsd)
      : 0;

  if (!Number.isFinite(input.targetUsd) || input.targetUsd <= 0) {
    return {
      status: 'invalid',
      monthsRemaining: 0,
      totalRemainingUsd: 0,
      monthlySavingUsd: null,
      message: 'Target amount must be greater than $0.',
      unrealistic: false,
    };
  }

  const targetDate =
    input.targetDate instanceof Date ? input.targetDate : new Date(input.targetDate);
  if (!Number.isFinite(targetDate.getTime())) {
    return {
      status: 'invalid',
      monthsRemaining: 0,
      totalRemainingUsd: Math.round((input.targetUsd - savedSoFar) * 100) / 100,
      monthlySavingUsd: null,
      message: 'Target date is not a valid date.',
      unrealistic: false,
    };
  }

  // Date passed (day granularity — a target dated today is still open).
  if (toDayStart(targetDate).getTime() < toDayStart(now).getTime()) {
    return {
      status: 'date_passed',
      monthsRemaining: 0,
      totalRemainingUsd: Math.round(Math.max(0, input.targetUsd - savedSoFar) * 100) / 100,
      monthlySavingUsd: null,
      message: 'Target date guzar gayi — nayi date chuno.',
      unrealistic: false,
    };
  }

  const totalRemainingUsd = Math.round(Math.max(0, input.targetUsd - savedSoFar) * 100) / 100;

  if (totalRemainingUsd === 0) {
    return {
      status: 'already_saved',
      monthsRemaining: monthsUntil(targetDate, now),
      totalRemainingUsd: 0,
      monthlySavingUsd: 0,
      message: 'Target poora ho gaya — you have already saved the full target amount.',
      unrealistic: false,
    };
  }

  const monthsRemaining = monthsUntil(targetDate, now);
  // Less than a month left: the full remaining amount is due this month.
  const divisor = Math.max(1, monthsRemaining);
  const monthlySavingUsd = Math.round((totalRemainingUsd / divisor) * 100) / 100;

  const monthlyBudget =
    typeof input.monthlyBudgetUsd === 'number' && Number.isFinite(input.monthlyBudgetUsd)
      ? input.monthlyBudgetUsd
      : null;
  const unrealistic = monthlyBudget !== null && monthlyBudget > 0 && monthlySavingUsd > monthlyBudget;

  if (unrealistic && monthlyBudget !== null) {
    return {
      status: 'unrealistic',
      monthsRemaining,
      totalRemainingUsd,
      monthlySavingUsd,
      message:
        `Har mahine $${monthlySavingUsd.toFixed(2)} bachana hoga, jo aapke monthly budget ` +
        `$${monthlyBudget.toFixed(2)} se zyada hai — target date aage barhao ya target kam karo.`,
      unrealistic: true,
    };
  }

  if (monthsRemaining === 0) {
    return {
      status: 'on_track',
      monthsRemaining: 0,
      totalRemainingUsd,
      monthlySavingUsd,
      message: `Less than a month left — save the full remaining $${totalRemainingUsd.toFixed(2)} this month.`,
      unrealistic: false,
    };
  }

  return {
    status: 'on_track',
    monthsRemaining,
    totalRemainingUsd,
    monthlySavingUsd,
    message:
      `Save $${monthlySavingUsd.toFixed(2)} per month for ${monthsRemaining} month${monthsRemaining === 1 ? '' : 's'} ` +
      `to reach $${input.targetUsd.toFixed(2)} by ${targetDate.toISOString().slice(0, 10)}.`,
    unrealistic: false,
  };
}

/** Validate a goal POST body; returns human-readable errors (empty = valid). */
export function validateFutureYouGoal(input: {
  name?: unknown;
  targetUsd?: unknown;
  targetDate?: unknown;
  productSlug?: unknown;
}): string[] {
  const errors: string[] = [];
  if (typeof input.name !== 'string' || input.name.trim().length === 0) {
    errors.push('name is required.');
  } else if (input.name.trim().length > 120) {
    errors.push('name must be 120 characters or fewer.');
  }
  if (
    typeof input.targetUsd !== 'number' ||
    !Number.isFinite(input.targetUsd) ||
    input.targetUsd <= 0
  ) {
    errors.push('target_usd must be a number greater than 0.');
  }
  if (typeof input.targetDate !== 'string' || !Number.isFinite(Date.parse(input.targetDate))) {
    errors.push('target_date must be a valid date.');
  }
  if (
    input.productSlug !== undefined &&
    input.productSlug !== null &&
    (typeof input.productSlug !== 'string' || input.productSlug.trim().length === 0)
  ) {
    errors.push('product_slug must be a non-empty string when given.');
  }
  return errors;
}
