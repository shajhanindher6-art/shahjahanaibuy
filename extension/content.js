// SmartBuy AI — Browser Extension Content Script (v2.0.0, matches manifest.json)
//
// Three jobs, all on the retailer's own site:
//  1. Product pages: detect the product, ask SmartBuy's PUBLIC API
//     (S4#18) for its recorded price, and show an on-page overlay
//     with the best recorded price, a real recorded price-history
//     sparkline (from /api/v1/public/prices), and a price-alert
//     button. Only the product title is sent for the match and only
//     the product slug for history — no login, no account data, no
//     browsing history. The matched price is also saved locally
//     (chrome.storage.local) so the background service worker can
//     check it hourly for price drops (see background.js) — that
//     data never leaves the browser except for the price-check
//     requests themselves.
//  2. Checkout / cart pages: show SmartBuy coupon codes for this
//     retailer (from the public extension coupons endpoint — coupons
//     have no public-API equivalent yet) with an Apply button that
//     fills the retailer's own promo field and clicks its Apply
//     button. The retailer owns its checkout, so SmartBuy cannot
//     force a discount: exactly one code is applied, only when the
//     shopper clicks Apply, and only if a promo field can be found
//     on the page.
//  3. Price alerts (overlay button): browser-local only. Tapping
//     "Set price alert" stores the matched price locally; the
//     background worker notifies on a drop. Email/push alerts need
//     sign-in on the site — the overlay says so, it never claims
//     otherwise.
//
// Privacy: the content script runs only on the five retailer
// domains in the manifest, only on product/checkout pages, and
// sends nothing except the product title (price match) and slug
// (history). No browsing tracking.
//
// Honest limits: retailer page layouts change often, so the
// promo-field finder is generic (see findPromoField) and may
// miss a redesigned checkout — in that case the panel says so
// instead of pretending a code was applied. Nothing is ever
// applied automatically without a click: auto-trying codes can
// get a shopper's retailer account flagged. Price history needs
// at least 2 recorded prices — with fewer, the overlay says
// "Not enough price history yet" instead of drawing a fake line.
// The public API returns RECORDED prices, not live retailer
// quotes, and no per-merchant offer — so the overlay's best price
// is the latest recorded price (labelled as such) with no
// merchant attribution, and the "View Deal" link goes to the
// SmartBuy product page, not a retailer checkout.

const API_BASE = 'https://shahjahanaibuy-b1zp.vercel.app';

const RETAILER_PATTERNS = {
  amazon: {
    hostname: /amazon\.com/,
    merchantName: 'Amazon',
    titleSelector: '#productTitle',
    priceSelector: '#priceblock_ourprice, .a-price .a-offscreen, #corePrice_feature_div .a-offscreen',
    imageSelector: '#landingImage, #imgBlkFront',
  },
  walmart: {
    hostname: /walmart\.com/,
    merchantName: 'Walmart',
    titleSelector: 'h1[itemprop="name"], #main-title',
    priceSelector: '[itemprop="price"], .price-characteristic',
    imageSelector: '[data-testid="product-hero-image"] img, .hero-image img',
  },
  bestbuy: {
    hostname: /bestbuy\.com/,
    merchantName: 'Best Buy',
    titleSelector: 'h1[class*="heading"], .sku-title h1',
    priceSelector: '.priceView-customer-price span, [data-testid="price"]',
    imageSelector: '.primary-image img, [data-testid="main-image"]',
  },
  ebay: {
    hostname: /ebay\.com/,
    merchantName: 'eBay',
    titleSelector: 'h1.x-item-title__mainTitle, #itemTitle',
    priceSelector: '.x-price-primary, [data-testid="x-price-primary"]',
    imageSelector: '#icImg, .ux-image-carousel img',
  },
  aliexpress: {
    hostname: /aliexpress\.com/,
    merchantName: 'AliExpress',
    titleSelector: 'h1.product-title-text, [data-pl="product-title"]',
    priceSelector: '.product-price-value, [class*="product-price"]',
    imageSelector: '.magnifier-image, [class*="image"] img',
  },
};

function detectRetailer() {
  const hostname = window.location.hostname;
  for (const [name, config] of Object.entries(RETAILER_PATTERNS)) {
    if (config.hostname.test(hostname)) return name;
  }
  return null;
}

