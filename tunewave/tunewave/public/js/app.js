(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (sec) => { sec = Math.max(0, Math.round(sec || 0)); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; };
  const hex = (v, d) => (/^#[0-9a-f]{3,8}$/i.test(v || '') ? v : d);

  async function api(path, opts = {}) {
    let res;
    try {
      res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
    } catch {
      const e = new Error('Network error. Check your connection and try again.');
      e.code = 'NETWORK';
      throw e;
    }
    let data = null;
    try { data = await res.json(); } catch { /* not JSON */ }
    if (!res.ok) {
      const info = (data && data.error) || {};
      const e = new Error(info.message || `Request failed (${res.status})`);
      e.status = res.status;
      e.code = info.code || String(res.status);
      throw e;
    }
    return data;
  }

  function toast(msg) {
    let t = $('#toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'toast';
      t.className = 'toast';
      t.setAttribute('role', 'status');
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove('show'), 4200);
  }

  window.TW = { api, esc, toast };

  /* ---------- shell: sidebar, top bar, player ---------- */

  const LOGO = '<svg viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff5c7a"/><stop offset="1" stop-color="#ffb340"/></linearGradient></defs><rect width="32" height="32" rx="9" fill="url(#lg)"/><path d="M5 18c3-8 5-8 8 0s5 8 8 0 4-6 6-3" fill="none" stroke="#2a1020" stroke-width="2.6" stroke-linecap="round"/></svg>';
  const NAV = [
    ['/', 'Home', 'home'],
    ['/discover', 'Discover', 'discover'],
    ['/faq', 'FAQ', 'faq'],
    ['/support', 'Support', 'support'],
    ['/errors', 'Error codes', 'errors'],
    ['/health', 'Status', 'health'],
  ];

  function buildShell() {
    const page = document.body.dataset.page;
    document.body.insertAdjacentHTML('afterbegin', `
      <div class="topbar">
        <button class="burger" id="burger" aria-label="Open menu" aria-expanded="false">&#9776;</button>
        <a class="brand" href="/">${LOGO}TuneWave</a>
      </div>
      <aside class="sidebar" id="sidebar" aria-label="Main navigation">
        <a class="brand" href="/">${LOGO}TuneWave</a>
        <nav>${NAV.map(([href, label, key]) => `<a href="${href}" class="${key === page ? 'active' : ''}"${key === page ? ' aria-current="page"' : ''}>${label}</a>`).join('')}</nav>
        <p class="side-note">Demo project. Previews come from the iTunes Search API.</p>
      </aside>`);
    document.body.insertAdjacentHTML('beforeend', `
      <div class="player" id="player" hidden>
        <div class="p-info"><div class="cover" id="pArt"></div><div><strong id="pTitle"></strong><small id="pArtist"></small></div></div>
        <div class="p-ctrl">
          <button id="pToggle" aria-label="Play or pause">&#9654;</button>
          <div class="bar" aria-hidden="true"><div id="pBar"></div></div>
          <span id="pTime">0:00</span>
        </div>
      </div>`);
    $('#burger').addEventListener('click', () => {
      const open = $('#sidebar').classList.toggle('open');
      $('#burger').setAttribute('aria-expanded', String(open));
    });
    $('#sidebar').addEventListener('click', (e) => { if (e.target.closest('a')) $('#sidebar').classList.remove('open'); });
  }

  /* ---------- player: real previews (iTunes) or a generated demo melody (offline catalogue) ---------- */

  const audio = new Audio();
  audio.preload = 'none';
  let ctx = null;
  let synth = null;

  function setPlaying(on) {
    $('#pToggle').innerHTML = on ? '&#10074;&#10074;' : '&#9654;';
    document.body.classList.toggle('is-playing', on);
  }
  function setProgress(done, total) {
    $('#pBar').style.width = `${total ? Math.min(100, (done / total) * 100) : 0}%`;
    $('#pTime').textContent = fmt(done);
  }
  function stopAll() {
    audio.pause();
    if (synth) {
      clearInterval(synth.timer);
      synth.nodes.forEach((o) => { try { o.stop(); } catch { /* already stopped */ } });
      synth.master.disconnect();
      synth = null;
    }
    setProgress(0, 0);
  }

  function startSynth(seed, durationSec) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error('This browser cannot play audio.');
    ctx = ctx || new AC();
    if (ctx.resume) ctx.resume();
    const master = ctx.createGain();
    master.gain.value = 0.12;
    master.connect(ctx.destination);

    let r = (seed >>> 0) || 1;
    const rnd = () => { r = (Math.imul(r, 1664525) + 1013904223) >>> 0; return r / 4294967296; };
    const scale = [0, 2, 3, 5, 7, 8, 10, 12];
    const root = 130.81 * Math.pow(2, Math.floor(rnd() * 7) / 12);
    const step = 0.25 + rnd() * 0.15;
    const t0 = ctx.currentTime + 0.05;
    const nodes = [];
    for (let i = 0; i < Math.floor(durationSec / step); i++) {
      const deg = scale[Math.floor(rnd() * scale.length)];
      if (rnd() < 0.2) continue;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const t = t0 + i * step;
      o.type = i % 4 === 0 ? 'triangle' : 'sine';
      o.frequency.value = root * Math.pow(2, deg / 12) * (i % 8 === 0 ? 0.5 : 1);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(1, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + step * 0.95);
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + step);
      nodes.push(o);
    }
    synth = {
      master, nodes,
      timer: setInterval(() => {
        const el = ctx.currentTime - t0;
        setProgress(el, durationSec);
        if (el >= durationSec) { stopAll(); setPlaying(false); }
      }, 200),
    };
  }

  function coverHtml(t, cls = 'cover') {
    if (t.artwork) return `<div class="${cls}"><img loading="lazy" src="${esc(t.artwork)}" alt=""></div>`;
    const c1 = hex(t.color1, '#5b3df5');
    const c2 = hex(t.color2, '#ff5c7a');
    return `<div class="${cls}" style="background:linear-gradient(135deg,${c1},${c2})" aria-hidden="true">&#9834;</div>`;
  }

  async function play(track) {
    stopAll();
    const p = $('#player');
    p.hidden = false;
    $('#pTitle').textContent = track.title;
    $('#pArtist').textContent = track.artist;
    const art = $('#pArt');
    art.className = 'cover';
    art.style.background = '';
    art.innerHTML = coverHtml(track).replace(/^<div[^>]*>|<\/div>$/g, '');
    if (!track.artwork) art.style.background = `linear-gradient(135deg,${hex(track.color1, '#5b3df5')},${hex(track.color2, '#ff5c7a')})`;
    $('#pTime').textContent = '0:00';
    try {
      if (track.previewUrl) {
        audio.src = track.previewUrl;
        await audio.play();
      } else {
        const info = await api(`/api/tracks/${track.localId}/preview`);
        startSynth(info.seed, info.durationSec);
      }
      setPlaying(true);
    } catch (e) {
      setPlaying(false);
      toast(e.status ? `${e.code}: ${e.message}` : 'Playback did not start. Press play to try again.');
    }
  }

  function wirePlayer() {
    audio.addEventListener('timeupdate', () => setProgress(audio.currentTime, audio.duration || 30));
    audio.addEventListener('ended', () => setPlaying(false));
    $('#pToggle').addEventListener('click', () => {
      if (synth) {
        if (ctx.state === 'running') { ctx.suspend(); setPlaying(false); } else { ctx.resume(); setPlaying(true); }
      } else if (audio.src) {
        if (audio.paused) { audio.play().then(() => setPlaying(true)).catch(() => {}); } else { audio.pause(); setPlaying(false); }
      }
    });
  }

  /* ---------- track lists ---------- */

  const registry = new Map();
  const cardHtml = (t) => {
    registry.set(t.id, t);
    return `<div class="card" role="button" tabindex="0" data-play="${esc(t.id)}" aria-label="Play ${esc(t.title)} by ${esc(t.artist)}">${coverHtml(t)}<strong>${esc(t.title)}</strong><small>${esc(t.artist)}</small></div>`;
  };
  const rowHtml = (t, i) => {
    registry.set(t.id, t);
    const flag = t.source === 'local' && t.available === false ? '<span class="badge warn">TW-701</span>' : '<span></span>';
    return `<div class="row" role="button" tabindex="0" data-play="${esc(t.id)}" aria-label="Play ${esc(t.title)} by ${esc(t.artist)}"><span class="idx">${i + 1}</span>${coverHtml(t, 'cover sm')}<span class="meta"><strong>${esc(t.title)}</strong><small>${esc(t.artist)}${t.album ? ' - ' + esc(t.album) : ''}</small></span><span class="dur">${fmt(t.duration)}</span>${flag}</div>`;
  };

  function setBadge(el, data) {
    if (!el) return;
    if (data.source === 'itunes') {
      el.className = 'badge ok';
      el.textContent = `Live from iTunes${data.cached ? ' (cached)' : ''}`;
    } else {
      el.className = 'badge warn';
      el.textContent = `Offline catalogue: ${data.reason === 'timeout' ? 'live search timed out' : 'live search unavailable'}`;
    }
  }

  async function showTracks({ target, badge, query, layout }) {
    const box = $(target);
    box.innerHTML = '<p class="muted">Loading tracks...</p>';
    try {
      const data = await api(`/api/discover/search${query ? `?q=${encodeURIComponent(query)}` : ''}`);
      setBadge($(badge), data);
      box.innerHTML = data.tracks.length
        ? data.tracks.map((t, i) => (layout === 'row' ? rowHtml(t, i) : cardHtml(t))).join('')
        : '<p class="muted">Nothing matched that search. Try an artist, a song or a genre.</p>';
    } catch (e) {
      box.innerHTML = `<p class="err">Tracks could not load (${esc(e.code)}). <a href="#" data-ask="I saw error ${esc(e.code)} while loading tracks. What does it mean?" data-send="1">Ask the assistant</a></p>`;
    }
  }

  /* ---------- pages ---------- */

  function initHome() {
    showTracks({ target: '#trending', badge: '#trendBadge', layout: 'card' });
  }

  function initDiscover() {
    const input = $('#q');
    const run = (q) => {
      input.value = q;
      $('#resTitle').textContent = q ? `Results for "${q}"` : 'Trending now';
      showTracks({ target: '#results', badge: '#resBadge', query: q, layout: 'row' });
    };
    $('#searchForm').addEventListener('submit', (e) => { e.preventDefault(); run(input.value.trim()); });
    $('#genreChips').addEventListener('click', (e) => { const b = e.target.closest('[data-q]'); if (b) run(b.dataset.q); });
    run(new URLSearchParams(location.search).get('q') || '');
  }

  async function initFaq() {
    const box = $('#faqList');
    try {
      const { faqs } = await api('/api/faqs');
      const groups = {};
      faqs.forEach((f) => { (groups[f.category] = groups[f.category] || []).push(f); });
      box.innerHTML = Object.entries(groups).map(([cat, items]) =>
        `<h2 class="cat">${esc(cat)}</h2>` + items.map((f) =>
          `<details class="faq" data-q="${esc((f.question + ' ' + f.keywords + ' ' + f.answer).toLowerCase())}"><summary>${esc(f.question)}</summary><p>${esc(f.answer)}</p></details>`).join('')
      ).join('');
      $('#faqCount').textContent = `${faqs.length} questions`;
    } catch (e) {
      box.innerHTML = `<p class="err">The FAQ could not load (${esc(e.code)}). <a href="#" data-ask="The FAQ page failed with error ${esc(e.code)}. What does it mean?" data-send="1">Ask the assistant</a></p>`;
      return;
    }
    $('#faqFilter').addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      box.querySelectorAll('details.faq').forEach((d) => { d.hidden = q && !d.dataset.q.includes(q); });
      box.querySelectorAll('h2.cat').forEach((h) => {
        let n = h.nextElementSibling; let any = false;
        while (n && n.tagName !== 'H2') { if (!n.hidden) any = true; n = n.nextElementSibling; }
        h.hidden = !any;
      });
    });
  }

  function initSupport() {
    const form = $('#ticketForm');
    const msg = $('#ticketMsg');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      msg.className = '';
      msg.textContent = 'Sending...';
      try {
        const r = await api('/api/tickets', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) });
        msg.className = 'ok';
        msg.textContent = `Ticket ${r.reference} created. We will reply by email.`;
        form.reset();
      } catch (err) {
        msg.className = 'err';
        msg.textContent = `Error ${err.code}: ${err.message}`;
      } finally {
        btn.disabled = false;
      }
    });
  }

  async function initErrors() {
    const box = $('#codeList');
    try {
      const { codes } = await api('/api/error-codes');
      box.innerHTML = codes.map((c) => `
        <article class="code-card" id="code-${esc(c.code)}">
          <div class="code-num">${esc(c.code)}</div>
          <h3>${esc(c.name)} <span class="badge">HTTP ${c.http_status}</span></h3>
          <dl><dt>What it means</dt><dd>${esc(c.meaning)}</dd><dt>How to fix it</dt><dd>${esc(c.how_to_fix)}</dd></dl>
          <div class="actions">
            <button class="btn ghost" type="button" data-demo="${esc(c.code)}">Try it</button>
            <button class="btn ghost" type="button" data-ask="What does error ${esc(c.code)} mean?" data-send="1">Ask the assistant</button>
          </div>
          <pre class="out" hidden></pre>
        </article>`).join('');
      if (location.hash) { const el = document.getElementById(location.hash.slice(1)); if (el) el.scrollIntoView(); }
    } catch (e) {
      box.innerHTML = `<p class="err">Error codes could not load (${esc(e.code)}).</p>`;
    }
    box.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-demo]');
      if (!b) return;
      const out = b.closest('.code-card').querySelector('pre');
      out.hidden = false;
      out.textContent = 'Requesting...';
      try {
        const r = await fetch(`/api/demo-error/${encodeURIComponent(b.dataset.demo)}`);
        out.textContent = `HTTP ${r.status}\n${JSON.stringify(await r.json(), null, 2)}`;
      } catch { out.textContent = 'Network error'; }
    });
  }

  function initHealth() {
    const up = (s) => (s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`);
    const stat = (label, value, cls) => `<div class="stat ${cls}"><small>${esc(label)}</small><strong>${esc(value)}</strong></div>`;
    async function draw() {
      let d;
      try { d = await (await fetch('/api/health')).json(); } catch {
        $('#healthGrid').innerHTML = stat('Server', 'Unreachable', 'bad');
        return;
      }
      const c = d.checks;
      const overall = { ok: ['All systems running', 'good'], degraded: ['Running with limits', 'warn'], down: ['Down', 'bad'] }[d.status];
      $('#healthGrid').innerHTML = [
        stat('Overall', overall[0], overall[1]),
        stat('Uptime', up(d.uptimeSec), 'good'),
        stat('SQL database', c.sql.ok ? `OK (${c.sql.latencyMs} ms)` : 'Down', c.sql.ok ? 'good' : 'bad'),
        stat('MongoDB', c.mongo.ok ? `OK (${c.mongo.latencyMs} ms)` : (c.mongo.configured ? 'Unreachable' : 'Not configured'), c.mongo.ok ? 'good' : 'warn'),
        stat('iTunes Search API', c.externalApi.ok === null ? 'Not used yet' : c.externalApi.ok ? `OK (${c.externalApi.lastLatencyMs} ms)` : 'Using fallback', c.externalApi.ok === false ? 'warn' : 'good'),
        stat('AI assistant', c.ai.configured ? 'Claude connected' : 'FAQ matcher only', c.ai.configured ? 'good' : 'warn'),
      ].join('');
      $('#reqBody').innerHTML = d.recentRequests.map((r) =>
        `<tr><td>${esc(new Date(r.time).toLocaleTimeString())}</td><td>${esc(r.method)}</td><td>${esc(r.path)}</td><td>${r.status}</td><td>${r.ms} ms</td></tr>`).join('')
        || '<tr><td colspan="5" class="muted">No requests yet.</td></tr>';
      $('#updated').textContent = `Updated ${new Date().toLocaleTimeString()}`;
    }
    draw();
    setInterval(draw, 10000);
  }

  /* ---------- boot ---------- */

  buildShell();
  wirePlayer();

  document.addEventListener('click', (e) => {
    const p = e.target.closest('[data-play]');
    if (p) { const t = registry.get(p.dataset.play); if (t) play(t); return; }
    const a = e.target.closest('[data-ask]');
    if (a) {
      e.preventDefault();
      if (window.TuneChat) window.TuneChat.open(a.dataset.ask, a.dataset.send === '1');
    }
  });
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[data-play]')) { e.preventDefault(); e.target.click(); }
  });

  const page = document.body.dataset.page;
  ({ home: initHome, discover: initDiscover, faq: initFaq, support: initSupport, errors: initErrors, health: initHealth }[page] || (() => {}))();
})();
