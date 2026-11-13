/**
 * AI source labelling (Section 19, Phase 5, §12 #55).
 *
 * Every assistant answer and comparison verdict must carry a source
 * label, following the product-qa labelling pattern (lib/product-qa.ts
 * labels its answers' source; the assistant and comparison surfaces
 * never did). Two kinds exist:
 *
 *   - "prices verified by SmartBuy's live price check … on
 *     <date>": the answer was computed ONLY from rows in the
 *     SmartBuy database AND every price behind it was checked
 *     against merchant data by a real fetch, fresh within the
 *     window. The label names what was verified (prices), by whom
 *     (SmartBuy's live price check), and when (the check date);
 *     with no known check date it renders nothing at all.
 *   - "general guidance": text that is NOT verified against live
 *     product data (generic shopping advice, e.g. "consider your
 *     priorities"). The assistant never produces general-knowledge
 *     content today (deterministic DB-only), so its answers carry
 *     the verified label; the general label exists for the generic
 *     sentences inside comparison summaries and for any future
 *     guidance text, so a reader can always tell the two apart.
 *
 * Pure functions — no DB, no network. The label is appended to an
 * answer's content by the caller (services/chat.ts,
 * services/ai-comparison.ts), never silently dropped.
 */

/** The general-guidance label core (shared wording, one place). */
export const GENERAL_GUIDANCE_LABEL =
  'general guidance — not verified against live product data';

/** "2 Nov 2026" from an ISO timestamp, or null when unparseable. */
export function formatLabelDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Recorded-data label (Section 20, §12 #82). The default label for
 * assistant answers: the answer was computed from rows in the
 * SmartBuy database, but the prices behind it are RECORDED prices
 * — they were not checked live at a merchant, and (unless the
 * caller proves otherwise) they carry no verified stamp. Use
 * verifiedDataLabel ONLY when the caller has checked that the
 * product(s) behind the answer are price_verification_status =
 * 'verified' AND fresh; everything else gets this label, so an
 * unverified or stale price is never presented as "verified".
 */
export function recordedDataLabel(asOf: string | null): string {
  const date = formatLabelDate(asOf);
  if (date) {
    return (
      `Source: based on recorded catalog data from the SmartBuy catalog ` +
      `(prices last checked ${date} — recorded prices, not checked live at the merchant).`
    );
  }
  return (
    `Source: based on recorded catalog data from the SmartBuy catalog ` +
    `(recorded prices, price history, coupons and deals as listed in our database — ` +
    `not live merchant prices, and no freshness timestamp is recorded for this data).`
  );
}

/**
 * Verified-data label (Final 100% — F-P2-18). The old wording
 * ("based on verified recorded data") never said WHAT was
 * verified, BY WHOM, or WHEN — a reader could not tell a live
 * merchant check from a typed-in row. The label now names all
 * three: WHAT = the prices behind the answer; BY WHOM = SmartBuy's
 * live price check, a real fetch against merchant data (never a
 * hand-typed price); WHEN = the check date. When the check date is
 * unknown it returns null — the caller must render NOTHING (and
 * fall back to the recorded-data label), never a dateless
 * "verified". Callers may only use this label after proving
 * verified-AND-fresh (see services/chat.ts, ai-comparison.ts);
 * the function itself trusts its caller on the gate and owns
 * only the wording + the null-on-unknown rule.
 *
 * `asOf` is the product's real `data_freshness` (or latest
 * recorded price point) — never a fabricated stamp.
 */
export function verifiedDataLabel(asOf: string | null): string | null {
  const date = formatLabelDate(asOf);
  if (!date) return null;
  return (
    `Source: prices verified by SmartBuy's live price check against merchant data on ${date} ` +
    `— the prices behind this answer were checked by a real fetch, not typed in by hand.`
  );
}

/**
 * Verified-data label for a RANGE of freshness timestamps (the
 * comparison verdict covers 2–5 products, each with its own
 * `data_freshness`). Same what/by-whom/when wording as
 * verifiedDataLabel, over the oldest→newest check range. Returns
 * null when no check date is known for any compared product —
 * the caller falls back to the recorded-data range label.
 */
export function verifiedDataRangeLabel(asOfList: Array<string | null>): string | null {
  const dates = asOfList
    .map((iso) => (iso ? new Date(iso).getTime() : NaN))
    .filter((t) => Number.isFinite(t));
  if (dates.length === 0) return null;
  const oldest = formatLabelDate(new Date(Math.min(...dates)).toISOString());
  const newest = formatLabelDate(new Date(Math.max(...dates)).toISOString());
  if (oldest === newest) return verifiedDataLabel(new Date(Math.min(...dates)).toISOString());
  return (
    `Source: prices verified by SmartBuy's live price check against merchant data ` +
    `(checked ${oldest} to ${newest} across the compared products) ` +
    `— the prices behind this verdict were checked by a real fetch, not typed in by hand.`
  );
}

/**
 * Recorded-data label for a RANGE of freshness timestamps — the
 * counterpart of verifiedDataRangeLabel (Section 21, P0 #1). The
 * comparison verdict covers 2–5 products; when ANY of them is
 * unverified or stale the verdict is earned-recorded, not
 * verified, so the range label must say recorded, never
 * "verified". Same oldest→newest range, same real timestamps.
 */
export function recordedDataRangeLabel(asOfList: Array<string | null>): string {
  const dates = asOfList
    .map((iso) => (iso ? new Date(iso).getTime() : NaN))
    .filter((t) => Number.isFinite(t));
  if (dates.length === 0) return recordedDataLabel(null);
  const oldest = formatLabelDate(new Date(Math.min(...dates)).toISOString());
  const newest = formatLabelDate(new Date(Math.max(...dates)).toISOString());
  if (oldest === newest) return recordedDataLabel(new Date(Math.min(...dates)).toISOString());
  return (
    `Source: based on recorded catalog data from the SmartBuy catalog ` +
    `(prices last checked ${oldest} to ${newest} across the compared products ` +
    `— recorded prices, not checked live at the merchant).`
  );
}

/** General-guidance label for text that is advice, not data. */
export function generalGuidanceLabel(): string {
  return `Source: ${GENERAL_GUIDANCE_LABEL}.`;
}

/**
 * Append a source label to answer content. A blank line separates
 * the label from the answer so it reads as a footnote, not as part
 * of the verdict. Idempotent: an answer that already ends with a
 * source label is returned unchanged.
 */
export function appendSourceLabel(content: string, label: string): string {
  const trimmed = content.trimEnd();
  if (trimmed.endsWith(label)) return content;
  if (/Source: (prices verified by SmartBuy's live price check|based on recorded catalog data|general guidance)/.test(trimmed)) return content;
  return `${trimmed}\n\n${label}`;
}
