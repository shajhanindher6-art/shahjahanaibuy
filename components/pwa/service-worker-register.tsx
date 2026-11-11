'use client';

import { useEffect, useState } from 'react';

/**
 * Service worker registration + update notice (Section 13, chunk H).
 *
 * Before this change a new worker waited silently: the updated
 * bundle only reached the visitor on a later visit, with no hint
 * that a refresh would get it. Now, when an updated worker
 * finishes installing while an older one still controls the page,
 * a small banner offers a refresh; tapping it sends SKIP_WAITING
 * (handled in public/sw.js) and reloads once the new worker
 * takes control.
 *
 * Registration stays production-only and failure stays silent —
 * the service worker is progressive enhancement.
 */
export function ServiceWorkerRegister() {
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    if (!('serviceWorker' in navigator) || process.env.NODE_ENV !== 'production') {
      return;
    }

    let cancelled = false;

    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        // A waiting worker means a newer build is ready.
        if (registration.waiting && navigator.serviceWorker.controller) {
          setUpdateAvailable(true);
        }

        registration.addEventListener('updatefound', () => {
          const worker = registration.installing;
          if (!worker) return;
          worker.addEventListener('statechange', () => {
            if (cancelled) return;
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
              setUpdateAvailable(true);
            }
          });
        });
      })
      .catch(() => {
        // Silently fail — service worker is progressive enhancement
      });

    // Reload exactly once when the new worker takes control, so
    // the refresh lands on the new bundle instead of looping.
    let reloaded = false;
    const onControllerChange = () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    };
  }, []);

  if (!updateAvailable) return null;

  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 rounded-lg border bg-card p-4 text-card-foreground shadow-lg"
    >
      <p className="text-sm font-medium">A new version of SmartBuy is available.</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Refresh to get the latest features and fixes.
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => {
            navigator.serviceWorker.controller?.postMessage({ type: 'SKIP_WAITING' });
            // If no worker is waiting anymore the message is a
            // no-op; the reload below still gets the new bundle
            // once the waiting worker activates. controllerchange
            // (above) reloads when activation lands.
            setUpdateAvailable(false);
          }}
          className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground"
        >
          Refresh now
        </button>
        <button
          type="button"
          onClick={() => setUpdateAvailable(false)}
          className="inline-flex h-9 items-center rounded-md border px-3 text-sm font-medium"
        >
          Later
        </button>
      </div>
    </div>
  );
}
