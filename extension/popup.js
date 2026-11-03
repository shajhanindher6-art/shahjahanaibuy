document.addEventListener('DOMContentLoaded', () => {
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');
  const searchBtn = document.getElementById('search-btn');
  const saveBtn = document.getElementById('save-btn');
  const savedList = document.getElementById('saved-list');
  const savedEmpty = document.getElementById('saved-empty');

  // Option 8, Feature 5: browser-local "Save to SmartBuy". This stores
  // { title, url, savedAt } in chrome.storage.local ONLY — it is not
  // synced anywhere and never claims cross-device sync. The site's
  // add-by-URL wishlist form is where a saved page becomes a real
  // (optionally catalog-linked) wishlist item after sign-in.
  const renderSaved = (saved) => {
    savedList.innerHTML = '';
    if (!saved || saved.length === 0) {
      savedEmpty.style.display = '';
      return;
    }
    savedEmpty.style.display = 'none';
    saved.slice().reverse().slice(0, 10).forEach((item) => {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = item.url;
      a.target = '_blank';
      a.textContent = item.title || item.url;
      a.style.color = '#1e40af';
      li.appendChild(a);
      savedList.appendChild(li);
    });
  };

  chrome.storage.local.get(['smartbuySaved'], (stored) => {
    renderSaved(stored.smartbuySaved || []);
  });

  saveBtn.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab || !tab.url || !/^https?:/.test(tab.url)) return;
      chrome.storage.local.get(['smartbuySaved'], (stored) => {
        const saved = stored.smartbuySaved || [];
        if (saved.some((s) => s.url === tab.url)) {
          renderSaved(saved);
          return;
        }
        saved.push({ title: tab.title || tab.url, url: tab.url, savedAt: new Date().toISOString() });
        chrome.storage.local.set({ smartbuySaved: saved }, () => renderSaved(saved));
      });
    });
  });

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const url = tabs[0]?.url ?? '';
    const supported = ['amazon.com', 'walmart.com', 'bestbuy.com', 'ebay.com', 'aliexpress.com'];
    const isSupported = supported.some((s) => url.includes(s));

    if (isSupported) {
      statusDot.classList.remove('inactive');
      statusText.textContent = 'Monitoring product page';
    } else {
      statusDot.classList.add('inactive');
      statusText.textContent = 'Not a supported product page';
    }
  });

  searchBtn.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'manualSearch' });
    });
  });
});
