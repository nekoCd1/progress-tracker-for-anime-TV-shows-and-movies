// Background service worker (MV3) - receives progress updates and syncs locally and to backend
const SYNC_INTERVAL = 5000; // flush to backend every 5s if updates exist

let pendingSync = {};
let lastSyncAt = 0;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;
  if (msg.type === 'PROGRESS_UPDATE') {
    handleProgress(msg.payload, sender.tab);
  } else if (msg.type === 'GET_STORE') {
    chrome.storage.local.get(null, (data) => sendResponse({ ok: true, data }));
    return true;
  } else if (msg.type === 'SEEK_TO_TAB') {
    // send message to tab to seek
    const tabId = msg.payload.tabId;
    chrome.tabs.sendMessage(tabId, { type: 'SEEK_TO', payload: msg.payload }, (resp) => sendResponse(resp));
    return true;
  }
});

function handleProgress(payload, tab) {
  if (!payload || !payload.title) return;
  // get current user
  chrome.storage.local.get(['userId', 'progress'], (store) => {
    const userId = store.userId || 'local';
    const platform = payload.platform || 'unknown';
    const key = `${userId}:${platform}:${payload.title}`;

    const entry = {
      title: payload.title,
      episode: payload.episode || '',
      time: payload.time || 0,
      duration: payload.duration || 0,
      liked: (store.progress && store.progress[key] && store.progress[key].liked) || false,
      cover: payload.cover || '',
      url: payload.url || (tab && tab.url) || '' ,
      lastUpdated: Date.now(),
      platform
    };

    const progress = store.progress || {};
    progress[key] = entry;

    chrome.storage.local.set({ progress }, () => {
      // queue for backend sync
      pendingSync[key] = entry;
    });
  });
}

// Periodic sync to backend
setInterval(() => {
  const keys = Object.keys(pendingSync);
  if (keys.length === 0) return;
  chrome.storage.local.get(['backendUrl', 'authToken', 'userId'], (store) => {
    const backendUrl = store.backendUrl || null;
    const authToken = store.authToken || null;
    if (!backendUrl) {
      // nothing to do, just clear pending (keep local though)
      pendingSync = {};
      return;
    }
    const payload = Object.values(pendingSync);
    // send to backend
    fetch(backendUrl.replace(/\/$/, '') + '/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authToken ? `Bearer ${authToken}` : ''
      },
      body: JSON.stringify({ items: payload })
    }).then((r) => {
      if (r.status === 401) {
        // unauthorized - clear stored token and pendingSync
        chrome.storage.local.remove(['authToken', 'userId'], () => {
          pendingSync = {};
        });
        return null;
      }
      return r.json();
    }).then((json) => {
      if (!json) return;
      // On success, clear pending
      pendingSync = {};
      lastSyncAt = Date.now();
    }).catch((err) => {
      console.warn('Sync failed', err);
    });
  });
}, SYNC_INTERVAL);

// Expose helper for popup to export data
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'EXPORT') {
    chrome.storage.local.get(null, (data) => {
      sendResponse({ ok: true, data });
    });
    return true;
  }
});
