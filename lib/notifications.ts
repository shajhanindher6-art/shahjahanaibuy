/**
 * Notifications list helpers (Section 14, Chunk 1) — pure and
 * testable: no DB, no network, no Next.js imports.
 *
 * The GET /api/v1/notifications list route and the dashboard
 * notifications page share these rules, so the query parsing, the
 * read filter and the snake_case → camelCase mapping live here
 * instead of being re-implemented (and re-diverged) in two places.
 *
 * READ STATE: there is no `read` column on notification_queue
 * (adding one would need a migration). Read/unread lives in the
 * row's jsonb `data` column as `{...data, read: true}`, written by
 * PATCH /api/v1/notifications/[id] and POST
 * /api/v1/notifications/read-all. A row whose `data` has no `read`
 * key was never marked — it counts as UNREAD.
 *
 * PAGING MODEL: the route fetches the user's rows (bounded by
 * NOTIFICATIONS_FETCH_CAP, newest first) and this module filters
 * and slices in memory. That is deliberate: the read flag lives
 * inside jsonb, and filtering it in the query would need
 * PostgREST `->>` syntax that cannot be verified against the live
 * DB from here. The cap keeps the in-memory pass honest — the
 * meta.total the route returns is the filtered count within the
 * fetched window, and the window (500 rows) is far above any
 * realistic per-user notification mailbox.
 */

/** Read filter values accepted by ?read=. Anything else means 'all'. */
export type NotificationsReadFilter = 'all' | 'read' | 'unread';

/** Parsed, validated ?limit=&offset=&type=&read= query. */
export interface NotificationsListQuery {
  limit: number;
  offset: number;
  /** Exact `type` match, or null for no type filter. */
  type: string | null;
  read: NotificationsReadFilter;
}

export const NOTIFICATIONS_DEFAULT_LIMIT = 20;
export const NOTIFICATIONS_MAX_LIMIT = 100;
/** Max rows the list route fetches before filtering in memory. */
export const NOTIFICATIONS_FETCH_CAP = 500;

/**
 * Parse and validate the list query. Invalid numbers fall back to
 * defaults (never a 400 — a bad ?limit= is a UI typo, not a client
 * error worth failing the whole list over); an unknown ?read=
 * value means 'all'.
 */
export function parseNotificationsListQuery(
  searchParams: URLSearchParams
): NotificationsListQuery {
  const rawLimitParam = searchParams.get('limit');
  const rawLimit = rawLimitParam === null ? Number.NaN : Number(rawLimitParam);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(NOTIFICATIONS_MAX_LIMIT, Math.max(1, Math.floor(rawLimit)))
    : NOTIFICATIONS_DEFAULT_LIMIT;
  const rawOffsetParam = searchParams.get('offset');
  const rawOffset = rawOffsetParam === null ? Number.NaN : Number(rawOffsetParam);
  const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.floor(rawOffset)) : 0;
  const rawType = (searchParams.get('type') ?? '').trim();
  const type = rawType.length > 0 ? rawType : null;
  const rawRead = searchParams.get('read');
  const read: NotificationsReadFilter =
    rawRead === 'read' || rawRead === 'unread' ? rawRead : 'all';
  return { limit, offset, type, read };
}

/** A notification_queue row as the database returns it. */
export interface NotificationDbRow {
  id: string;
  type: string;
  channel: string;
  subject: string | null;
  body: string;
  status: string;
  scheduled_for: string;
  sent_at: string | null;
  created_at: string;
  data?: { read?: boolean } | null;
}

/** A notification as the dashboard page consumes it (camelCase). */
export interface NotificationEntry {
  id: string;
  type: string;
  channel: string;
  subject: string | null;
  body: string;
  status: string;
  scheduledFor: string;
  sentAt: string | null;
  createdAt: string;
  data?: { read?: boolean } | null;
}

/** True when the row was marked read (data.read flag). */
export function isNotificationRead(row: { data?: { read?: boolean } | null }): boolean {
  return row.data?.read === true;
}

/**
 * Map a DB row to the page shape. The API used to return select('*')
 * verbatim, so the page's scheduledFor/sentAt/createdAt were
 * undefined and every date rendered "Invalid Date" — the column
 * names are snake_case, the page reads camelCase.
 */
export function mapNotificationRow(row: NotificationDbRow): NotificationEntry {
  return {
    id: row.id,
    type: row.type,
    channel: row.channel,
    subject: row.subject,
    body: row.body,
    status: row.status,
    scheduledFor: row.scheduled_for,
    sentAt: row.sent_at,
    createdAt: row.created_at,
    data: row.data ?? null,
  };
}

/**
 * Apply the type + read filters and the limit/offset page to
 * already-mapped rows (newest first — the route orders them).
 * Returns the page plus the filtered total. unreadCount is the
 * unread count across ALL fetched rows, ignoring the type/read
 * filters, so the UI can show a global "N unread" and the sidebar
 * badge from the same response.
 */
export function applyNotificationsListQuery(
  rows: NotificationEntry[],
  query: NotificationsListQuery
): { page: NotificationEntry[]; total: number; unreadCount: number } {
  let filtered = rows;
  if (query.type !== null) {
    filtered = filtered.filter((r) => r.type === query.type);
  }
  if (query.read === 'read') {
    filtered = filtered.filter((r) => isNotificationRead(r));
  } else if (query.read === 'unread') {
    filtered = filtered.filter((r) => !isNotificationRead(r));
  }
  const unreadCount = rows.filter((r) => !isNotificationRead(r)).length;
  const total = filtered.length;
  const page = filtered.slice(query.offset, query.offset + query.limit);
  return { page, total, unreadCount };
}

/**
 * Distinct `type` values in a set of rows, sorted — the page's
 * type-filter options. Derived from real rows only; no type is
 * ever invented for the filter list.
 */
export function notificationTypeOptions(rows: NotificationEntry[]): string[] {
  return [...new Set(rows.map((r) => r.type))].sort((a, b) => a.localeCompare(b));
}

/**
 * Browser event the notifications page dispatches after any
 * read-state change, so the dashboard sidebar badge refreshes
 * without a reload (the sidebar stays mounted across dashboard
 * navigations in the App Router).
 */
export const NOTIFICATIONS_CHANGED_EVENT = 'smartbuy:notifications-changed';
