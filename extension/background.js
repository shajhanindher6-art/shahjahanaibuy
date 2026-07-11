// SmartBuy AI — Background service worker
// Handles extension lifecycle and communication

chrome.runtime.onInstalled.addListener(() => {
  console.log('SmartBuy AI extension installed');
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'manualSearch') {
    // Re-trigger content script check
    sendResponse({ ok: true });
  }
});
