/**
 * Browser push-subscription client helper.
 *
 * The server side already existed (POST/DELETE /api/v1/push/subscribe,
 * web-push sending in services/push.ts, push handler in public/sw.js),
 * but no browser code ever called it — so a user could never actually
 * subscribe, and push alerts could never arrive. This module closes
 * that gap. It is deliberately small and failure-tolerant: every
 * failure returns a reason instead of throwing, so settings UI can
 * explain what went wrong (permission denied, unsupported browser,
 * or VAPID public key not configured).
 *
 * Usage (dashboard settings): turning the push toggle ON calls
 * subscribePush(); turning it OFF calls unsubscribePush().
 */

export type PushSubscribeResult =
  | { ok: true }
  | { ok: false; reason: 'unsupported' | 'denied' | 'no-key' | 'server' | 'unknown' };

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

function getVapidPublicKey(): string | null {
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  return key && key.trim() !== '' ? key : null;
}

/**
 * Request permission, register the service worker, subscribe with the
 * VAPID public key, and save the subscription server-side.
 */
export async function subscribePush(): Promise<PushSubscribeResult> {
  if (!isPushSupported()) return { ok: false, reason: 'unsupported' };

  const vapidKey = getVapidPublicKey();
  if (!vapidKey) return { ok: false, reason: 'no-key' };

  try {
    if (Notification.permission === 'denied') {
      return { ok: false, reason: 'denied' };
    }
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      return { ok: false, reason: 'denied' };
    }

    const registration =
      (await navigator.serviceWorker.getRegistration()) ??
      (await navigator.serviceWorker.register('/sw.js'));

    const existing = await registration.pushManager.getSubscription();
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      }));

    const subscriptionJson = subscription.toJSON();
    const res = await fetch('/api/v1/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: subscriptionJson.endpoint,
        keys: subscriptionJson.keys,
        expirationTime: subscriptionJson.expirationTime ?? null,
      }),
    });

    if (!res.ok) return { ok: false, reason: 'server' };
    return { ok: true };
  } catch {
    return { ok: false, reason: 'unknown' };
  }
}

/**
 * Remove the browser subscription and delete it server-side.
 * Best effort: even if the server call fails, the local subscription
 * is still removed so the browser stops receiving pushes.
 */
export async function unsubscribePush(): Promise<void> {
  try {
    if (!isPushSupported()) return;
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (subscription) {
      const endpoint = subscription.endpoint;
      await subscription.unsubscribe().catch(() => undefined);
      await fetch(
        `/api/v1/push/subscribe?endpoint=${encodeURIComponent(endpoint)}`,
        { method: 'DELETE' }
      ).catch(() => undefined);
    }
  } catch {
    // Best effort — unsubscribing must never crash settings UI.
  }
}

// ---------------------------------------------------------------------------
// S3#8 — guest push (no account required, token-based).
// A guest has no user_id, so the subscription is keyed by a random
// browser token stored in localStorage (guest_push_subscriptions
// table, migration 026). The permission + service-worker flow is the
// same as the signed-in one above; only the server save differs.
// ---------------------------------------------------------------------------

export const GUEST_PUSH_TOKEN_KEY = 'sb-guest-push-token';

/** The browser's random guest-push token (created once, kept local). */
export function getGuestPushToken(): string | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    let token = window.localStorage.getItem(GUEST_PUSH_TOKEN_KEY);
    if (!token) {
      token =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `guest-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      window.localStorage.setItem(GUEST_PUSH_TOKEN_KEY, token);
    }
    return token;
  } catch {
    return null;
  }
}

export type GuestPushSubscribeResult =
  | { ok: true }
  | { ok: false; reason: 'unsupported' | 'denied' | 'no-key' | 'server' | 'unknown' };

/**
 * Guest permission flow: request permission, register the service
 * worker, subscribe with the VAPID key, and save the subscription
 * under this browser's guest token — no sign-in required.
 */
export async function subscribeGuestPush(): Promise<GuestPushSubscribeResult> {
  if (!isPushSupported()) return { ok: false, reason: 'unsupported' };

  const vapidKey = getVapidPublicKey();
  if (!vapidKey) return { ok: false, reason: 'no-key' };

  const guestToken = getGuestPushToken();
  if (!guestToken) return { ok: false, reason: 'unknown' };

  try {
    if (Notification.permission === 'denied') {
      return { ok: false, reason: 'denied' };
    }
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      return { ok: false, reason: 'denied' };
    }

    const registration =
      (await navigator.serviceWorker.getRegistration()) ??
      (await navigator.serviceWorker.register('/sw.js'));

    const existing = await registration.pushManager.getSubscription();
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      }));

    const subscriptionJson = subscription.toJSON();
    const res = await fetch('/api/v1/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: subscriptionJson.endpoint,
        keys: subscriptionJson.keys,
        expirationTime: subscriptionJson.expirationTime ?? null,
        guestToken,
      }),
    });

    if (!res.ok) return { ok: false, reason: 'server' };
    return { ok: true };
  } catch {
    return { ok: false, reason: 'unknown' };
  }
}

/** True when this browser currently holds a push subscription. */
export async function isGuestPushSubscribed(): Promise<boolean> {
  try {
    if (!isPushSupported()) return false;
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    return Boolean(subscription);
  } catch {
    return false;
  }
}

/**
 * Remove the browser subscription and delete the guest server-side
 * row (token + endpoint scoped). Best effort, never throws.
 */
export async function unsubscribeGuestPush(): Promise<void> {
  try {
    if (!isPushSupported()) return;
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (subscription) {
      const endpoint = subscription.endpoint;
      const guestToken = getGuestPushToken();
      await subscription.unsubscribe().catch(() => undefined);
      const params = new URLSearchParams({ endpoint });
      if (guestToken) params.set('guestToken', guestToken);
      await fetch(`/api/v1/push/subscribe?${params.toString()}`, {
        method: 'DELETE',
      }).catch(() => undefined);
    }
  } catch {
    // Best effort — unsubscribing must never crash settings UI.
  }
}
