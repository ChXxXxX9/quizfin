/* ==========================================================================
   Quiz Nuoto — notifiche push (push.js)
   --------------------------------------------------------------------------
   - Gestione delle notifiche nella sezione Account ([data-push-panel]):
     attiva/disattiva su questo dispositivo, scelta "Promemoria streak".
   - Popup "Abbiamo aggiunto le notifiche": una sola volta per utente, al primo
     accesso dopo l'aggiornamento, quando la pagina è libera da altri popup.
   - Guida per iPhone: le notifiche funzionano solo dall'app aggiunta alla Home.
   Il dispositivo si salva in users/{uid}.push = { tokens: [...], enabled, streak }.
   L'invio lo fa il lavoro programmato su GitHub (cartella notifiche/ del repository).
   ========================================================================== */
(() => {
  'use strict';

  const SDK = 'https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js';
  const INTRO_ID = 'notifiche_v1';
  const BELL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';
  const FOCUS_VIEWS = new Set(['quizView', 'flashcardView', 'sudokuView']);

  const fq = () => window.FirebaseQuiz || {};
  const db = () => fq().db || null;
  const FV = () => window.firebase.firestore.FieldValue;
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let user = null;
  let pushData = {};
  let profileSeen = {};
  let busy = false;
  let message = '';

  const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
  const supported = () => 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
  const localKey = () => `quizNuotoPush:${user?.uid}`;
  function localToken() { try { return localStorage.getItem(localKey()) || ''; } catch { return ''; } }
  function setLocalToken(t) { try { if (t) localStorage.setItem(localKey(), t); else localStorage.removeItem(localKey()); } catch { /* niente */ } }

  function loadSdk() {
    if (window.firebase?.messaging) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SDK;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Non riesco a caricare il servizio notifiche: controlla la connessione.'));
      document.head.appendChild(s);
    });
  }
  async function registration() {
    let reg = await navigator.serviceWorker.getRegistration();
    if (!reg) reg = await navigator.serviceWorker.register('service-worker.js');
    await navigator.serviceWorker.ready;
    return reg;
  }
  async function getToken() {
    await loadSdk();
    if (window.firebase.messaging.isSupported && !(await window.firebase.messaging.isSupported())) {
      throw new Error('Questo browser non supporta le notifiche.');
    }
    const reg = await registration();
    const token = await window.firebase.messaging().getToken({ serviceWorkerRegistration: reg });
    if (!token) throw new Error('Non sono riuscito a registrare questo dispositivo.');
    return token;
  }
  async function saveToken(token, extra = {}) {
    await db().collection('users').doc(user.uid).set({
      push: { tokens: FV().arrayUnion(token), enabled: true, updatedAt: FV().serverTimestamp(), ...extra }
    }, { merge: true });
  }

  /* ---------------- Azioni ---------------- */
  async function enable() {
    if (busy) return false;
    busy = true; message = ''; render();
    let done = false;
    try {
      let permission = Notification.permission;
      if (permission === 'default') permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('Permesso negato: le notifiche si possono riattivare dalle impostazioni del browser o del telefono.');
      const token = await getToken();
      await saveToken(token, { streak: pushData.streak !== false });
      setLocalToken(token);
      pushData = { ...pushData, enabled: true, streak: pushData.streak !== false };
      message = 'Fatto: riceverai i promemoria e gli avvisi dello staff.';
      done = true;
    } catch (error) {
      message = error.message || 'Attivazione non riuscita.';
    } finally {
      busy = false;
      render();
    }
    return done;
  }
  async function disable() {
    if (busy) return;
    busy = true; message = ''; render();
    const token = localToken();
    try {
      if (token) {
        await db().collection('users').doc(user.uid).set({ push: { tokens: FV().arrayRemove(token), updatedAt: FV().serverTimestamp() } }, { merge: true });
        try { await loadSdk(); await window.firebase.messaging().deleteToken(); } catch { /* il token resta solo lato browser */ }
      }
      setLocalToken('');
      message = 'Notifiche disattivate su questo dispositivo.';
    } catch (error) {
      message = error.message || 'Operazione non riuscita.';
    } finally {
      busy = false;
      render();
    }
  }
  async function setStreak(on) {
    try {
      await db().collection('users').doc(user.uid).set({ push: { streak: on, updatedAt: FV().serverTimestamp() } }, { merge: true });
      pushData = { ...pushData, streak: on };
      message = on ? 'Promemoria streak attivi.' : 'Promemoria streak disattivati (restano gli avvisi dello staff).';
    } catch (error) { message = error.message; }
    render();
  }

  // Tiene valido il token una volta al giorno (i token cambiano ogni tanto)
  async function refreshQuietly() {
    if (!supported() || Notification.permission !== 'granted' || !localToken()) return;
    const day = new Date().toISOString().slice(0, 10);
    const key = `${localKey()}:check`;
    try { if (localStorage.getItem(key) === day) return; } catch { /* niente */ }
    try {
      const token = await getToken();
      if (token !== localToken() || !(pushData.tokens || []).includes(token)) {
        await saveToken(token);
        setLocalToken(token);
      }
      localStorage.setItem(key, day);
    } catch { /* riprova domani */ }
  }

  /* ---------------- Stato e pannello in Account ---------------- */
  function state() {
    if (isIos() && !isStandalone()) return 'ios-home';
    if (!supported()) return 'unsupported';
    if (Notification.permission === 'denied') return 'denied';
    if (Notification.permission === 'granted' && localToken()) return 'on';
    return 'off';
  }
  const STATUS_LABEL = { on: 'Attive su questo dispositivo', off: 'Spente', denied: 'Bloccate dal browser', unsupported: 'Non disponibili qui', 'ios-home': 'Solo dall’app nella Home' };
  const TEXTS = {
    'ios-home': 'Su iPhone e iPad le notifiche arrivano solo dall’app: tocca <strong>Condividi</strong> → <strong>Aggiungi alla schermata Home</strong>, poi apri Quiz Nuoto da lì e attivale.',
    unsupported: 'Questo browser non supporta le notifiche. Prova con Chrome, Edge, Firefox o Safari aggiornati.',
    denied: 'Le notifiche sono bloccate per questo sito: riattivale dalle impostazioni del browser o del telefono, poi ricarica la pagina.',
    on: 'Ti avvisiamo prima di perdere la streak e quando lo staff pubblica una novità.',
    off: 'Un promemoria prima di perdere la streak (con quanto ti manca e quanto tempo hai) e gli avvisi dello staff.'
  };

  function render() {
    const panels = document.querySelectorAll('[data-push-panel]');
    const st = user ? state() : 'off';
    const streakOn = pushData.streak !== false;
    panels.forEach((panel) => {
      panel.innerHTML = `<div class="push-panel" data-push-state="${st}">
        <p class="push-panel-text">${TEXTS[st]}</p>
        ${st === 'on' ? `<label class="checkline push-streak"><input type="checkbox" data-push-streak ${streakOn ? 'checked' : ''}> Promemoria streak</label>` : ''}
        ${message ? `<p class="push-msg" role="status">${esc(message)}</p>` : ''}
        <div class="push-actions">
          ${st === 'off' ? `<button class="primary-btn small-btn" type="button" data-push-on ${busy ? 'disabled' : ''}>${busy ? 'Attivo…' : 'Attiva le notifiche'}</button>` : ''}
          ${st === 'on' ? `<button class="ghost-btn small-btn" type="button" data-push-off ${busy ? 'disabled' : ''}>Disattiva su questo dispositivo</button>` : ''}
        </div>
      </div>`;
      panel.onclick = (event) => {
        if (event.target.closest('[data-push-on]')) enable();
        if (event.target.closest('[data-push-off]')) disable();
      };
      panel.onchange = (event) => {
        if (event.target.matches('[data-push-streak]')) setStreak(event.target.checked);
      };
    });
    document.dispatchEvent(new CustomEvent('quiz:push-change', { detail: { state: st, label: STATUS_LABEL[st], streak: streakOn } }));
  }

  /* ---------------- Popup "Abbiamo aggiunto le notifiche" ---------------- */
  const introKey = () => `qn-promo:${user?.uid}:${INTRO_ID}`;
  function introSeen() {
    try { if (localStorage.getItem(introKey()) === '1') return true; } catch { /* niente */ }
    return Boolean(profileSeen?.[INTRO_ID]);
  }
  function markIntroSeen() {
    try { localStorage.setItem(introKey(), '1'); } catch { /* niente */ }
    if (!user || !db()) return;
    db().collection('users').doc(user.uid).set({ profile: { promoSeen: { [INTRO_ID]: new Date().toISOString() } } }, { merge: true }).catch(() => {});
  }
  function pageReady() {
    const main = document.querySelector('#mainContent, #arteMain');
    if (!main || main.classList.contains('hidden') || !main.getClientRects().length) return false;
    if (document.body.classList.contains('app-locked') || document.body.classList.contains('system-gated')) return false;
    if (FOCUS_VIEWS.has(document.body.dataset.view)) return false;
    const busyUi = Array.from(document.querySelectorAll('.modal, .study-milestone-overlay, .site-dialog-backdrop, .nf-overlay'))
      .some((el) => !el.classList.contains('hidden') && el.getClientRects().length);
    if (busyUi) return false;
    const card = document.getElementById('authCard');
    if (card && !card.classList.contains('hidden') && getComputedStyle(card).position === 'fixed') return false;
    return true;
  }
  function whenReady(cb, { interval = 900, timeout = 10 * 60 * 1000 } = {}) {
    const started = Date.now();
    let streak = 0;
    const tick = () => {
      if (!user) return;
      if (document.hidden) { setTimeout(tick, interval); return; }
      streak = pageReady() ? streak + 1 : 0;
      if (streak >= 2) { cb(); return; }
      if (Date.now() - started < timeout) setTimeout(tick, interval);
    };
    setTimeout(tick, interval);
  }

  function openIntro() {
    if (document.querySelector('.push-intro') || !user || introSeen()) return;
    const st = state();
    if (st === 'on' || st === 'unsupported' || st === 'denied') { markIntroSeen(); return; }
    const ios = st === 'ios-home';
    const modal = document.createElement('div');
    modal.className = 'modal push-intro';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'pushIntroTitle');
    modal.innerHTML = `<div class="modal-card push-intro-card">
      <div class="push-intro-art" aria-hidden="true">
        <span class="push-intro-ring"></span><span class="push-intro-ring r2"></span>
        <span class="push-intro-bell">${BELL}</span>
        <span class="push-intro-badge">1</span>
      </div>
      <p class="eyebrow">Novità</p>
      <h2 id="pushIntroTitle">Abbiamo aggiunto le notifiche</h2>
      <p class="push-intro-text">${ios
        ? 'Su iPhone e iPad arrivano dall’app di Quiz Nuoto: tocca <strong>Condividi</strong> → <strong>Aggiungi alla schermata Home</strong>, apri Quiz Nuoto da lì e attivale da <strong>Account</strong>.'
        : 'Ti avvisiamo prima di perdere la streak, con quante domande ti mancano e quanto tempo hai, e quando lo staff pubblica una novità.'}</p>
      <ul class="push-intro-points">
        <li><span aria-hidden="true">🔥</span>Promemoria prima di perdere la streak</li>
        <li><span aria-hidden="true">📣</span>Avvisi e novità dello staff</li>
      </ul>
      <p class="push-msg" data-intro-msg role="status" hidden></p>
      <div class="push-intro-actions">
        ${ios ? '<button class="primary-btn" type="button" data-intro-close>Ho capito</button>'
          : '<button class="primary-btn" type="button" data-intro-on>Attiva le notifiche</button><button class="ghost-btn" type="button" data-intro-close>Più tardi</button>'}
      </div>
      <p class="push-intro-foot">Le gestisci quando vuoi da <strong>Account</strong>.</p>
    </div>`;
    document.body.appendChild(modal);
    markIntroSeen();
    const previous = document.activeElement;
    requestAnimationFrame(() => modal.querySelector('[data-intro-on], [data-intro-close]')?.focus({ preventScroll: true }));
    const close = () => { modal.remove(); try { previous?.focus?.({ preventScroll: true }); } catch { /* niente */ } };
    modal.addEventListener('click', async (event) => {
      if (event.target === modal || event.target.closest('[data-intro-close]')) { close(); return; }
      const on = event.target.closest('[data-intro-on]');
      if (!on) return;
      on.disabled = true;
      on.textContent = 'Attivo…';
      const ok = await enable();
      const msg = modal.querySelector('[data-intro-msg]');
      if (ok) {
        modal.querySelector('.push-intro-card').classList.add('is-done');
        modal.querySelector('#pushIntroTitle').textContent = 'Notifiche attive';
        msg.hidden = false;
        msg.textContent = 'Fatto! Ti avviseremo prima di perdere la streak.';
        on.remove();
        const later = modal.querySelector('[data-intro-close]');
        if (later) { later.textContent = 'Chiudi'; later.className = 'primary-btn'; }
        setTimeout(() => { if (modal.isConnected) close(); }, 2600);
      } else {
        msg.hidden = false;
        msg.textContent = message || 'Non sono riuscito ad attivarle: riprova da Account.';
        on.disabled = false;
        on.textContent = 'Riprova';
      }
    });
    modal.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.stopPropagation(); close(); } });
  }

  async function onUser(u) {
    user = u;
    pushData = {};
    profileSeen = {};
    message = '';
    if (!u) { render(); return; }
    try {
      const snap = await (fq().getUserDoc ? fq().getUserDoc(u.uid) : db().collection('users').doc(u.uid).get());
      const data = snap.exists ? (snap.data() || {}) : {};
      pushData = data.push || {};
      profileSeen = data.profile?.promoSeen || {};
    } catch { pushData = {}; }
    render();
    refreshQuietly();
    if (!introSeen()) whenReady(openIntro);
  }

  function start() {
    const auth = fq().auth;
    if (!auth || !db()) return;
    auth.onAuthStateChanged((u) => { if (!user || !u || user.uid !== u.uid) onUser(u || null); });
  }

  window.QuizPush = Object.freeze({ enable, disable, state: () => state(), render: () => render(), label: () => STATUS_LABEL[state()], openIntro: () => openIntro() });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(start, 0));
  else setTimeout(start, 0);
})();
