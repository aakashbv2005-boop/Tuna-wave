(() => {
  'use strict';
  const { api, esc } = window.TW;
  const KEY = 'tw_chat_v1';

  const sid = sessionStorage.getItem('tw_sid') || (() => {
    const v = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Math.random()).slice(2);
    sessionStorage.setItem('tw_sid', v);
    return v;
  })();

  let state = { msgs: [], open: false };
  try { state = { ...state, ...JSON.parse(sessionStorage.getItem(KEY) || '{}') }; } catch { /* ignore */ }
  const save = () => sessionStorage.setItem(KEY, JSON.stringify({ msgs: state.msgs.slice(-30), open: state.open }));

  document.body.insertAdjacentHTML('beforeend', `
    <button class="chat-fab" id="chatFab" aria-label="Open the support assistant">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L3 20.5l1.5-4.9A8 8 0 1 1 21 12z"/></svg>
    </button>
    <section class="chat" id="chat" hidden role="dialog" aria-label="TuneWave support assistant">
      <header><strong>TuneWave assistant</strong><button id="chatClose" aria-label="Close the assistant">&#10005;</button></header>
      <div class="chat-body" id="chatBody" aria-live="polite"></div>
      <div class="chat-email"><input id="chatEmail" type="email" placeholder="Your email, if we need to open a ticket (optional)" aria-label="Email for ticket updates" autocomplete="email"></div>
      <form id="chatForm"><input id="chatInput" maxlength="500" placeholder="Ask about plans, playback or error codes" aria-label="Your message" autocomplete="off"><button type="submit">Send</button></form>
    </section>`);

  const $ = (s) => document.getElementById(s);
  const panel = $('chat'), fab = $('chatFab'), body = $('chatBody'), input = $('chatInput'), email = $('chatEmail');
  try { email.value = localStorage.getItem('tw_email') || ''; } catch { /* ignore */ }

  const SUGGESTIONS = ['How do I reset my password?', 'What does error 429 mean?', 'Can I listen offline?'];

  function render() {
    let html = '';
    if (!state.msgs.length) {
      html += `<div class="msg bot">Hi! I answer from our help articles and explain error codes. If I can't help, I'll open a support ticket for you.</div>
               <div class="suggest">${SUGGESTIONS.map((s) => `<button type="button" class="chip" data-s="${esc(s)}">${esc(s)}</button>`).join('')}</div>`;
    }
    state.msgs.forEach((m, i) => {
      const text = esc(m.text).replace(/\n/g, '<br>');
      if (m.role === 'user') { html += `<div class="msg me">${text}</div>`; return; }
      html += `<div class="msg bot">${text}${m.ticket ? `<br><span class="ticket">Ticket ${esc(m.ticket)}</span>` : ''}`;
      if (m.id) {
        html += m.rated
          ? '<div class="fb">Thanks for the feedback.</div>'
          : `<div class="fb">Was this helpful? <button type="button" data-fb="up" data-i="${i}" aria-label="Yes, helpful">Yes</button><button type="button" data-fb="down" data-i="${i}" aria-label="No, not helpful">No</button></div>`;
      }
      html += '</div>';
    });
    if (state.typing) html += '<div class="typing">Assistant is typing...</div>';
    body.innerHTML = html;
    body.scrollTop = body.scrollHeight;
  }

  function open(prefill, autoSend) {
    state.open = true; panel.hidden = false; fab.hidden = true; save(); render();
    if (prefill) {
      if (autoSend) send(prefill); else { input.value = prefill; input.focus(); }
    } else input.focus();
  }
  function close() { state.open = false; panel.hidden = true; fab.hidden = false; save(); }

  async function send(text) {
    text = text.trim();
    if (!text || state.typing) return;
    state.msgs.push({ role: 'user', text });
    input.value = '';
    state.typing = true; render();
    try {
      const history = state.msgs.slice(-7, -1).map((m) => ({ role: m.role, content: m.text }));
      const mail = email.value.trim();
      try { if (mail) localStorage.setItem('tw_email', mail); } catch { /* ignore */ }
      const r = await api('/api/chat', { method: 'POST', body: JSON.stringify({ message: text, history, sessionId: sid, email: mail }) });
      state.msgs.push({ role: 'assistant', text: r.reply, id: r.messageId, ticket: r.ticket && r.ticket.reference });
    } catch (e) {
      const why = e.status ? e.message : 'I could not reach the server. Please try again, or use the Support page.';
      state.msgs.push({ role: 'assistant', text: `${why}${e.code ? ` (error ${e.code})` : ''}` });
    } finally {
      state.typing = false; save(); render();
    }
  }

  body.addEventListener('click', async (e) => {
    const s = e.target.closest('[data-s]');
    if (s) { send(s.dataset.s); return; }
    const f = e.target.closest('[data-fb]');
    if (!f) return;
    const m = state.msgs[Number(f.dataset.i)];
    if (!m || m.rated) return;
    try {
      await api('/api/feedback', { method: 'POST', body: JSON.stringify({ messageId: m.id, sessionId: sid, rating: f.dataset.fb }) });
      m.rated = true; save(); render();
    } catch (err) {
      window.TW.toast(`Feedback not saved (${err.code}).`);
    }
  });

  $('chatForm').addEventListener('submit', (e) => { e.preventDefault(); send(input.value); });
  fab.addEventListener('click', () => open());
  $('chatClose').addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) close(); });

  window.TuneChat = { open, close };
  if (state.open) { panel.hidden = false; fab.hidden = true; }
  render();
})();
