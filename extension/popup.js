document.addEventListener('DOMContentLoaded', () => {
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');
  const searchBtn = document.getElementById('search-btn');

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
