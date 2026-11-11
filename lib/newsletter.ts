/**
 * Newsletter / deal-alert capture (Section 12, Chunk D) — CAPTURE ONLY.
 *
 * Collects and stores a visitor's email so the site has a way to bring
 * them back. It does NOT send anything: there is no sendEmail call in
 * this module (or in the subscribe route, or in the capture component).
 * Sending is honestly not live yet — services/email.ts fails closed
 * without RESEND_API_KEY — so the copy in NEWSLETTER_COPY says
 * "sending starts once email delivery is configured" and nothing
 * here promises a delivery schedule.
 *
 * Storage shape follows the guest_email_alerts pattern (migration
 * 026): an email-keyed row with an unsubscribe token, one row per
 * email, deduped by a unique index. The table itself lives in
 * migration 036 (supabase/migrations/20261111133000_036_...), which
 * is WRITTEN but NOT APPLIED — until the owner applies it, the
 * subscribe route fails honestly (503) instead of pretending the
 * signup was stored.
 *
 * All helpers here are pure and testable: no DB, no network, no
 * Next.js imports.
 */

export const NEWSLETTER_SOURCES = ['footer', 'homepage', 'deals', 'digest', 'notifications'] as const;
export type NewsletterSource = (typeof NEWSLETTER_SOURCES)[number];

/** Maximum email length (RFC 5321 path limit). */
export const NEWSLETTER_MAX_EMAIL_LENGTH = 254;

/**
 * Honest copy for the capture form. Every string that promises
 * anything about email delivery must come from here so the wording
 * stays consistent between the component and the API response.
 * "Weekly deals in your inbox" would be a lie today — sending is
 * not configured — so no such promise appears anywhere here.
 */
export const NEWSLETTER_COPY = {
  heading: 'Get deal alerts by email',
  description:
    "We'll email you when deals drop — sending starts once email delivery is configured.",
  emailLabel: 'Email address',
  emailPlaceholder: 'you@example.com',
  submitLabel: 'Notify me about deals',
  submittingLabel: 'Saving…',
  successHeading: "You're on the list",
  successMessage:
    "We'll email you when deals drop — sending starts once email delivery is configured. No email has been sent yet.",
  errorFallback: 'Something went wrong. Please try again.',
  privacyNote: 'One email address, no account needed. Unsubscribe anytime.',
} as const;

/**
 * Generic API success message. Deliberately identical for a brand-new
 * signup and for an email that is already subscribed: the route must
 * never leak whether an address already exists.
 */
export const NEWSLETTER_SUBSCRIBED_MESSAGE =
  "You're on the list. We'll email you when deals drop — sending starts once email delivery is configured.";

/**
 * Normalize an email for storage and comparison: trim surrounding
 * whitespace and lowercase. Returns '' for non-strings.
 */
export function normalizeEmail(email: unknown): string {
  if (typeof email !== 'string') return '';
  return email.trim().toLowerCase();
}

/**
 * Validate an email address format. Mirrors the rule in
 * lib/local-alerts.ts (isValidEmail) so guest alerts and the
 * newsletter agree on what counts as an email: one @, a domain
 * with a dot and a TLD of at least 2 characters, no whitespace,
 * and within the 254-character limit.
 */
export function isValidEmailAddress(email: unknown): boolean {
  if (typeof email !== 'string') return false;
  const normalized = email.trim();
  if (normalized.length === 0 || normalized.length > NEWSLETTER_MAX_EMAIL_LENGTH) {
    return false;
  }
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalized);
}

/**
 * Parse the `source` field sent with a signup. Only the sources in
 * NEWSLETTER_SOURCES are valid (the places the capture form is
 * mounted); anything else — including a missing value — is rejected
 * so the stored rows always say where the signup came from.
 */
export function parseNewsletterSource(
  value: unknown
): { ok: true; source: NewsletterSource } | { ok: false; error: string } {
  if (typeof value === 'string' && (NEWSLETTER_SOURCES as readonly string[]).includes(value)) {
    return { ok: true, source: value as NewsletterSource };
  }
  return {
    ok: false,
    error: `source must be one of: ${NEWSLETTER_SOURCES.join(', ')}`,
  };
}

/** PostgREST reports a missing table as PGRST205, Postgres as 42P01. */
export function isMissingTableError(error: { code?: string } | null | undefined): boolean {
  return error?.code === '42P01' || error?.code === 'PGRST205';
}

export type SubscribeInsertOutcome = 'subscribed' | 'already-subscribed' | 'missing-table' | 'error';

/**
 * Map a Supabase insert result to a subscribe outcome.
 *
 * - No error → 'subscribed'.
 * - Unique-violation (23505) on the lower(email) index → the email
 *   is already on the list. This is NOT an error for the caller:
 *   the route answers with the same generic success message as a
 *   new signup, so it never leaks whether an address exists.
 * - Missing table (migration 036 not applied yet) → 'missing-table',
 *   so the route can fail honestly with a 503 instead of claiming
 *   the signup was stored.
 * - Anything else → 'error'.
 */
export function resolveSubscribeInsertResult(error: { code?: string } | null | undefined): SubscribeInsertOutcome {
  if (!error) return 'subscribed';
  if (error.code === '23505') return 'already-subscribed';
  if (isMissingTableError(error)) return 'missing-table';
  return 'error';
}

/**
 * Dedupe helper for an in-memory email store (a Set of normalized
 * emails). This is the testable core of the dedupe rule the database
 * enforces with its unique index on lower(email): the first signup
 * for an address wins, a repeat is reported as already-subscribed
 * without creating a second row, and an invalid address is rejected
 * before anything is stored.
 */
export function subscribeToNewsletterStore(
  store: Set<string>,
  email: unknown
):
  | { ok: true; email: string; alreadySubscribed: boolean }
  | { ok: false; error: string } {
  if (!isValidEmailAddress(email)) {
    return { ok: false, error: 'A valid email address is required.' };
  }
  const normalized = normalizeEmail(email);
  if (store.has(normalized)) {
    return { ok: true, email: normalized, alreadySubscribed: true };
  }
  store.add(normalized);
  return { ok: true, email: normalized, alreadySubscribed: false };
}
