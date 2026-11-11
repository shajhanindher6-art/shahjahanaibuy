/**
 * Account deletion (Section 14, Chunk 7) — pure rules + scope.
 *
 * What deletion honestly does (DELETE /api/v1/account):
 * the signed-in user's rows are deleted from every user-owned
 * table below, then the auth user itself is deleted with the
 * service-role client (supabase.auth.admin.deleteUser). The
 * profiles row cascades from the auth delete (FK ON DELETE
 * CASCADE, migration 001) and is also deleted explicitly first.
 * Deletion is permanent and irreversible — there is no restore,
 * no grace period, and no "deleted account" record kept.
 *
 * What it does NOT delete: guest (browser-token) push rows in
 * guest_push_subscriptions, which are keyed by a browser token
 * and are not linked to any account; referral clicks recorded
 * against the user's link code (aggregate counts only, no owner
 * data); and rows other users created (shared-wishlist polls,
 * community deals). The API says so in its response.
 *
 * The service-role key is required: without
 * SUPABASE_SERVICE_ROLE_KEY the route answers 503 and deletes
 * nothing — it never pretends a deletion happened.
 */

/** Exact text the user must type to confirm. */
export const DELETE_CONFIRMATION_TEXT = 'DELETE';

export function isValidDeleteConfirmation(value: unknown): boolean {
  return typeof value === 'string' && value.trim() === DELETE_CONFIRMATION_TEXT;
}

/**
 * User-owned tables deleted by user_id. wishlist_items has no
 * user_id column — it is deleted by the user's wishlist ids
 * first (see the route). Tables that do not exist yet (migration
 * not run) are skipped, never fatal.
 */
export const USER_DATA_TABLES: readonly string[] = [
  'profiles',
  'user_settings',
  'wishlists',
  'alerts',
  'buy_list_items',
  'savings_events',
  'search_history',
  'push_subscriptions',
  'referral_links',
  'api_keys',
  'price_protection_watches',
];

/** Human-readable list of what is deleted, for the confirm UI. */
export function describeDeletionScope(): string[] {
  return [
    'Your profile and settings',
    'Your wishlists and buy list',
    'Your price alerts and push subscriptions',
    'Your savings ledger and price-protection watches',
    'Your search history and API keys',
    'Your referral link',
    'Your SmartBuy account (sign-in) itself',
  ];
}