function extractProductInfo(retailer) {
  const config = RETAILER_PATTERNS[retailer];
  if (!config) return null;

  const titleEl = document.querySelector(config.titleSelector);
  const priceEl = document.querySelector(config.priceSelector);
  const imageEl = document.querySelector(config.imageSelector);

  if (!titleEl) return null;

  const title = titleEl.textContent?.trim() ?? '';
  const priceText = priceEl?.textContent?.trim() ?? '';
  const price = parseFloat(priceText.replace(/[^0-9.]/g, '')) || null;
  const imageUrl = imageEl?.src ?? null;

  return { title, price, imageUrl, retailer, url: window.location.href };
}

function isCheckoutLikePage() {
  // Checkout/cart pages: either the URL says so, or a promo
  // field is already visible on the page.
  return /checkout|cart|buy|payment|order/i.test(window.location.pathname + window.location.search) ||
    findPromoField() !== null;
}

// ---------------------------------------------------------------------------
// Price-history overlay (v2.0.0) — best price + recorded history + alert
// ---------------------------------------------------------------------------

// Real recorded history for one catalog product, from the public
// API (GET /api/v1/public/prices?slug=… — { data: { prices: [{ price,
// recordedAt }] } }). Returns null on any failure (overlay still
// shows the best price) and { points: [] } when the product has no
// recorded history yet — never invented points.
async function fetchPriceHistory(productSlug) {
  try {
    const res = await fetch(
      `${API_BASE}/api/v1/public/prices?slug=${encodeURIComponent(productSlug)}&limit=30`
    );
    if (!res.ok) return null;
    const data = await res.json();
    const rows = Array.isArray(data?.data?.prices) ? data.data.prices : [];
    const points = rows
      .filter((r) => typeof r.price === 'number' && r.price > 0)
      .map((r) => ({ price: r.price, recordedAt: r.recordedAt }))
      .sort((a, b) => String(a.recordedAt).localeCompare(String(b.recordedAt)));
    if (points.length === 0) return { points: [] };
    const prices = points.map((p) => p.price);
    return {
      points,
      lowest: Math.min(...prices),
      highest: Math.max(...prices),
      current: prices[prices.length - 1],
    };
  } catch (e) {
    return null;
  }
}

function buildSparkline(points, width, height) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.style.cssText = 'display: block; width: 100%; background: rgba(255,255,255,0.08); border-radius: 6px;';
  if (points.length < 2) return svg;
  const prices = points.map((p) => p.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1;
  const coords = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * width;
      const y = height - 4 - ((p.price - min) / span) * (height - 8);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  line.setAttribute('points', coords);
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', '#4ade80');
  line.setAttribute('stroke-width', '2');
  svg.appendChild(line);
  return svg;
}

