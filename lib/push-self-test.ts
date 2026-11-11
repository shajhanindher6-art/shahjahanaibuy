/**
 * Push self-test (Section 14, Chunk 7) — pure step summary.
 *
 * The self-test runs five checks in order (see
 * components/dashboard/push-self-test.tsx): browser support,
 * notification permission, VAPID configured, a browser push
 * subscription exists, and a real test push was delivered. Each
 * check reports pass / fail / skipped (a later check is skipped
 * when an earlier one already failed — a test push cannot be sent
 * when there is no subscription). This module only summarizes
 * the steps; it performs no browser or network I/O, so it is
 * unit-testable in plain Node.
 */

export type SelfTestStepStatus = 'pass' | 'fail' | 'skipped' | 'pending';

export interface SelfTestStep {
  id: string;
  label: string;
  status: SelfTestStepStatus;
  detail: string;
}

export interface SelfTestSummary {
  passed: number;
  failed: number;
  skipped: number;
  /** 'pass' only when every non-skipped step passed. */
  overall: 'pass' | 'fail' | 'not-run';
}

export function summarizeSelfTest(steps: SelfTestStep[]): SelfTestSummary {
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  for (const step of steps) {
    if (step.status === 'pass') passed++;
    else if (step.status === 'fail') failed++;
    else if (step.status === 'skipped') skipped++;
  }
  const ran = passed + failed;
  return {
    passed,
    failed,
    skipped,
    overall: ran === 0 ? 'not-run' : failed === 0 ? 'pass' : 'fail',
  };
}

/** One-line honest verdict for the UI header. */
export function selfTestVerdict(summary: SelfTestSummary): string {
  if (summary.overall === 'not-run') return 'Push self-test has not run yet.';
  if (summary.overall === 'pass') return 'Push notifications are working on this browser.';
  return 'Push notifications are not fully working — see the failed step below.';
}
