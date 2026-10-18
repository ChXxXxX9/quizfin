/* ==========================================================================
   Quiz Nuoto — schermata di manutenzione / blocco (gate.js)
   --------------------------------------------------------------------------
   Una schermata a parte, che non ha niente a che fare con lo stato
   dell'account (richiesta, approvazione, verifica): quando l'admin mette in
   manutenzione o blocca il sito o un corso, chi entra vede solo questa.

   QuizGate.show({ kind, scope, title, message, reason, courseLabel })
     kind  'maintenance' | 'blocked'
     scope 'site' | 'course'
   QuizGate.hide()
   ========================================================================== */
(() => {
  'use strict';

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ICONS = {
    maintenance: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
    blocked: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/></svg>'
  };

  let el = null;

  function ensure() {
    if (el) return el;
    el = document.createElement('section');
    el.id = 'systemGate';
    el.className = 'system-gate';
    el.setAttribute('role', 'alert');
    el.setAttribute('aria-live', 'assertive');
    const host = document.querySelector('.page') || document.body;
    host.prepend(el);
    el.addEventListener('click', async (event) => {
      const btn = event.target.closest('[data-gate]');
      if (!btn) return;
      if (btn.dataset.gate === 'retry') location.reload();
      if (btn.dataset.gate === 'logout') {
        btn.disabled = true;
        try { await window.FirebaseQuiz?.auth?.signOut(); } catch { /* niente */ }
        location.reload();
      }
    });
    return el;
  }

  function show(opts = {}) {
    const kind = opts.kind === 'blocked' ? 'blocked' : 'maintenance';
    const scope = opts.scope === 'course' ? 'course' : 'site';
    const node = ensure();
    const eyebrow = kind === 'maintenance'
      ? (scope === 'course' ? 'Corso in manutenzione' : 'Manutenzione')
      : (scope === 'course' ? 'Corso sospeso' : 'Accesso sospeso');
    const title = opts.title || (kind === 'maintenance'
      ? (scope === 'course' ? `${opts.courseLabel || 'Questo corso'} è in manutenzione` : 'Stiamo sistemando il sito')
      : (scope === 'course' ? `${opts.courseLabel || 'Questo corso'} non è disponibile` : 'Il sito non è disponibile'));
    const message = opts.message || (kind === 'maintenance'
      ? 'Torniamo il prima possibile. Il tuo account e i tuoi progressi sono al sicuro.'
      : 'Lo staff ha sospeso l’accesso per tutti gli utenti. Il tuo account e i tuoi progressi restano salvati.');
    node.dataset.kind = kind;
    node.innerHTML = `
      <div class="system-gate-card">
        <span class="system-gate-icon">${ICONS[kind]}</span>
        <p class="system-gate-eyebrow">${esc(eyebrow)}</p>
        <h1 class="system-gate-title">${esc(title)}</h1>
        <p class="system-gate-text">${esc(message)}</p>
        ${opts.reason ? `<div class="system-gate-reason"><strong>${kind === 'maintenance' ? 'Messaggio dello staff' : 'Motivo'}</strong><p>${esc(opts.reason)}</p></div>` : ''}
        <div class="system-gate-actions">
          <button class="primary-btn" type="button" data-gate="retry">Riprova</button>
          ${scope === 'course' ? '<a class="secondary-btn" href="index.html">Torna ai corsi</a>' : ''}
          <button class="ghost-btn" type="button" data-gate="logout">Esci dall’account</button>
        </div>
      </div>`;
    document.body.classList.add('system-gated');
  }

  function hide() {
    document.body.classList.remove('system-gated');
    if (el) el.innerHTML = '';
  }

  window.QuizGate = Object.freeze({ show, hide });
})();