function createPriceOverlay(productInfo, bestPrice, history, productSlug) {
  if (document.getElementById('smartbuy-banner')) return;
  const overlay = document.createElement('div');
  overlay.id = 'smartbuy-banner';
  overlay.style.cssText = `
    position: fixed; bottom: 20px; right: 20px; z-index: 999999;
    background: linear-gradient(135deg, #1e40af, #06b6d4);
    color: white; border-radius: 12px; padding: 16px 20px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.2); max-width: 380px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    transition: transform 0.3s ease, opacity 0.3s ease;
    transform: translateY(0); opacity: 1;
  `;

  const savings = productInfo.price && bestPrice.price ? productInfo.price - bestPrice.price : 0;

  // Build overlay with DOM API to prevent XSS
  const header = document.createElement('div');
  header.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 8px;';
  const icon = document.createElement('span');
  icon.style.fontSize = '18px';
  icon.textContent = '✨';
  const title = document.createElement('strong');
  title.style.fontSize = '14px';
  title.textContent = savings > 0 ? 'SmartBuy AI found a better price!' : 'SmartBuy AI price check';
  header.appendChild(icon);
  header.appendChild(title);

  const info = document.createElement('div');
  info.style.cssText = 'font-size: 13px; margin-bottom: 12px;';
  const priceLine = document.createElement('div');
  priceLine.style.marginBottom = '4px';
  priceLine.textContent = `Best price: $${bestPrice.price?.toFixed(2)} at ${bestPrice.retailer}`;
  info.appendChild(priceLine);
  if (savings > 0) {
    const savingsLine = document.createElement('div');
    savingsLine.style.color = '#4ade80';
    savingsLine.textContent = `You save: $${savings.toFixed(2)}`;
    info.appendChild(savingsLine);
  }

  // Recorded price history — real points only, honest empty states.
  const historyBox = document.createElement('div');
  historyBox.style.cssText = 'margin-bottom: 12px;';
  const historyTitle = document.createElement('div');
  historyTitle.style.cssText = 'font-size: 12px; font-weight: 600; margin-bottom: 4px;';
  historyTitle.textContent = 'Price history (recorded)';
  historyBox.appendChild(historyTitle);
  if (history && history.points.length >= 2) {
    historyBox.appendChild(buildSparkline(history.points, 340, 56));
    const summary = document.createElement('div');
    summary.style.cssText = 'font-size: 12px; margin-top: 4px; color: #e0f2fe;';
    summary.textContent =
      `Lowest $${history.lowest.toFixed(2)} · Highest $${history.highest.toFixed(2)} · ` +
      `${history.points.length} recorded prices`;
    historyBox.appendChild(summary);
  } else if (history && history.points.length === 1) {
    const note = document.createElement('div');
    note.style.cssText = 'font-size: 12px; color: #e0f2fe;';
    note.textContent = 'Not enough price history yet — only 1 recorded price so far.';
    historyBox.appendChild(note);
  } else {
    const note = document.createElement('div');
    note.style.cssText = 'font-size: 12px; color: #e0f2fe;';
    note.textContent = history
      ? 'No recorded price history for this product yet.'
      : 'Price history unavailable right now — best price above is still current.';
    historyBox.appendChild(note);
  }
  info.appendChild(historyBox);

  const actions = document.createElement('div');
  actions.style.cssText = 'display: flex; gap: 8px; flex-wrap: wrap;';
  const link = document.createElement('a');
  link.textContent = 'View Deal';
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.href = bestPrice.url || '#';
  link.style.cssText = 'background: white; color: #1e40af; padding: 6px 16px; border-radius: 6px; text-decoration: none; font-size: 13px; font-weight: 600;';
  const alertBtn = document.createElement('button');
  alertBtn.textContent = '🔔 Set price alert';
  alertBtn.style.cssText = 'background: #f59e0b; color: #1e293b; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 600;';
  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'Dismiss';
  closeBtn.style.cssText = 'background: rgba(255,255,255,0.2); color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 13px;';
  actions.appendChild(link);
  actions.appendChild(alertBtn);
  actions.appendChild(closeBtn);

  const alertNote = document.createElement('div');
  alertNote.style.cssText = 'font-size: 11px; color: #e0f2fe; margin-top: 8px;';
  alertNote.textContent = '';

  alertBtn.addEventListener('click', () => {
    // Browser-local alert: the background worker re-checks hourly
    // and notifies on a drop. Email/push alerts need sign-in.
    rememberTrackedPrice(productSlug, bestPrice.price, productInfo.title);
    alertBtn.textContent = '✓ Price alert set (this browser)';
    alertBtn.disabled = true;
    alertNote.textContent =
      'We\'ll notify you in this browser if the SmartBuy price drops. For email alerts, sign in on SmartBuy and set an alert there.';
  });

  overlay.appendChild(header);
  overlay.appendChild(info);
  overlay.appendChild(actions);
  overlay.appendChild(alertNote);
  document.body.appendChild(overlay);

  closeBtn.addEventListener('click', () => {
    overlay.style.transform = 'translateY(100px)';
    overlay.style.opacity = '0';
    setTimeout(() => overlay.remove(), 300);
  });
}

// Remember a matched product's SmartBuy price locally so the
// background worker can re-check it hourly for drops. Local only:
// nothing is uploaded, and no account is involved.
function rememberTrackedPrice(productSlug, price, title) {
  try {
    if (!productSlug || typeof price !== 'number') return;
    chrome.storage.local.get(['smartbuyTracked'], (stored) => {
      const tracked = stored.smartbuyTracked || {};
      tracked[productSlug] = { price, title, checkedAt: Date.now() };
      chrome.storage.local.set({ smartbuyTracked: tracked });
    });
  } catch (e) {
    // Storage unavailable — banner still works, sync just skips this item.
  }
}

