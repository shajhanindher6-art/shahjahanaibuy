// SmartBuy AI — Background service worker (v2.0.0, matches manifest.json)
// Handles extension lifecycle, communication, and the hourly
// background price-drop sync.
//
// Price-drop sync — what it actually does (and does not do):
// - Every 60 minutes it re-checks the products the content script
//   saved locally (chrome.storage.local `smartbuyTracked`, written
//   only when a SmartBuy catalog match was found on a retailer
//   product page) against the public API (S4#18 —
//   GET /api/v1/public/products/<slug>, latest recorded price).
//   The compared price is the latest RECORDED price, not a live
//   retailer quote, and carries no merchant attribution.
// - If the cheapest SmartBuy price is now LOWER than the saved
//   price, it shows one browser notification and updates the saved
//   price. No email, no account, no server-side tracking: the list
//   lives only in this browser, and a product is only tracked after
//   the shopper visited a page where SmartBuy matched it.
// - It never applies coupons, never buys anything, and never sends
//   browsing history anywhere — each check sends only the product
//   slug to SmartBuy's own public endpoint.

const API_BASE = 'https://shahjahanaibuy-b1zp.vercel.app';
const SYNC_ALARM = 'smartbuy-price-sync';

chrome.runtime.onInstalled.addListener(() => {
  console.log('SmartBuy AI extension installed');
  chrome.alarms.create(SYNC_ALARM, { periodInMinutes: 60 });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'manualSearch') {
    // Re-trigger content script check
    sendResponse({ ok: true });
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== SYNC_ALARM) return;
  try {
    const stored = await chrome.storage.local.get(['smartbuyTracked']);
    const tracked = stored.smartbuyTracked || {};
    for (const [slug, item] of Object.entries(tracked)) {
      try {
        const res = await fetch(`${API_BASE}/api/v1/public/products/${encodeURIComponent(slug)}`);
        if (!res.ok) continue;
        const data = await res.json();
        const latest = data?.data?.latestRecordedPrice ?? null;
        const cheapest =
          latest && typeof latest.price === 'number' && latest.price > 0 ? latest.price : null;
        if (cheapest === null) continue;
        if (typeof cheapest === 'number' && cheapest < item.price) {
          const drop = (item.price - cheapest).toFixed(2);
          // No iconUrl: the extension ships no icon files (see
          // manifest — icon references were removed in v1.1.0), so
          // Chrome uses its default. A missing file must never
          // break the notification.
          chrome.notifications.create(`smartbuy-drop-${slug}-${Date.now()}`, {
            type: 'basic',
            title: 'SmartBuy price drop',
            message: `${item.title || slug} dropped by $${drop} to $${cheapest.toFixed(2)} on SmartBuy.`,
          });
          tracked[slug] = { ...item, price: cheapest, checkedAt: Date.now() };
        } else {
          tracked[slug] = { ...item, checkedAt: Date.now() };
        }
      } catch (e) {
        // One product failing must not stop the rest of the sync.
      }
    }
    await chrome.storage.local.set({ smartbuyTracked: tracked });
  } catch (e) {
    // Sync must never break browsing.
  }
});
