// SmartBuy AI — Browser Extension Content Script (v1.1.0)
//
// Two jobs, both on the retailer's own site:
//  1. Product pages: detect the product, ask SmartBuy's public
//     ai-search API for a better catalog price, and show a banner
//     when one exists. Only the product title is sent — no login,
//     no account data, no browsing history.
//  2. Checkout / cart pages: show SmartBuy coupon codes for this
//     retailer (from the public coupons API) with an Apply button
//     that fills the retailer's own promo field and clicks its
//     Apply button. The retailer owns its checkout, so SmartBuy
//     cannot force a discount: exactly one code is applied, only
//     when the shopper clicks Apply, and only if a promo field
//     can be found on the page.
//
// Honest limits: retailer page layouts change often, so the
// promo-field finder is generic (see findPromoField) and may
// miss a redesigned checkout — in that case the panel says so
// instead of pretending a code was applied. Nothing is ever
// applied automatically without a click: auto-trying codes can
// get a shopper's retailer account flagged.

const API_BASE = 'https://aismartbuy.netlify.app';

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

function createBanner(productInfo, betterPrices) {
  if (document.getElementById('smartbuy-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'smartbuy-banner';
  banner.style.cssText = `
    position: fixed; bottom: 20px; right: 20px; z-index: 999999;
    background: linear-gradient(135deg, #1e40af, #06b6d4);
    color: white; border-radius: 12px; padding: 16px 20px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.2); max-width: 360px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    transition: transform 0.3s ease, opacity 0.3s ease;
    transform: translateY(0); opacity: 1;
  `;

  const bestPrice = betterPrices[0];
  const savings = productInfo.price && bestPrice.price ? productInfo.price - bestPrice.price : 0;

  // Build banner with DOM API to prevent XSS
  const header = document.createElement('div');
  header.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 8px;';
  const icon = document.createElement('span');
  icon.style.fontSize = '18px';
  icon.textContent = '✨';
  const title = document.createElement('strong');
  title.style.fontSize = '14px';
  title.textContent = 'SmartBuy AI found a better price!';
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

  const actions = document.createElement('div');
  actions.style.cssText = 'display: flex; gap: 8px;';
  const link = document.createElement('a');
  link.textContent = 'View Deal';
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.href = bestPrice.url || '#';
  link.style.cssText = 'background: white; color: #1e40af; padding: 6px 16px; border-radius: 6px; text-decoration: none; font-size: 13px; font-weight: 600;';
  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'Dismiss';
  closeBtn.style.cssText = 'background: rgba(255,255,255,0.2); color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 13px;';
  actions.appendChild(link);
  actions.appendChild(closeBtn);

  banner.appendChild(header);
  banner.appendChild(info);
  banner.appendChild(actions);
  document.body.appendChild(banner);

  closeBtn.addEventListener('click', () => {
    banner.style.transform = 'translateY(100px)';
    banner.style.opacity = '0';
    setTimeout(() => banner.remove(), 300);
  });
}

async function checkForBetterPrices(productInfo) {
  try {
    const res = await fetch(`${API_BASE}/api/v1/ai-search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: productInfo.title,
        pageSize: 5,
      }),
    });

    if (!res.ok) return;

    const data = await res.json();
    // The ai-search API returns the results array directly in
    // `data` (meta holds total/parsedIntent). Accept the object
    // shape too so a future API change cannot silently break this.
    const results = Array.isArray(data.data) ? data.data : (data.data?.results ?? []);
    if (!Array.isArray(results)) return;

    const better = results
      .map((r) => ({
        retailer: (r.stores && r.stores[0]) || r.product?.brand || 'SmartBuy',
        price: typeof r.currentPrice === 'number' ? r.currentPrice : null,
        url: r.product?.slug ? `${API_BASE}/products/${r.product.slug}` : null,
      }))
      .filter((r) => r.price !== null && r.price > 0)
      .sort((a, b) => (a.price ?? 0) - (b.price ?? 0));

    if (better.length > 0 && productInfo.price && better[0].price < productInfo.price) {
      createBanner(productInfo, better);
    }
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
    const [couponsRes, merchantsRes] = await Promise.all([
      fetch(`${API_BASE}/api/v1/coupons?pageSize=100`),
      fetch(`${API_BASE}/api/v1/merchants?pageSize=100`),
    ]);
    const couponsData = await couponsRes.json();
    const merchantsData = await merchantsRes.json();
    const coupons = Array.isArray(couponsData.data) ? couponsData.data : [];
    const merchants = Array.isArray(merchantsData.data) ? merchantsData.data : [];
    const wanted = RETAILER_PATTERNS[retailer].merchantName.toLowerCase();
    const merchantIds = new Set(
      merchants.filter((m) => (m.name || '').toLowerCase() === wanted).map((m) => m.id)
    );
    const mine = coupons.filter((c) => merchantIds.has(c.merchantId));
    if (mine.length === 0) return;

    const statusEl = document.createElement('span');
    statusEl.style.cssText = 'font-size: 12px; color: #475569;';
    createCouponPanel(retailer, mine, statusEl);
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
chrome.runtime.onMessage.addListener((message) => {
  if (message?.action === 'manualSearch') {
    const retailer = detectRetailer();
    if (!retailer) return;
    if (isCheckoutLikePage()) {
      void checkForCoupons(retailer);
      return;
    }
    const productInfo = extractProductInfo(retailer);
    if (productInfo && productInfo.title && productInfo.price) {
      void checkForBetterPrices(productInfo);
    }
  }
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