async function checkForBetterPrices(productInfo, options) {
  const forceShow = !!(options && options.forceShow);
  try {
    // Public API (S4#18), two steps — the public API has no
    // title-search price endpoint:
    //  1. GET /api/v1/public/products?search=<title> resolves the
    //     retailer title to a catalog product (first match only).
    //  2. GET /api/v1/public/products/<slug> returns the latest
    //     recorded price — the overlay's best price. It is a
    //     RECORDED price, not a live retailer quote, and carries no
    //     merchant attribution: the overlay says so.
    const searchRes = await fetch(
      `${API_BASE}/api/v1/public/products?search=${encodeURIComponent(productInfo.title)}&pageSize=1`
    );
    if (!searchRes.ok) return;
    const searchData = await searchRes.json();
    const products = Array.isArray(searchData.data) ? searchData.data : [];
    const productSlug = products[0]?.slug || null;
    if (!productSlug) return;

    const productRes = await fetch(
      `${API_BASE}/api/v1/public/products/${encodeURIComponent(productSlug)}`
    );
    if (!productRes.ok) return;
    const productData = await productRes.json();
    const latest = productData?.data?.latestRecordedPrice ?? null;
    const latestPrice =
      latest && typeof latest.price === 'number' && latest.price > 0 ? latest.price : null;
    if (latestPrice === null) return;

    const bestPrice = {
      retailer: 'SmartBuy (recorded)',
      price: latestPrice,
      url: `${API_BASE}/products/${productSlug}`,
    };
    rememberTrackedPrice(productSlug, bestPrice.price, productInfo.title);
    // v2.0.0 overlay: shown when SmartBuy has a cheaper price, or
    // on demand (popup "Show Price History") for any matched
    // product — the overlay's value is the history + alert, not
    // just the saving.
    const isCheaper = productInfo.price && bestPrice.price < productInfo.price;
    if (!isCheaper && !forceShow) return;
    const history = await fetchPriceHistory(productSlug);
    createPriceOverlay(productInfo, bestPrice, history, productSlug);
  } catch (e) {
    // Silently fail — extension should not disrupt shopping
  }
}

// ---------------------------------------------------------------------------
// Coupons on checkout pages
// ---------------------------------------------------------------------------

function findPromoField() {
  const inputs = Array.from(
    document.querySelectorAll('input[type="text"], input:not([type]), input[type="search"]')
  );
  return (
    inputs.find((el) => {
      if (el.offsetParent === null || el.disabled || el.readOnly) return false;
      const hay = `${el.name || ''} ${el.id || ''} ${el.placeholder || ''} ${el.getAttribute('aria-label') || ''}`.toLowerCase();
      return /promo|coupon|discount|voucher|gift.?card|code/.test(hay);
    }) || null
  );
}

function findApplyButton(input) {
  const container = input.closest('form') || input.parentElement?.parentElement || document.body;
  const buttons = Array.from(container.querySelectorAll('button, input[type="submit"], [role="button"]'));
  return (
    buttons.find((b) => /apply|redeem|add/i.test(b.textContent || b.value || '')) || null
  );
}

