// Popup logic: shows stored progress, resume, like/dislike, export and mock login
document.addEventListener('DOMContentLoaded', () => {
  const listEl = document.getElementById('list');
  const btnLoginGoogle = document.getElementById('btn-login-google');
  const btnLoginMicrosoft = document.getElementById('btn-login-microsoft');
  const btnLogout = document.getElementById('btn-logout');
  const exportJson = document.getElementById('export-json');
  const exportCsv = document.getElementById('export-csv');
  const backendInput = document.getElementById('backendUrl');
  const saveBackend = document.getElementById('saveBackend');

  function formatTime(t) {
    if (!t && t !== 0) return '';
    const sec = Math.floor(t % 60).toString().padStart(2, '0');
    const min = Math.floor((t / 60) % 60).toString().padStart(2, '0');
    const hrs = Math.floor(t / 3600).toString().padStart(2, '0');
    return hrs + ':' + min + ':' + sec;
  }

  function render() {
    chrome.storage.local.get(['progress', 'userId', 'backendUrl', 'authToken'], (store) => {
      const progress = store.progress || {};
      listEl.innerHTML = '';
      Object.keys(progress).forEach((key) => {
        const e = progress[key];
        const item = document.createElement('div');
        item.className = 'item';

        const thumb = document.createElement('div');
        thumb.className = 'thumb';
        if (e.cover) thumb.style.backgroundImage = `url(${e.cover})`;

        const meta = document.createElement('div');
        meta.className = 'meta';
        const title = document.createElement('h3');
        title.innerText = e.title;
        const ep = document.createElement('p');
        ep.innerText = `${e.episode || ''} • ${formatTime(e.time)} / ${formatTime(e.duration)}`;

        const controls = document.createElement('div');
        controls.className = 'controls';

        const resume = document.createElement('button');
        resume.className = 'btn';
        resume.innerText = 'Resume';
        resume.onclick = () => {
          // find tab matching URL and send SEEK_TO
          if (!e.url) return alert('No URL saved for this item');
          chrome.tabs.query({}, (tabs) => {
            const tab = tabs.find(t => t.url && t.url.startsWith(e.url.split('#')[0]));
            if (tab) {
              chrome.runtime.sendMessage({ type: 'SEEK_TO_TAB', payload: { tabId: tab.id, url: e.url, time: e.time } }, (resp) => {
                console.log('seek resp', resp);
              });
            } else {
              // open new tab
              chrome.tabs.create({ url: e.url }, (newTab) => {
                // wait a bit and send seek
                setTimeout(() => {
                  chrome.runtime.sendMessage({ type: 'SEEK_TO_TAB', payload: { tabId: newTab.id, url: e.url, time: e.time } }, (resp) => console.log('seek after open', resp));
                }, 2000);
              });
            }
          });
        };

        const like = document.createElement('button');
        like.className = 'btn';
        like.innerText = e.liked ? 'Unlike' : 'Like';
        like.onclick = () => {
          chrome.storage.local.get('progress', (s) => {
            const progress = s.progress || {};
            progress[key].liked = !progress[key].liked;
            chrome.storage.local.set({ progress }, () => { render(); });
          });
        };

        controls.appendChild(resume);
        controls.appendChild(like);

        meta.appendChild(title);
        meta.appendChild(ep);
        meta.appendChild(controls);

        item.appendChild(thumb);
        item.appendChild(meta);
        listEl.appendChild(item);
      });

      // auth state
      if (store.userId) {
        if (btnLoginGoogle) btnLoginGoogle.style.display = 'none';
        if (btnLoginMicrosoft) btnLoginMicrosoft.style.display = 'none';
        btnLogout.style.display = '';
      } else {
        if (btnLoginGoogle) btnLoginGoogle.style.display = '';
        if (btnLoginMicrosoft) btnLoginMicrosoft.style.display = '';
        btnLogout.style.display = 'none';
      }

      backendInput.value = store.backendUrl || '';
    });
  }

  function launchAuth(provider) {
    chrome.storage.local.get('backendUrl', (s) => {
      const backend = (s.backendUrl || document.getElementById('backendUrl').value || '').replace(/\/$/, '');
      if (!backend) return alert('Set backend URL in the popup first');
      const authUrl = backend + (provider === 'microsoft' ? '/auth/microsoft' : '/auth/google');
      // Use chrome.identity.launchWebAuthFlow to capture redirect
      const flowUrl = authUrl;
      chrome.identity.launchWebAuthFlow({ url: flowUrl, interactive: true }, (redirectUrl) => {
        if (chrome.runtime.lastError) return alert('Auth failed: ' + chrome.runtime.lastError.message);
        if (!redirectUrl) return alert('No redirect URL returned');
        // parse fragment for token
        try {
          const hash = redirectUrl.split('#')[1] || '';
          const params = new URLSearchParams(hash);
          const token = params.get('token');
          const userId = params.get('userId');
          if (token && userId) {
            chrome.storage.local.set({ authToken: token, userId }, () => { render(); alert('Logged in'); });
          } else {
            alert('Login failed: token not found in redirect');
          }
        } catch (e) { alert('Auth parse failed: ' + e.message); }
      });
    });
  }

  if (btnLoginGoogle) btnLoginGoogle.addEventListener('click', () => launchAuth('google'));
  if (btnLoginMicrosoft) btnLoginMicrosoft.addEventListener('click', () => launchAuth('microsoft'));

  btnLogout.addEventListener('click', () => {
    chrome.storage.local.remove(['authToken', 'userId'], () => render());
  });

  exportJson.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'EXPORT' }, (resp) => {
      if (resp && resp.data) {
        const url = URL.createObjectURL(new Blob([JSON.stringify(resp.data, null, 2)], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url; a.download = 'watch-progress.json'; a.click();
      }
    });
  });

  exportCsv.addEventListener('click', () => {
    chrome.storage.local.get('progress', (store) => {
      const p = store.progress || {};
      const rows = ['platform,title,episode,time,duration,liked,cover,url,lastUpdated'];
      Object.values(p).forEach(e => rows.push(`${e.platform},"${(e.title||'').replace(/"/g,'""')}","${(e.episode||'').replace(/"/g,'""')}",${e.time||0},${e.duration||0},${e.liked?1:0},${e.cover||''},${e.url||''},${e.lastUpdated||0}`));
      const url = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv' }));
      const a = document.createElement('a'); a.href = url; a.download = 'watch-progress.csv'; a.click();
    });
  });

  saveBackend.addEventListener('click', () => {
    const val = backendInput.value.trim();
    chrome.storage.local.set({ backendUrl: val }, () => alert('Saved')); 
  });

  render();
  // refresh every few seconds to show live progress
  setInterval(render, 3000);
});
