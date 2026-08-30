// Background service worker for the GimmeSummary extension

chrome.runtime.onInstalled.addListener(() => {
  console.log('GimmeSummary extension installed successfully.');
  
  // Register context menu for links that look like PDFs
  chrome.contextMenus.create({
    id: 'summarize-pdf-link',
    title: 'Summarize PDF Link with GimmeSummary',
    contexts: ['link'],
    targetUrlPatterns: [
      '*://*/*.pdf*', 
      '*://*/*.PDF*',
      '*://*/*pdf*', // catch some dynamic endpoints
    ]
  });

  // Register context menu for the page itself
  chrome.contextMenus.create({
    id: 'summarize-page',
    title: 'Summarize Current Page with GimmeSummary',
    contexts: ['page', 'action']
  });
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  let pdfUrl = '';
  
  if (info.menuItemId === 'summarize-pdf-link' && info.linkUrl) {
    pdfUrl = info.linkUrl;
  } else if (info.menuItemId === 'summarize-page') {
    pdfUrl = tab?.url || info.pageUrl || '';
  }
  
  if (pdfUrl) {
    // Open the full dashboard, passing the target PDF URL as a query param
    const dashboardUrl = chrome.runtime.getURL(`dashboard.html?pdfUrl=${encodeURIComponent(pdfUrl)}`);
    chrome.tabs.create({ url: dashboardUrl });
  }
});

// A listener for extension messaging (e.g. from content scripts or popup)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'OPEN_DASHBOARD') {
    const pdfUrl = message.pdfUrl;
    // Open full target URL if specified, otherwise construct default
    const url = message.url ? chrome.runtime.getURL(message.url) : chrome.runtime.getURL(
      pdfUrl ? `dashboard.html?pdfUrl=${encodeURIComponent(pdfUrl)}` : 'dashboard.html'
    );
    chrome.tabs.create({ url });
    sendResponse({ success: true });
  }
  return true;
});

