/* SmartBuy AI — Bookmarklet (public/bookmarklet.js)
 *
 * Loaded by the bookmarklet on /bookmarklet (drag the "Track on
 * SmartBuy" link to your bookmarks bar, then click it on any
 * shopping site). No extension install needed, no dependencies.
 *
 * What it does, on the page you are currently viewing:
 *   1. Extracts the product title, price and image with best-effort
 *      selectors: Open Graph / Twitter meta tags first, then h1 and
 *      common price elements. Extraction is best-effort — every
 *      store marks prices up differently, so a missing price just
 *      means the panel shows the title without a price.
 *   2. Shows a small panel (inline styles only, so it works on any
 *      site regardless of that site's CSS) with two actions:
 *        - "Search on SmartBuy" — opens SmartBuy search for the title.
 *        - "Track this product" — opens /track with the extracted
 *          data, where you can find the product and set a price alert.
 *   3. Sends nothing anywhere by itself: it only opens SmartBuy
 *      pages in a new tab when you click a button. No data is
 *      collected from the external page.
 *
 * Limitations: sites with a strict Content Security Policy may
 * block loading this script; on those sites use the full browser
 * extension in the extension/ folder instead.
 */
(function () {
  'use strict';

  var PANEL_ID = 'smartbuy-bookmarklet-panel';
  var existing = document.getElementById(PANEL_ID);
  if (existing) {
    existing.remove();
    return;
  }

  function metaContent(property) {
    var el = document.querySelector(
      'meta[property="' + property + '"], meta[name="' + property + '"]'
    );
    return el ? (el.getAttribute('content') || '').trim() : '';
  }

  function parsePrice(text) {
    if (!text) return null;
    var cleaned = text.replace(/[^0-9.,]/g, '').replace(/,(?=\d{3}(\D|$))/g, '');
    var value = parseFloat(cleaned);
    return isFinite(value) && value > 0 ? value : null;
  }

  var title =
    metaContent('og:title') ||
    metaContent('twitter:title') ||
    (document.querySelector('h1') ? document.querySelector('h1').textContent.trim() : '') ||
    document.title;

  var priceText =
    metaContent('og:price:amount') ||
    metaContent('product:price:amount') ||
    '';
  var priceEl = document.querySelector(
    '[itemprop="price"], .a-price .a-offscreen, [data-testid="price"], .priceView-customer-price span'
  );
  var price = parsePrice(priceText) || parsePrice(priceEl ? priceEl.textContent : null);

  var image =
    metaContent('og:image') ||
    metaContent('twitter:image') ||
    '';

  // SmartBuy origin = wherever this script was loaded from, so the
  // bookmarklet works on the live site and on local dev alike.
  var origin = 'https://aismartbuy.netlify.app';
  try {
    var scripts = document.getElementsByTagName('script');
    var current = scripts[scripts.length - 1];
    if (current && current.src) {
      origin = current.src.replace(/\/bookmarklet\.js.*$/, '');
    }
  } catch (e) {
    /* keep the default origin */
  }

  var params = new URLSearchParams();
  if (title) params.set('title', title);
  if (price !== null) params.set('price', String(price));
  if (image) params.set('image', image);
  params.set('url', window.location.href);

  var panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.setAttribute(
    'style',
    'position:fixed;bottom:20px;right:20px;z-index:2147483647;width:320px;max-width:calc(100vw - 40px);' +
      'background:#ffffff;color:#0f172a;border:1px solid #e2e8f0;border-radius:12px;' +
      'box-shadow:0 10px 30px rgba(0,0,0,0.25);font-family:system-ui,sans-serif;font-size:14px;padding:16px;'
  );

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  panel.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">' +
    '<strong style="font-size:15px;">SmartBuy AI</strong>' +
    '<button id="smartbuy-bm-close" style="border:0;background:transparent;cursor:pointer;font-size:18px;line-height:1;">×</button>' +
    '</div>' +
    '<p style="margin:8px 0 4px;font-weight:600;">' + esc(title || 'Product') + '</p>' +
    (price !== null
      ? '<p style="margin:0 0 12px;color:#16a34a;font-weight:700;">$' + price.toFixed(2) + '</p>'
      : '<p style="margin:0 0 12px;color:#64748b;">Price could not be detected on this page.</p>') +
    '<a href="' + origin + '/search?q=' + encodeURIComponent(title) + '" target="_blank" rel="noopener" ' +
    'style="display:block;text-align:center;background:#2563eb;color:#fff;text-decoration:none;' +
    'border-radius:8px;padding:10px;margin-bottom:8px;">Search on SmartBuy</a>' +
    '<a href="' + origin + '/track?' + params.toString() + '" target="_blank" rel="noopener" ' +
    'style="display:block;text-align:center;background:#f1f5f9;color:#0f172a;text-decoration:none;' +
    'border-radius:8px;padding:10px;">Track this product</a>' +
    '<p style="margin:12px 0 0;color:#64748b;font-size:12px;">Nothing is sent anywhere until you click a button.</p>';

  document.body.appendChild(panel);
  var closeBtn = document.getElementById('smartbuy-bm-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', function () {
      panel.remove();
    });
  }
})();
