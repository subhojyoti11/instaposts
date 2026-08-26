/*
  Ravenex cross-device "done" sync.
  Stores which posts are marked done in data/donePosts.json in this same
  GitHub repo, read/written via the GitHub Contents API, so the checklist
  looks the same on your phone and on desktop.

  SETUP (one time):
  1. GitHub -> Settings -> Developer settings -> Personal access tokens ->
     Fine-grained tokens -> Generate new token.
  2. Repository access: Only select repositories -> this repo only.
  3. Permissions -> Repository permissions -> Contents: Read and write.
  4. Paste the generated token below as GH_TOKEN.

  This token lives in a public JS file served by GitHub Pages, so anyone who
  views source can see and use it. It is scoped to ONLY this repo's contents,
  so the worst case is someone edits this repo's files, nothing else on your
  account is reachable with it. Rotate/regenerate the token if that ever happens.
*/
(function () {
  'use strict';

  const GH_OWNER = 'subhojyoti11';
  const GH_REPO = 'instaposts';
  const GH_BRANCH = 'main';
  const GH_PATH = 'data/donePosts.json';
  const GH_TOKEN = 'PASTE_YOUR_FINE_GRAINED_TOKEN_HERE';

  const API_BASE = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${GH_PATH}`;
  const LOCAL_KEY = 'donePostsCache';
  const tokenConfigured = !!GH_TOKEN && !GH_TOKEN.startsWith('PASTE_');

  function b64DecodeUnicode(str) {
    return decodeURIComponent(
      atob(str.replace(/\n/g, ''))
        .split('')
        .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
  }
  function b64EncodeUnicode(str) {
    return btoa(
      encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, p1) => String.fromCharCode('0x' + p1))
    );
  }

  function readLocalCache() {
    try {
      const raw = localStorage.getItem(LOCAL_KEY);
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch (e) { return new Set(); }
  }
  function writeLocalCache(set) {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify([...set])); } catch (e) {}
  }

  let remoteSha = null;

  function authHeaders(extra) {
    const headers = Object.assign({ 'Accept': 'application/vnd.github+json' }, extra || {});
    if (tokenConfigured) headers['Authorization'] = 'Bearer ' + GH_TOKEN;
    return headers;
  }

  async function fetchRemote() {
    const res = await fetch(API_BASE + '?ref=' + GH_BRANCH, { headers: authHeaders() });
    if (!res.ok) throw new Error('GitHub fetch failed: ' + res.status);
    const data = await res.json();
    remoteSha = data.sha;
    const parsed = JSON.parse(b64DecodeUnicode(data.content));
    return new Set(parsed.done || []);
  }

  async function pushRemote(doneSet, isRetry) {
    if (!tokenConfigured) throw new Error('No GitHub token configured in sync.js');
    const body = {
      message: 'Update donePosts.json',
      content: b64EncodeUnicode(JSON.stringify({ done: [...doneSet].sort((a, b) => a - b) }, null, 2)),
      branch: GH_BRANCH,
      sha: remoteSha
    };
    const res = await fetch(API_BASE, {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body)
    });
    if (res.status === 409 && !isRetry) {
      await fetchRemote();
      return pushRemote(doneSet, true);
    }
    if (!res.ok) throw new Error('GitHub push failed: ' + res.status);
    const data = await res.json();
    remoteSha = data.content.sha;
  }

  const listeners = [];
  const RavenexSync = {
    doneSet: readLocalCache(),
    tokenConfigured,
    onChange(fn) { listeners.push(fn); },
    notify() { listeners.forEach(fn => fn(RavenexSync.doneSet)); },
    isDone(n) { return RavenexSync.doneSet.has(n); },

    async init() {
      RavenexSync.notify();
      try {
        const remoteSet = await fetchRemote();
        RavenexSync.doneSet = remoteSet;
        writeLocalCache(remoteSet);
        RavenexSync.notify();
      } catch (e) {
        console.warn('Ravenex sync: showing local cache only, remote fetch failed', e);
      }
    },

    async toggle(n) {
      const willBeDone = !RavenexSync.doneSet.has(n);
      applyLocal(willBeDone);
      try {
        if (remoteSha === null) await fetchRemote();
        applyLocal(willBeDone);
        await pushRemote(RavenexSync.doneSet);
        writeLocalCache(RavenexSync.doneSet);
      } catch (e) {
        console.warn('Ravenex sync: change kept locally only, push failed', e);
      }

      function applyLocal(done) {
        if (done) RavenexSync.doneSet.add(n); else RavenexSync.doneSet.delete(n);
        writeLocalCache(RavenexSync.doneSet);
        RavenexSync.notify();
      }
    }
  };
  window.RavenexSync = RavenexSync;

  function currentPostNumber() {
    const m = location.pathname.match(/post(\d+)\.html?$/i);
    return m ? parseInt(m[1], 10) : null;
  }

  function injectPostedButton() {
    const n = currentPostNumber();
    if (!n) return;
    const bar = document.querySelector('.dl-bar');
    if (!bar) return;

    if (!document.getElementById('ravenex-posted-style')) {
      const style = document.createElement('style');
      style.id = 'ravenex-posted-style';
      style.textContent =
        '.posted-btn.is-posted { background: rgba(52,211,153,.14) !important; ' +
        'border-color: rgba(52,211,153,.55) !important; color: #34d399 !important; }';
      document.head.appendChild(style);
    }

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'postedBtn';
    const existing = document.getElementById('dlCurrent');
    btn.className = existing ? existing.className.replace(/\balt\b/g, '').trim() : 'dl-btn';
    btn.classList.add('posted-btn');

    const checkSVG = '<svg viewBox="0 0 24 24" style="width:12px;height:12px;fill:none;stroke:currentColor;' +
      'stroke-width:2;stroke-linecap:round;stroke-linejoin:round"><polyline points="20 6 9 17 4 12"/></svg>';

    function render() {
      const done = RavenexSync.isDone(n);
      btn.innerHTML = checkSVG + (done ? 'Posted' : 'Mark Posted');
      btn.classList.toggle('is-posted', done);
    }
    render();

    btn.addEventListener('click', async () => {
      btn.disabled = true;
      await RavenexSync.toggle(n);
      btn.disabled = false;
    });
    RavenexSync.onChange(render);

    const allBtn = document.getElementById('dlAll');
    if (allBtn) bar.insertBefore(btn, allBtn); else bar.appendChild(btn);
  }

  document.addEventListener('DOMContentLoaded', () => {
    RavenexSync.init();
    injectPostedButton();
  });
})();
