'use client';

/**
 * Prediction accuracy dashboard (Section 4, item 8).
 *
 * Client component — takes a precomputed AccuracySummary (from
 * lib/prediction-accuracy) and renders it. The honest state is the
 * default: until ACCURACY_MIN_RESOLVED outcomes have resolved, the
 * dashboard shows "Not enough history yet" with the counts, never a
 * percentage. Recorded price history today spans ~30 days, so that
 * honest state is what visitors see today.
 *
 * Wiring into /dashboard is wave 2 — this component is ready to
 * receive the summary from GET /api/v1/predictions/accuracy.
 */

import { accuracySummaryLine, type AccuracySummary } from '@/lib/prediction-accuracy';

export function AccuracyDashboard({
  summary,
  className,
}: {
  summary: AccuracySummary;
  className?: string;
}) {
  return (
    <section
      aria-label="Prediction accuracy"
      className={className ?? 'rounded-lg border bg-card p-6 text-card-foreground shadow-sm'}
    >
      <h2 className="text-xl font-semibold">Prediction accuracy</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        How often our Buy vs Wait / price-drop predictions turned out right, measured
        against recorded prices — never against guesses.
      </p>

      {!summary.hasEnoughHistory ? (
        <div className="mt-4 rounded-md border border-dashed p-4">
          <p className="font-medium">Not enough history yet</p>
          <p className="mt-1 text-sm text-muted-foreground">{accuracySummaryLine(summary)}</p>
          <dl className="mt-4 grid grid-cols-3 gap-4 text-center">
            <div>
              <dt className="text-xs text-muted-foreground">Recorded</dt>
              <dd className="text-2xl font-bold">{summary.totalRecorded}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Resolved</dt>
              <dd className="text-2xl font-bold">{summary.resolved}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Still waiting</dt>
              <dd className="text-2xl font-bold">{summary.pending}</dd>
            </div>
          </dl>
          <p className="mt-4 text-xs text-muted-foreground">
            An accuracy percentage appears here once {summary.resolved} of the required 20
            predictions have resolved. Predictions resolve only when their horizon passes
            and a real recorded price exists.
          </p>
        </div>
      ) : (
        <div className="mt-4">
          <p className="text-4xl font-bold">{summary.accuracyPercent}%</p>
          <p className="mt-1 text-sm text-muted-foreground">{accuracySummaryLine(summary)}</p>
          <dl className="mt-4 grid grid-cols-3 gap-4 text-center">
            <div>
              <dt className="text-xs text-muted-foreground">Correct</dt>
              <dd className="text-2xl font-bold text-green-600">{summary.correct}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Incorrect</dt>
              <dd className="text-2xl font-bold text-red-600">{summary.incorrect}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Still waiting</dt>
              <dd className="text-2xl font-bold">{summary.pending}</dd>
            </div>
          </dl>
          {summary.byHorizon.length > 0 && (
            <table className="mt-6 w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 font-medium">Horizon</th>
                  <th className="py-2 font-medium">Resolved</th>
                  <th className="py-2 font-medium">Accuracy</th>
                </tr>
              </thead>
              <tbody>
                {summary.byHorizon.map((h) => (
                  <tr key={h.horizonDays} className="border-b last:border-0">
                    <td className="py-2">{h.horizonDays} days</td>
                    <td className="py-2">{h.resolved}</td>
                    <td className="py-2">
                      {h.accuracyPercent === null
                        ? 'Not enough history yet'
                        : `${h.accuracyPercent}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  );
}
