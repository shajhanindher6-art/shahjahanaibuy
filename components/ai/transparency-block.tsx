/**
 * Shared AI transparency block (Section 19, Phase 7, §12 #70).
 *
 * ONE component for every AI surface that explains its own output:
 * what data was used, the data timestamp, the confidence (and what
 * that number actually is), the assumptions made, and — always —
 * what information is missing. The "missing info" row is never
 * omitted: when the caller lists nothing, the block says so
 * plainly ("not listed by the source") instead of hiding the gap.
 *
 * Surfaces that already carry exemplary transparency —
 * predictions, buy-vs-wait, the forecast explainer — keep their
 * own rendering and are NOT rebuilt on top of this component.
 * Surfaces that adopt it: /deals (page-level ranking block);
 * the AI summary, recommendations and comparison surfaces are
 * owned by sibling phases (Phase 2 / 4 / 5) and adopt it in the
 * fix-up pass — see the Phase 7 report.
 *
 * Props are plain strings only: no invented numbers. A caller that
 * has no timestamp passes dataTimestamp: null and the block renders
 * "not recorded" rather than a guessed date.
 */

export interface TransparencyBlockProps {
  /** Heading, e.g. "How this ranking was calculated". */
  title?: string;
  /** What data went into this result — one line per source. */
  dataUsed: string[];
  /** ISO timestamp the underlying data was recorded/generated at, or null when unknown. */
  dataTimestamp?: string | null;
  /** Label for the timestamp row, e.g. "Ranked at". Defaults to "Data as of". */
  dataTimestampLabel?: string;
  /** What the confidence/score number actually is, e.g. "AI Score 82/100 — a ranking score, not a verified discount". Null when the surface has no score. */
  confidence?: string | null;
  /** Assumptions the result rests on. */
  assumptions?: string[];
  /** What information is missing (checks not run, data not used). Always rendered; when empty the block says the source did not list any. */
  missingInfo?: string[];
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function TransparencyBlock({
  title = 'How this was calculated',
  dataUsed,
  dataTimestamp,
  dataTimestampLabel = 'Data as of',
  confidence,
  assumptions,
  missingInfo,
}: TransparencyBlockProps) {
  return (
    <section
      aria-label={title}
      className="rounded-lg border bg-card p-4 text-left"
    >
      <h2 className="text-sm font-semibold">{title}</h2>
      <dl className="mt-3 space-y-2 text-sm text-muted-foreground">
        <div>
          <dt className="font-medium text-foreground">Data used</dt>
          <dd>
            {dataUsed.length > 0 ? (
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {dataUsed.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : (
              'Not stated — the source did not list what data was used.'
            )}
          </dd>
        </div>
        <div>
          <dt className="font-medium text-foreground">{dataTimestampLabel}</dt>
          <dd>
            {dataTimestamp ? formatTimestamp(dataTimestamp) : 'Not recorded.'}
          </dd>
        </div>
        {confidence !== undefined && confidence !== null && confidence !== '' ? (
          <div>
            <dt className="font-medium text-foreground">Confidence</dt>
            <dd>{confidence}</dd>
          </div>
        ) : null}
        {assumptions && assumptions.length > 0 ? (
          <div>
            <dt className="font-medium text-foreground">Assumptions</dt>
            <dd>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {assumptions.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </dd>
          </div>
        ) : null}
        <div>
          <dt className="font-medium text-foreground">What is missing</dt>
          <dd>
            {missingInfo && missingInfo.length > 0 ? (
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {missingInfo.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : (
              'Not listed — the source did not say what is missing, so treat this result as incomplete.'
            )}
          </dd>
        </div>
      </dl>
    </section>
  );
}
