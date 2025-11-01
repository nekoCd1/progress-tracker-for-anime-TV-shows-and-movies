// AniCrush-specific tweaks (examples). Adjust selectors as site changes.
(function () {
  // reuse generic script functions if necessary
  // This script focuses on extracting episode info and cover on AniCrush pages
  function findVideoAndTrack() {
    const video = document.querySelector('video');
    if (!video) return;
    if (video._aniCrushTracker) return;
    video._aniCrushTracker = true;

    function getDetails() {
      // site-specific selectors (may need adjustment)
      const titleEl = document.querySelector('.anime-title') || document.querySelector('h1');
      const epEl = document.querySelector('.episode-title') || document.querySelector('.ep');
      const imgEl = document.querySelector('.poster img') || document.querySelector('meta[property="og:image"]');
      return {
        title: titleEl ? titleEl.innerText.trim() : document.title,
        episode: epEl ? epEl.innerText.trim() : '',
        cover: imgEl ? (imgEl.src || imgEl.content) : ''
      };
    }

    let lastSent = 0;
    function send() {
      const d = getDetails();
      const payload = {
        platform: 'AniCrush',
        title: d.title,
        episode: d.episode,
        time: video.currentTime,
        duration: video.duration || 0,
        url: location.href,
        cover: d.cover
      };
      chrome.runtime.sendMessage({ type: 'PROGRESS_UPDATE', payload });
    }

    // send initial
    send();
    video.addEventListener('timeupdate', () => {
      const now = Date.now();
      if (now - lastSent > 3000) {
        send();
        lastSent = now;
      }
    });

    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg && msg.type === 'SEEK_TO' && msg.payload && msg.payload.url && msg.payload.url === location.href) {
        const t = msg.payload.time;
        if (typeof t === 'number') {
          video.currentTime = t;
          sendResponse({ ok: true });
        }
      }
    });
  }

  findVideoAndTrack();
  new MutationObserver(findVideoAndTrack).observe(document.body || document.documentElement, { childList: true, subtree: true });
})();
