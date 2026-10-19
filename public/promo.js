/* ==========================================================================
   Quiz Nuoto — promozione di Nuotifica (promo.js)
   --------------------------------------------------------------------------
   - Popup a tutto schermo: compare UNA sola volta per utente (la prima volta
     che entra dopo l'aggiunta), poi mai più. Il "già visto" è salvato sia sul
     dispositivo sia nel profilo Firestore dell'utente (users/{uid}.profile.promoSeen),
     così non ricompare nemmeno cambiando telefono.
   - Banner fisso nella schermata dei corsi (#promoSlot).
   - Impostazioni in courseSettings/promo (le scrive solo l'admin):
       bannerEnabled  true/false  banner nella schermata dei corsi
       popupEnabled   true/false  popup al primo accesso
       popupVersion   numero      aumentandolo il popup ricompare a tutti una volta
       url            link dell'app
     Se il documento non esiste valgono i valori predefiniti (tutto acceso).
   - Pannello admin (#promoAdmin in admin.html): interruttori, link, anteprime.
   Non tocca la logica dei corsi: se qualcosa manca, semplicemente non mostra nulla.
   ========================================================================== */
(() => {
  'use strict';

  const DEFAULTS = Object.freeze({ bannerEnabled: true, popupEnabled: true, popupVersion: 1, url: 'https://nuotifica.web.app' });
  const ASSETS = 'assets/nuotifica/';
  const FOCUS_VIEWS = new Set(['quizView', 'flashcardView', 'sudokuView']);
  const CAMPAIGN = 'nuotifica';

  let config = { ...DEFAULTS };
  let user = null;
  let started = false;

  const $ = (sel, root = document) => root.querySelector(sel);
  const fq = () => window.FirebaseQuiz || {};
  const db = () => fq().db || null;
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  /* ---------------- Impostazioni ---------------- */
  function safeUrl(value) {
    try {
      const u = new URL(String(value || ''), location.href);
      return /^https?:$/.test(u.protocol) ? u.href : DEFAULTS.url;
    } catch { return DEFAULTS.url; }
  }
  function normalize(data = {}) {
    return {
      bannerEnabled: data.bannerEnabled !== false,
      popupEnabled: data.popupEnabled !== false,
      popupVersion: Math.max(1, Math.floor(Number(data.popupVersion) || 1)),
      url: safeUrl(data.url || DEFAULTS.url)
    };
  }
  async function loadConfig() {
    try {
      const snap = await db()?.collection('courseSettings').doc('promo').get();
      config = normalize(snap?.exists ? (snap.data() || {}) : {});
    } catch { config = { ...DEFAULTS }; }
    return config;
  }

  /* ---------------- "Già visto" ---------------- */
  const seenKey = () => `${CAMPAIGN}_v${config.popupVersion}`;
  const localKey = () => `qn-promo:${user?.uid || 'anon'}:${seenKey()}`;
  function localGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
  function localSet(key, value) { try { localStorage.setItem(key, value); } catch { /* niente */ } }

  async function alreadySeen() {
    if (localGet(localKey())) return true;
    try {
      const snap = await db()?.collection('users').doc(user.uid).get();
      const seen = snap?.exists ? snap.data()?.profile?.promoSeen?.[seenKey()] : null;
      if (seen) { localSet(localKey(), '1'); return true; }
    } catch { /* se non si legge, vale il dispositivo */ }
    return false;
  }
  async function markSeen(how) {
    localSet(localKey(), '1');
    try {
      const stamp = window.firebase?.firestore?.FieldValue?.serverTimestamp?.() || new Date();
      await db()?.collection('users').doc(user.uid).set({
        profile: { promoSeen: { [seenKey()]: stamp, [`${seenKey()}_azione`]: how || 'chiuso' } }
      }, { merge: true });
    } catch { /* resta comunque segnato su questo dispositivo */ }
  }

  /* ---------------- Pezzi grafici ---------------- */
  const ICON_ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>';
  const ICON_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';

  function logoHtml(size = 320, count = true) {
    return `<div class="nf-logo" aria-hidden="true">
      <img src="${ASSETS}logo-${size}.png" alt="" width="${size / 2}" height="${size / 2}" decoding="async" />
      <span class="nf-wave"></span><span class="nf-wave"></span><span class="nf-wave"></span>
      ${count ? '<span class="nf-count">1</span>' : ''}
    </div>`;
  }
  const waterHtml = () => '<div class="nf-water" aria-hidden="true"><span class="nf-glow g1"></span><span class="nf-glow g2"></span><span class="nf-glow g3"></span></div>';

  const BOARD_ROWS = [
    { tipo: 'AMMESSI', nome: 'Finali Categoria', ora: '18:42' },
    { tipo: 'STARTLIST', nome: 'Assoluti v.c.', ora: '17:05' },
    { tipo: 'ORARI', nome: 'Esordienti A', ora: '12:30' },
    { tipo: 'RISULTATI', nome: 'Master', ora: '09:15' }
  ];
  const NOTIFICATIONS = [
    { tipo: 'Ammessi', titolo: 'Finali Categoria', testo: 'È uscito l’elenco degli ammessi. Tocca per aprirlo.' },
    { tipo: 'Start list', titolo: 'Assoluti vasca corta', testo: 'Start list e programma gare pubblicati.' },
    { tipo: 'Orari', titolo: 'Esordienti A', testo: 'Nuovi orari di riscaldamento e gara.' },
    { tipo: 'Risultati', titolo: 'Master', testo: 'Risultati aggiornati appena usciti.' }
  ];
  const TICKER = ['NUOVA APP', 'AMMESSI', 'START LIST', 'ORARI', 'RISULTATI', 'CLASSIFICHE', 'COMUNICATI', 'FIN LAZIO', 'NOTIFICHE PUSH'];

  function boardHtml() {
    return `<div class="nf-board" aria-hidden="true">
      <div class="nf-board-head"><span>FIN LAZIO</span><span class="nf-board-live">LIVE</span></div>
      <ol>${BOARD_ROWS.map((r, i) => `<li style="--i:${i}"><span>${r.tipo}</span><span class="nome">${r.nome}</span><span class="ora">${r.ora}</span></li>`).join('')}</ol>
    </div>`;
  }
  function notificationsHtml() {
    return `<div class="nf-notifs" aria-hidden="true">${NOTIFICATIONS.map((n) => `
      <div class="nf-notif">
        <img src="${ASSETS}logo-160.png" alt="" width="42" height="42" />
        <div class="nf-notif-text">
          <div class="nf-notif-top"><span>Nuotifica · ${n.tipo}</span><span>ora</span></div>
          <strong>${n.titolo}</strong>
          <span class="nf-notif-body">${n.testo}</span>
        </div>
      </div>`).join('')}</div>`;
  }
  function bubblesHtml(count) {
    const colors = ['rgba(110,231,255,.55)', 'rgba(255,197,49,.55)', 'rgba(255,79,58,.5)', 'rgba(234,244,255,.5)', 'rgba(83,227,154,.45)'];
    let out = '';
    for (let i = 0; i < count; i++) {
      const size = 6 + Math.round(Math.random() * 22);
      out += `<span style="--x:${(Math.random() * 100).toFixed(1)}%;--s:${size}px;--d:${(Math.random() * 9).toFixed(2)}s;--t:${(9 + Math.random() * 10).toFixed(1)}s;--c:${colors[i % colors.length]}"></span>`;
    }
    return `<div class="nf-bubbles" aria-hidden="true">${out}</div>`;
  }

  /* ---------------- Popup a tutto schermo ---------------- */
  let popupState = null;

  function openPopup({ preview = false } = {}) {
    if (popupState || $('.nf-overlay')) return;
    const url = esc(config.url);
    const letters = 'Nuotifica'.split('').map((ch, i) => `<i style="--i:${i}">${ch}</i>`).join('');
    const overlay = document.createElement('div');
    overlay.className = 'nf-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'nfTitle');
    overlay.setAttribute('aria-describedby', 'nfSub');
    overlay.tabIndex = -1;
    overlay.innerHTML = `
      ${waterHtml()}
      ${bubblesHtml(window.innerWidth < 700 ? 12 : 22)}
      <div class="nf-rope" aria-hidden="true"></div>
      <button class="nf-close" type="button" data-nf-close="x" aria-label="Chiudi">${ICON_CLOSE}</button>
      <div class="nf-stage">
        <div class="nf-copy">
          <div class="nf-head">
            ${logoHtml(320)}
            <div class="nf-head-text">
              <p class="nf-led-tag"><i></i>NUOVA APP</p>
              <p class="nf-by">Dai creatori di Quiz Nuoto</p>
            </div>
          </div>
          <h2 class="nf-wordmark nf-title" id="nfTitle" aria-label="Nuotifica"><span aria-hidden="true">${letters}</span></h2>
          <p class="nf-sub" id="nfSub">Ammessi, start list, orari e risultati della <strong>FIN Lazio</strong>: ti arriva una notifica sul telefono appena escono.</p>
          <ul class="nf-points">
            <li style="--i:0;--c:#6ee7ff"><b></b>Scegli settore e categoria</li>
            <li style="--i:1;--c:#ffc531"><b></b>Notifica appena escono</li>
            <li style="--i:2;--c:#53e39a"><b></b>Gratis</li>
          </ul>
          <div class="nf-actions">
            <a class="nf-cta" href="${url}" target="_blank" rel="noopener" data-nf-close="apri">Apri Nuotifica ${ICON_ARROW}</a>
            <button class="nf-later" type="button" data-nf-close="dopo">Più tardi</button>
          </div>
          <p class="nf-fine">Gratis, si aggiunge alla schermata Home come un'app. Servizio non ufficiale: non è collegato alla FIN, fa fede solo finlazio.it.</p>
        </div>
        <div class="nf-device">
          <div class="nf-big-logo" aria-hidden="true">${logoHtml(320, false)}<span>Nuotifica</span></div>
          ${notificationsHtml()}
          ${boardHtml()}
        </div>
      </div>`;

    const previousFocus = document.activeElement;
    document.documentElement.classList.add('nf-lock');
    document.body.appendChild(overlay);

    // Notifiche che arrivano una dopo l'altra
    const cards = Array.from(overlay.querySelectorAll('.nf-notif'));
    let index = -1;
    const nextCard = () => {
      if (!cards.length) return;
      cards.forEach((c) => c.classList.remove('is-out'));
      if (index >= 0) { cards[index].classList.remove('is-in'); cards[index].classList.add('is-out'); }
      index = (index + 1) % cards.length;
      cards[index].classList.add('is-in');
    };
    const firstTimer = setTimeout(nextCard, reducedMotion() ? 0 : 1700);
    const cycle = setInterval(nextCard, 3600);

    const onKey = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close('esc'); return; }
      if (event.key === 'Tab') trapFocus(event, overlay);
    };
    const onClick = (event) => {
      const trigger = event.target.closest('[data-nf-close]');
      if (!trigger) return;
      const how = trigger.dataset.nfClose;
      // Il link si apre normalmente (nuova scheda); il popup si chiude subito dopo.
      if (how !== 'apri') event.preventDefault();
      close(how);
    };
    document.addEventListener('keydown', onKey, true);
    overlay.addEventListener('click', onClick);

    function close(how) {
      if (!popupState || popupState.closing) return;
      popupState.closing = true;
      clearTimeout(firstTimer);
      clearInterval(cycle);
      document.removeEventListener('keydown', onKey, true);
      if (!preview) markSeen(how);
      const finish = () => {
        overlay.remove();
        document.documentElement.classList.remove('nf-lock');
        popupState = null;
        if (previousFocus && typeof previousFocus.focus === 'function') { try { previousFocus.focus({ preventScroll: true }); } catch { /* niente */ } }
      };
      if (reducedMotion()) finish();
      else { overlay.classList.add('is-closing'); setTimeout(finish, 380); }
    }

    popupState = { close, closing: false };
    // Il fuoco va sulla finestra (il lettore di schermo legge titolo e descrizione); Tab passa ai pulsanti
    requestAnimationFrame(() => { try { overlay.focus({ preventScroll: true }); } catch { /* niente */ } });
  }

  function trapFocus(event, root) {
    const items = Array.from(root.querySelectorAll('a[href], button:not([disabled])')).filter((el) => el.getClientRects().length);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    else if (!root.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
  }

  /* ---------------- Banner fisso ---------------- */
  function bannerHtml() {
    const items = TICKER.map((t) => `<span>${t}</span>`).join('');
    return `<a class="nf-banner" href="${esc(config.url)}" target="_blank" rel="noopener" aria-label="Nuova app Nuotifica: notifiche FIN Lazio. Apri l'app">
      ${waterHtml()}
      <div class="nf-rope" aria-hidden="true"></div>
      <div class="nf-banner-body">
        ${logoHtml(160)}
        <div class="nf-banner-text">
          <p class="nf-led-tag"><i></i>NUOVA APP</p>
          <h2 class="nf-wordmark">Nuotifica</h2>
          <p class="nf-banner-sub">Ammessi, start list, orari e risultati della <strong>FIN Lazio</strong>: una notifica sul telefono appena escono<span class="nf-banner-sub-full">, per il tuo settore e la tua categoria</span>.</p>
        </div>
        <div class="nf-banner-cta">
          <span class="nf-cta">Apri l'app ${ICON_ARROW}</span>
          <span class="nf-banner-note">Gratis · si aggiunge alla Home</span>
        </div>
      </div>
      <div class="nf-ticker" aria-hidden="true"><div class="nf-ticker-track">${items}${items}</div></div>
    </a>`;
  }
  function renderBanner(slot = $('#promoSlot')) {
    if (!slot) return;
    if (!config.bannerEnabled) { slot.innerHTML = ''; slot.hidden = true; return; }
    slot.hidden = false;
    slot.innerHTML = bannerHtml();
    lightenBanner(slot.querySelector('.nf-banner'));
  }
  // Animazioni solo quando servono: ferme fuori schermo, effetti pesanti fermi dopo l'entrata
  let bannerObserver = null;
  function lightenBanner(banner) {
    if (!banner) return;
    bannerObserver?.disconnect();
    if ('IntersectionObserver' in window) {
      bannerObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => entry.target.classList.toggle('is-offscreen', !entry.isIntersecting));
      }, { rootMargin: '80px 0px' });
      bannerObserver.observe(banner);
    }
    setTimeout(() => banner.classList.add('is-settled'), 9000);
  }

  /* ---------------- Quando mostrare il popup ---------------- */
  function pageReady() {
    const main = document.querySelector('#mainContent, #arteMain');
    if (!main || main.classList.contains('hidden') || !main.getClientRects().length) return false;
    const body = document.body;
    if (body.classList.contains('app-locked')) return false;
    if (FOCUS_VIEWS.has(body.dataset.view)) return false;
    // Non si sovrappone a finestre già aperte (obiettivo di studio, termini, timer, traguardi…)
    const busy = Array.from(document.querySelectorAll('.modal, .study-milestone-overlay, .site-dialog-backdrop'))
      .some((el) => !el.classList.contains('hidden') && el.getClientRects().length);
    if (busy) return false;
    const card = $('#authCard');
    if (card && !card.classList.contains('hidden') && getComputedStyle(card).position === 'fixed') return false;
    return true;
  }
  function whenReady(callback, { interval = 600, timeout = 5 * 60 * 1000 } = {}) {
    const startedAt = Date.now();
    let streak = 0;
    const tick = () => {
      if (document.hidden) { setTimeout(tick, interval); return; }
      streak = pageReady() ? streak + 1 : 0;
      if (streak >= 2) { callback(); return; }
      if (Date.now() - startedAt < timeout) setTimeout(tick, interval);
    };
    setTimeout(tick, interval);
  }

  async function startForUser(signedUser) {
    user = signedUser;
    await loadConfig();
    renderBanner();
    if (!config.popupEnabled) return;
    if (await alreadySeen()) return;
    whenReady(async () => {
      // Ricontrolla: magari è stato chiuso da un'altra scheda nel frattempo
      if (localGet(localKey())) return;
      openPopup();
    });
  }

  /* ---------------- Pannello admin ---------------- */
  let adminUser = null;
  let confirmTimer = null;

  function adminToast(message) {
    const toast = $('#toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.remove('hidden');
    clearTimeout(adminToast.t);
    adminToast.t = setTimeout(() => toast.classList.add('hidden'), 2800);
  }
  function stateCard({ title, on, detail, actions }) {
    return `<div class="request-card course-settings-card">
      <div class="user-headline"><strong>${title}</strong><span class="status-pill${on ? '' : ' warning'}">${on ? 'Attivo' : 'Disattivato'}</span></div>
      <p class="request-meta">${detail}</p>
      <div class="request-actions">${actions}</div>
    </div>`;
  }
  function renderAdmin() {
    const root = $('#promoAdmin');
    if (!root) return;
    root.innerHTML = `
      ${stateCard({
        title: 'Banner fisso nella schermata dei corsi',
        on: config.bannerEnabled,
        detail: config.bannerEnabled ? 'Gli utenti vedono il riquadro di Nuotifica in cima a “I tuoi corsi”.' : 'Il riquadro è nascosto a tutti.',
        actions: `<button class="${config.bannerEnabled ? 'danger-btn' : 'primary-btn'} small-btn" type="button" data-promo-action="toggle-banner">${config.bannerEnabled ? 'Disattiva banner' : 'Attiva banner'}</button>`
      })}
      ${stateCard({
        title: 'Popup animato al primo accesso',
        on: config.popupEnabled,
        detail: config.popupEnabled
          ? `Ogni utente lo vede una sola volta, la prima volta che entra. Giro attuale: n° ${config.popupVersion}.`
          : 'Il popup non viene mostrato a nessuno.',
        actions: `<button class="${config.popupEnabled ? 'danger-btn' : 'primary-btn'} small-btn" type="button" data-promo-action="toggle-popup">${config.popupEnabled ? 'Disattiva popup' : 'Attiva popup'}</button>
          <button class="secondary-btn small-btn" type="button" data-promo-action="reshow">Mostralo di nuovo a tutti</button>
          <button class="ghost-btn small-btn" type="button" data-promo-action="preview-popup">Anteprima popup</button>`
      })}
      <div class="request-card">
        <div class="user-headline"><strong>Link dell'app</strong></div>
        <div class="admin-form">
          <input id="promoUrlInput" type="url" inputmode="url" value="${esc(config.url)}" aria-label="Link dell'app" />
          <button class="primary-btn small-btn" type="button" data-promo-action="save-url">Salva link</button>
        </div>
      </div>
      <div class="nf-admin-preview">
        <p class="settings-group-title">Anteprima del banner</p>
        <div id="promoBannerPreview"></div>
      </div>`;
    const preview = $('#promoBannerPreview');
    if (preview) preview.innerHTML = bannerHtml();
  }
  async function saveConfig(patch) {
    if (!adminUser) throw new Error('Sessione admin non disponibile.');
    const stamp = window.firebase?.firestore?.FieldValue?.serverTimestamp?.() || new Date();
    await db().collection('courseSettings').doc('promo').set({ ...patch, updatedBy: adminUser.uid, updatedAt: stamp }, { merge: true });
    config = normalize({ ...config, ...patch });
    renderAdmin();
  }
  async function onAdminClick(event) {
    const btn = event.target.closest('[data-promo-action]');
    if (!btn) return;
    const action = btn.dataset.promoAction;
    if (action === 'preview-popup') { openPopup({ preview: true }); return; }
    if (action === 'reshow' && btn.dataset.armed !== '1') {
      btn.dataset.armed = '1';
      btn.textContent = 'Confermi? Tocca di nuovo';
      clearTimeout(confirmTimer);
      confirmTimer = setTimeout(() => { btn.dataset.armed = ''; btn.textContent = 'Mostralo di nuovo a tutti'; }, 4000);
      return;
    }
    btn.disabled = true;
    try {
      if (action === 'toggle-banner') { await saveConfig({ bannerEnabled: !config.bannerEnabled }); adminToast(config.bannerEnabled ? 'Banner attivato.' : 'Banner disattivato.'); }
      if (action === 'toggle-popup') { await saveConfig({ popupEnabled: !config.popupEnabled }); adminToast(config.popupEnabled ? 'Popup attivato.' : 'Popup disattivato.'); }
      if (action === 'reshow') { await saveConfig({ popupVersion: config.popupVersion + 1, popupEnabled: true }); adminToast('Il popup ricomparirà una volta a tutti gli utenti.'); }
      if (action === 'save-url') {
        const raw = ($('#promoUrlInput')?.value || '').trim();
        let parsed = null;
        try { parsed = new URL(raw); } catch { parsed = null; }
        if (!parsed || !/^https?:$/.test(parsed.protocol)) throw new Error('Scrivi un link completo, ad esempio https://nuotifica.web.app');
        await saveConfig({ url: parsed.href });
        adminToast('Link salvato.');
      }
    } catch (error) {
      adminToast(error?.code === 'permission-denied' ? 'Firestore ha rifiutato la modifica: questo account è ancora admin?' : (error?.message || 'Operazione non riuscita.'));
    } finally {
      btn.disabled = false;
    }
  }
  async function startAdmin(signedUser) {
    adminUser = signedUser;
    await loadConfig();
    renderAdmin();
  }

  /* ---------------- Avvio ---------------- */
  function start() {
    if (started) return;
    const auth = fq().auth;
    if (!auth || !db()) return;
    started = true;
    const adminRoot = $('#promoAdmin');
    if (adminRoot) {
      adminRoot.addEventListener('click', onAdminClick);
      renderAdmin();
      auth.onAuthStateChanged((u) => { if (u) startAdmin(u); });
      return;
    }
    auth.onAuthStateChanged((u) => {
      if (!u) { user = null; return; }
      if (user && user.uid === u.uid) return;
      startForUser(u);
    });
  }

  window.QuizNuotoPromo = {
    preview: () => openPopup({ preview: true }),
    get config() { return { ...config }; }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(start, 0));
  else setTimeout(start, 0);
})();
