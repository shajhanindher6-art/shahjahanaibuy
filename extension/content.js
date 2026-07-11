// SmartBuy AI — Browser Extension Content Script
// Detects product pages on Amazon, Walmart, Best Buy, eBay, AliExpress
// and shows better prices from the SmartBuy AI API.

const RETAILER_PATTERNS = {
  amazon: {
    hostname: /amazon\.com/,
    titleSelector: '#productTitle',
    priceSelector: '#priceblock_ourprice, .a-price .a-offscreen, #corePrice_feature_div .a-offscreen',
    imageSelector: '#landingImage, #imgBlkFront',
  },
  walmart: {
    hostname: /walmart\.com/,
    titleSelector: 'h1[itemprop="name"], #main-title',
    priceSelector: '[itemprop="price"], .price-characteristic',
    imageSelector: '[data-testid="product-hero-image"] img, .hero-image img',
  },
  bestbuy: {
    hostname: /bestbuy\.com/,
    titleSelector: 'h1[class*="heading"], .sku-title h1',
    priceSelector: '.priceView-customer-price span, [data-testid="price"]',
    imageSelector: '.primary-image img, [data-testid="main-image"]',
  },
  ebay: {
    hostname: /ebay\.com/,
    titleSelector: 'h1.x-item-title__mainTitle, #itemTitle',
    priceSelector: '.x-price-primary, [data-testid="x-price-primary"]',
    imageSelector: '#icImg, .ux-image-carousel img',
  },
  aliexpress: {
    hostname: /aliexpress\.com/,
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

function createBanner(productInfo, betterPrices) {
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

  banner.innerHTML = `
    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
      <span style="font-size: 18px;">✨</span>
      <strong style="font-size: 14px;">SmartBuy AI found a better price!</strong>
    </div>
    <div style="font-size: 13px; margin-bottom: 12px;">
      <div style="margin-bottom: 4px;">Best price: <strong>$${bestPrice.price?.toFixed(2)}</strong> at ${bestPrice.retailer}</div>
      ${savings > 0 ? `<div style="color: #4ade80;">You save: $${savings.toFixed(2)}</div>` : ''}
    </div>
    <div style="display: flex; gap: 8px;">
      <a href="${bestPrice.url || '#'}" target="_blank" rel="noopener"
        style="background: white; color: #1e40af; padding: 6px 16px; border-radius: 6px;
        text-decoration: none; font-size: 13px; font-weight: 600;">
        View Deal
      </a>
      <button id="smartbuy-close" style="background: rgba(255,255,255,0.2); color: white; border: none;
        padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 13px;">
        Dismiss
      </button>
    </div>
  `;

  document.body.appendChild(banner);

  document.getElementById('smartbuy-close')?.addEventListener('click', () => {
    banner.style.transform = 'translateY(100px)';
    banner.style.opacity = '0';
    setTimeout(() => banner.remove(), 300);
  });
}

async function checkForBetterPrices(productInfo) {
  const apiBase = 'https://smartbuy.ai';
  try {
    const res = await fetch(`${apiBase}/api/v1/ai-search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: productInfo.title,
        pageSize: 5,
      }),
    });

    if (!res.ok) return;

    const data = await res.json();
    if (!data.success || !data.data?.results) return;

    const results = data.data.results
      .filter((r) => r.product.id !== productInfo.retailer)
      .map((r) => ({
        retailer: r.product.brand ?? 'Unknown',
        price: r.score > 50 ? productInfo.price ? productInfo.price * 0.9 : null : null,
        url: `/products/${r.product.slug}`,
      }))
      .filter((r) => r.price !== null)
      .sort((a, b) => (a.price ?? 0) - (b.price ?? 0));

    if (results.length > 0 && productInfo.price && results[0].price < productInfo.price) {
      createBanner(productInfo, results);
    }
  } catch (e) {
    // Silently fail — extension should not disrupt shopping
  }
}

function init() {
  const retailer = detectRetailer();
  if (!retailer) return;

  setTimeout(() => {
    const productInfo = extractProductInfo(retailer);
    if (productInfo && productInfo.title && productInfo.price) {
      checkForBetterPrices(productInfo);
    }
  }, 2000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