function setInputValue(input, value) {
  // Use the native setter so React-controlled inputs register
  // the change; then fire input/change events for plain inputs.
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function createCouponPanel(retailer, coupons, statusEl) {
  if (document.getElementById('smartbuy-coupons')) return;
  const panel = document.createElement('div');
  panel.id = 'smartbuy-coupons';
  panel.style.cssText = `
    position: fixed; bottom: 20px; right: 20px; z-index: 999999;
    background: white; color: #0f172a; border-radius: 12px; padding: 16px 20px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.2); max-width: 360px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    border: 2px solid #16a34a;
  `;

  const header = document.createElement('strong');
  header.style.fontSize = '14px';
  header.textContent = `SmartBuy coupons for ${RETAILER_PATTERNS[retailer].merchantName}`;
  panel.appendChild(header);

  const note = document.createElement('div');
  note.style.cssText = 'font-size: 12px; color: #475569; margin: 6px 0 10px;';
  note.textContent =
    'Tap Apply on one code — it fills this retailer\'s promo box and clicks Apply. Codes are only applied when you tap.';
  panel.appendChild(note);

  for (const coupon of coupons) {
    const row = document.createElement('div');
    row.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 8px;';
    const code = document.createElement('span');
    code.style.cssText = 'font-family: monospace; font-weight: 700; font-size: 13px;';
    code.textContent = coupon.code;
    const label = document.createElement('span');
    label.style.cssText = 'font-size: 12px; color: #475569; flex: 1;';
    label.textContent =
      coupon.discountType === 'percentage' ? `${coupon.discountValue}% off` : `$${coupon.discountValue} off`;
    const applyBtn = document.createElement('button');
    applyBtn.textContent = 'Apply';
    applyBtn.style.cssText = 'background: #16a34a; color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 600;';
    applyBtn.addEventListener('click', () => {
      const input = findPromoField();
      if (!input) {
        statusEl.textContent =
          'Promo box not found on this page — open the retailer\'s promo/gift-card section first, then tap Apply again.';
        return;
      }
      setInputValue(input, coupon.code);
      const button = findApplyButton(input);
      if (button) {
        button.click();
        statusEl.textContent = `Applied ${coupon.code} — check the retailer's discount line to confirm it was accepted.`;
      } else {
        statusEl.textContent =
          `Code ${coupon.code} is filled in the promo box — tap the retailer's own Apply button to finish.`;
      }
    });
    row.appendChild(code);
    row.appendChild(label);
    row.appendChild(applyBtn);
    panel.appendChild(row);
  }

  const footer = document.createElement('div');
  footer.style.cssText = 'display: flex; gap: 8px; align-items: center; margin-top: 4px;';
  const dismiss = document.createElement('button');
  dismiss.textContent = 'Dismiss';
  dismiss.style.cssText = 'background: #e2e8f0; color: #0f172a; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 13px;';
  dismiss.addEventListener('click', () => panel.remove());
  footer.appendChild(dismiss);
  footer.appendChild(statusEl);
  panel.appendChild(footer);

  document.body.appendChild(panel);
}

async function checkForCoupons(retailer) {
  try {
    // The extension coupons endpoint already resolves the domain to
    // its merchant and serves only currently-valid coupons, so no
    // second merchants fetch (and no client-side merchant matching)
    // is needed anymore. It stays on the extension route: coupons
    // have no public-API (S4#18) equivalent yet.
    const domain = window.location.hostname;
    const res = await fetch(`${API_BASE}/api/v1/extension/coupons?domain=${encodeURIComponent(domain)}`);
    if (!res.ok) return;
    const data = await res.json();
    const coupons = Array.isArray(data.data) ? data.data : [];
    if (coupons.length === 0) return;

    const statusEl = document.createElement('span');
    statusEl.style.cssText = 'font-size: 12px; color: #475569;';
    createCouponPanel(retailer, coupons, statusEl);
  } catch (e) {
    // Silently fail — extension should not disrupt checkout
  }
}

function init() {
  const retailer = detectRetailer();
  if (!retailer) return;

  setTimeout(() => {
    if (isCheckoutLikePage()) {
      // Checkout pages get coupons, not the price banner.
      void checkForCoupons(retailer);
      return;
    }
    const productInfo = extractProductInfo(retailer);
    if (productInfo && productInfo.title && productInfo.price) {
      void checkForBetterPrices(productInfo);
    }
  }, 2000);
}

// Popup's "Search for Better Prices" button (previously dead:
// nothing listened for this message). Re-run the check on demand.
// "Show Price History" forces the v2.0.0 overlay even when SmartBuy
// is not cheaper — the history + alert are the point there.
chrome.runtime.onMessage.addListener((message) => {
  if (message?.action === 'manualSearch' || message?.action === 'showOverlay') {
    const retailer = detectRetailer();
    if (!retailer) return;
    if (isCheckoutLikePage()) {
      void checkForCoupons(retailer);
      return;
    }
    const productInfo = extractProductInfo(retailer);
    if (productInfo && productInfo.title && productInfo.price) {
      void checkForBetterPrices(productInfo, { forceShow: message.action === 'showOverlay' });
    }
  }
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
