/* ==========================================================================
   Quiz Nuoto — notifiche push (push.js)
   --------------------------------------------------------------------------
   Riquadro "Notifiche" (#pushSlot) nel portale e nella home dei corsi:
   - attiva/disattiva le notifiche su questo dispositivo (Firebase Cloud Messaging);
   - scelta "Promemoria streak" (avviso quando l'obiettivo di oggi non è ancora fatto);
   - guida per iPhone: le notifiche funzionano solo dall'app aggiunta alla Home.
   Il dispositivo si salva in users/{uid}.push = { tokens: [...], enabled, streak }.
   L'invio lo fa il lavoro programmato su GitHub (cartella notifiche/ del repository).
   ========================================================================== */
(() => {
  'use strict';

  const SDK = 'https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js';
  const BELL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';

  const fq = () => window.FirebaseQuiz || {};
  const db = () => fq().db || null;
  const FV = () => window.firebase.firestore.FieldValue;
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let user = null;
  let pushData = {};
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
    if (busy) return;
    busy = true; message = ''; render();
    try {
      let permission = Notification.permission;
      if (permission === 'default') permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('Permesso negato: le notifiche si possono riattivare dalle impostazioni del browser o del telefono.');
      const token = await getToken();
      await saveToken(token, { streak: pushData.streak !== false });
      setLocalToken(token);
      pushData = { ...pushData, enabled: true, streak: pushData.streak !== false };
      message = 'Fatto: riceverai i promemoria e gli avvisi dello staff.';
    } catch (error) {
      message = error.message || 'Attivazione non riuscita.';
    } finally {
      busy = false;
      render();
    }
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

  /* ---------------- Riquadro ---------------- */
  function state() {
    if (isIos() && !isStandalone()) return 'ios-home';
    if (!supported()) return 'unsupported';
    if (Notification.permission === 'denied') return 'denied';
    if (Notification.permission === 'granted' && localToken()) return 'on';
    return 'off';
  }
  function render() {
    const slot = document.getElementById('pushSlot');
    if (!slot || !user) { if (slot) slot.innerHTML = ''; return; }
    const st = state();
    const texts = {
      'ios-home': 'Su iPhone e iPad le notifiche arrivano solo dall’app: tocca <strong>Condividi</strong> → <strong>Aggiungi alla schermata Home</strong>, poi apri Quiz Nuoto da lì e attivale.',
      unsupported: 'Questo browser non supporta le notifiche. Prova con Chrome, Edge, Firefox o Safari aggiornati.',
      denied: 'Le notifiche sono bloccate per questo sito: riattivale dalle impostazioni del browser o del telefono, poi ricarica la pagina.',
      on: 'Attive su questo dispositivo: ti avvisiamo prima di perdere la streak e quando lo staff pubblica una novità.',
      off: 'Un promemoria prima di perdere la streak (con quanto ti manca e quanto tempo hai) e gli avvisi dello staff.'
    };
    const streakOn = pushData.streak !== false;
    slot.innerHTML = `<section class="push-card" data-push-state="${st}" aria-labelledby="pushTitle">
      <span class="push-ico">${BELL}</span>
      <div class="push-text">
        <h2 id="pushTitle">Notifiche ${st === 'on' ? '<span class="push-on">attive</span>' : ''}</h2>
        <p>${texts[st]}</p>
        ${st === 'on' ? `<label class="checkline push-streak"><input type="checkbox" data-push-streak ${streakOn ? 'checked' : ''}> Promemoria streak</label>` : ''}
        ${message ? `<p class="push-msg" role="status">${esc(message)}</p>` : ''}
      </div>
      <div class="push-actions">
        ${st === 'off' ? `<button class="primary-btn small-btn" type="button" data-push-on ${busy ? 'disabled' : ''}>${busy ? 'Attivo…' : 'Attiva'}</button>` : ''}
        ${st === 'on' ? `<button class="ghost-btn small-btn" type="button" data-push-off ${busy ? 'disabled' : ''}>Disattiva</button>` : ''}
      </div>
    </section>`;
    slot.onclick = (event) => {
      if (event.target.closest('[data-push-on]')) enable();
      if (event.target.closest('[data-push-off]')) disable();
    };
    slot.onchange = (event) => {
      if (event.target.matches('[data-push-streak]')) setStreak(event.target.checked);
    };
  }

  async function onUser(u) {
    user = u;
    pushData = {};
    if (!u) { render(); return; }
    try {
      const snap = await db().collection('users').doc(u.uid).get();
      pushData = snap.exists ? (snap.data()?.push || {}) : {};
    } catch { pushData = {}; }
    render();
    refreshQuietly();
  }

  function start() {
    const auth = fq().auth;
    if (!auth || !db() || !document.getElementById('pushSlot')) return;
    auth.onAuthStateChanged((u) => { if (!user || !u || user.uid !== u.uid) onUser(u || null); });
  }

  window.QuizPush = Object.freeze({ enable, disable, state: () => state() });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(start, 0));
  else setTimeout(start, 0);
})();
