/**
 * AI source labelling (Section 19, Phase 5, §12 #55).
 *
 * Every assistant answer and comparison verdict must carry a source
 * label, following the product-qa labelling pattern (lib/product-qa.ts
 * labels its answers' source; the assistant and comparison surfaces
 * never did). Two kinds exist:
 *
 *   - "verified recorded data": the answer was computed ONLY from
 *     rows in the SmartBuy database (recorded prices, price history,
 *     coupons, deals, reviews, specs). The label names the data's
 *     timestamp when one is known — a price verdict is only as fresh
 *     as its last recorded check.
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

/** The verified-data label core (shared wording, one place). */
export const VERIFIED_DATA_LABEL = 'based on verified recorded data';

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
 * Verified-data label, with the data's timestamp when known.
 * `asOf` is the product's real `data_freshness` (or latest recorded
 * price point) — never a fabricated stamp; null means the age is
 * genuinely unknown, and the label says so instead of implying
 * freshness.
 */
export function verifiedDataLabel(asOf: string | null): string {
  const date = formatLabelDate(asOf);
  if (date) {
    return `Source: ${VERIFIED_DATA_LABEL} from the SmartBuy catalog (prices last checked ${date}).`;
  }
  return (
    `Source: ${VERIFIED_DATA_LABEL} from the SmartBuy catalog ` +
    `(recorded prices, price history, coupons and deals as listed in our database — ` +
    `not live merchant prices, and no freshness timestamp is recorded for this data).`
  );
}

/**
 * Verified-data label for a RANGE of freshness timestamps (the
 * comparison verdict covers 2–5 products, each with its own
 * `data_freshness`). `asOfList` holds the real timestamps that exist;
 * when none exist the label says the age is unknown.
 */
export function verifiedDataRangeLabel(asOfList: Array<string | null>): string {
  const dates = asOfList
    .map((iso) => (iso ? new Date(iso).getTime() : NaN))
    .filter((t) => Number.isFinite(t));
  if (dates.length === 0) return verifiedDataLabel(null);
  const oldest = formatLabelDate(new Date(Math.min(...dates)).toISOString());
  const newest = formatLabelDate(new Date(Math.max(...dates)).toISOString());
  if (oldest === newest) return verifiedDataLabel(new Date(Math.min(...dates)).toISOString());
  return (
    `Source: ${VERIFIED_DATA_LABEL} from the SmartBuy catalog ` +
    `(prices last checked ${oldest} to ${newest} across the compared products).`
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
  if (/Source: (based on verified recorded data|based on recorded catalog data|general guidance)/.test(trimmed)) return content;
  return `${trimmed}\n\n${label}`;
}
