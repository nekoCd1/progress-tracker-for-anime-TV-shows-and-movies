// Generic HTML5 video tracker for multiple streaming platforms
(function () {
  function findVideos() {
    return Array.from(document.querySelectorAll('video'));
  }

  function getTitleInfo() {
    // try to extract a page title or meta
    let title = document.title || '';
    // try JSON-LD or meta
    const metaOg = document.querySelector('meta[property="og:title"]');
    if (metaOg && metaOg.content) title = metaOg.content;
    return { title };
  }

  function serializeProgress(platform) {
    const info = getTitleInfo();
    const videos = findVideos();
    videos.forEach((video, idx) => {
      if (video._progressTrackerInstalled) return;
      video._progressTrackerInstalled = true;

      function sendProgress() {
        const payload = {
          platform: platform || location.hostname,
          title: info.title,
          episode: (document.querySelector('.episode') && document.querySelector('.episode').innerText) || '',
          time: video.currentTime,
          duration: video.duration || 0,
          url: location.href,
          cover: (document.querySelector('meta[property="og:image"]') || {}).content || ''
        };
        chrome.runtime.sendMessage({ type: 'PROGRESS_UPDATE', payload });
      }

      // Send initial
      sendProgress();

      // Throttle updates to every 3 seconds
      let lastSent = 0;
      video.addEventListener('timeupdate', () => {
        const now = Date.now();
        if (now - lastSent > 3000) {
          sendProgress();
          lastSent = now;
        }
      });

      // Listen for messages such as SEEK_TO
      chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg && msg.type === 'SEEK_TO' && msg.payload && msg.payload.url && msg.payload.url === location.href) {
          const t = msg.payload.time;
          if (typeof t === 'number') {
            video.currentTime = t;
            sendResponse({ ok: true });
          }
        }
      });
    });
  }

  // run at load and periodically (single page apps)
  serializeProgress();
  const observer = new MutationObserver(() => serializeProgress());
  observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
})();
