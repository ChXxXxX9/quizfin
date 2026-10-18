/* ==========================================================================
   Quiz Nuoto — sezione Account (account.js)
   --------------------------------------------------------------------------
   - Nome e cognome (profilo, nome nelle classifiche, nome visto dallo staff);
   - Notifiche (pannello di push.js: attiva/disattiva, promemoria streak);
   - Password: cambio con la password attuale, email per reimpostarla,
     oppure creazione di una password per chi entra con Google.
   Nei corsi Istruttore e Bagnino compare nel foglio "Account" (#accountManage);
   nel portale e in Arte si apre dal pulsante con l'omino ([data-account-open]).
   ========================================================================== */
(() => {
  'use strict';

  const fq = () => window.FirebaseQuiz || {};
  const db = () => fq().db || null;
  const FV = () => window.firebase.firestore.FieldValue;
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICONS = {
    user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
    bell: svg('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>'),
    lock: svg('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
    chev: svg('<path d="m9 6 6 6-6 6"/>'),
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>'
  };
  const COURSES = ['istruttore', 'bagnino', 'arte'];
  const MIN_PASSWORD = 8;
  const NAME_RE = /^[\p{L}][\p{L}' .-]{0,39}$/u;

  let user = null;
  let profile = {};

  const providers = () => (user?.providerData || []).map((p) => p.providerId);
  const hasPassword = () => providers().includes('password');
  const hasGoogle = () => providers().includes('google.com');
  const fullName = () => [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim() || user?.displayName || '';

  function authErrorText(error) {
    const map = {
      'auth/wrong-password': 'La password attuale non è giusta.',
      'auth/invalid-credential': 'La password attuale non è giusta.',
      'auth/invalid-login-credentials': 'La password attuale non è giusta.',
      'auth/weak-password': `La nuova password è troppo debole: usa almeno ${MIN_PASSWORD} caratteri.`,
      'auth/requires-recent-login': 'Per sicurezza esci, rientra e riprova subito.',
      'auth/too-many-requests': 'Troppi tentativi: aspetta qualche minuto e riprova.',
      'auth/network-request-failed': 'Connessione assente: riprova quando sei online.',
      'auth/provider-already-linked': 'Questo account ha già una password.',
      'auth/credential-already-in-use': 'Questa email ha già una password su un altro account.',
      'auth/email-already-in-use': 'Questa email ha già una password su un altro account.',
      'auth/popup-closed-by-user': 'Finestra di Google chiusa: riprova.',
      'auth/popup-blocked': 'Il browser ha bloccato la finestra di Google: consenti i popup e riprova.'
    };
    return map[error?.code] || error?.message || 'Operazione non riuscita.';
  }

  /* ---------------- Contenuto della sezione ---------------- */
  function passwordBody() {
    const show = '<label class="acct-show"><input type="checkbox" data-acct-show> Mostra le password</label>';
    if (hasPassword()) {
      return `<form class="acct-form" data-acct-form="password" autocomplete="on" novalidate>
        <input type="email" name="username" autocomplete="username" value="${esc(user?.email || '')}" hidden>
        <label>Password attuale<input type="password" data-acct-current autocomplete="current-password" required></label>
        <label>Nuova password<input type="password" data-acct-new autocomplete="new-password" minlength="${MIN_PASSWORD}" required></label>
        <label>Ripeti la nuova password<input type="password" data-acct-new2 autocomplete="new-password" minlength="${MIN_PASSWORD}" required></label>
        <div class="acct-meter" data-acct-meter aria-hidden="true"><span></span></div>
        <p class="acct-note" data-acct-meter-text>Almeno ${MIN_PASSWORD} caratteri: meglio se con lettere, numeri e un simbolo.</p>
        ${show}
        <div class="acct-actions"><button class="primary-btn small-btn" type="submit">Cambia password</button></div>
        <p class="acct-msg" data-acct-msg="password" role="status"></p>
        <p class="acct-note acct-forgot">Non ricordi quella attuale? <button class="link-btn" type="button" data-acct-reset>Mandami un’email per reimpostarla</button></p>
      </form>`;
    }
    return `<form class="acct-form" data-acct-form="password-create" novalidate>
      <p class="acct-note">Entri con ${hasGoogle() ? 'Google' : 'un altro servizio'}: non hai una password di Quiz Nuoto. Se vuoi, creane una per entrare anche con <strong>${esc(user?.email || 'la tua email')}</strong> e password.</p>
      <input type="email" name="username" autocomplete="username" value="${esc(user?.email || '')}" hidden>
      <label>Nuova password<input type="password" data-acct-new autocomplete="new-password" minlength="${MIN_PASSWORD}" required></label>
      <label>Ripeti la nuova password<input type="password" data-acct-new2 autocomplete="new-password" minlength="${MIN_PASSWORD}" required></label>
      <div class="acct-meter" data-acct-meter aria-hidden="true"><span></span></div>
      <p class="acct-note" data-acct-meter-text>Almeno ${MIN_PASSWORD} caratteri: meglio se con lettere, numeri e un simbolo.</p>
      ${show}
      <div class="acct-actions"><button class="primary-btn small-btn" type="submit">Crea la password</button></div>
      <p class="acct-msg" data-acct-msg="password" role="status"></p>
    </form>`;
  }

  function sectionsHtml() {
    const pushLabel = window.QuizPush?.label?.() || 'Spente';
    return `<div class="acct">
      <details class="acct-sec" data-acct-sec="profile">
        <summary><span class="acct-ico">${ICONS.user}</span><span class="acct-sum"><b>Nome e cognome</b><small data-acct-sum="profile">${esc(fullName() || 'Da completare')}</small></span><span class="acct-chev">${ICONS.chev}</span></summary>
        <form class="acct-form" data-acct-form="profile" novalidate>
          <div class="acct-two">
            <label>Nome<input type="text" data-acct-first autocomplete="given-name" maxlength="40" value="${esc(profile.firstName || '')}" required></label>
            <label>Cognome<input type="text" data-acct-last autocomplete="family-name" maxlength="40" value="${esc(profile.lastName || '')}" required></label>
          </div>
          <p class="acct-note">È il nome che vede lo staff e che compare nelle classifiche.</p>
          <div class="acct-actions"><button class="primary-btn small-btn" type="submit">Salva</button></div>
          <p class="acct-msg" data-acct-msg="profile" role="status"></p>
        </form>
      </details>
      <details class="acct-sec" data-acct-sec="push">
        <summary><span class="acct-ico">${ICONS.bell}</span><span class="acct-sum"><b>Notifiche</b><small data-acct-sum="push">${esc(pushLabel)}</small></span><span class="acct-chev">${ICONS.chev}</span></summary>
        <div class="acct-body" data-push-panel></div>
      </details>
      <details class="acct-sec" data-acct-sec="password">
        <summary><span class="acct-ico">${ICONS.lock}</span><span class="acct-sum"><b>Password</b><small data-acct-sum="password">${hasPassword() ? 'Cambiala quando vuoi' : 'Accesso con Google'}</small></span><span class="acct-chev">${ICONS.chev}</span></summary>
        ${passwordBody()}
      </details>
    </div>`;
  }

  function mount(container) {
    if (!container) return;
    container.innerHTML = user ? sectionsHtml() : '';
    container.hidden = !user;
    if (!user) return;
    bind(container);
    window.QuizPush?.render?.();
  }
  function remountAll() {
    document.querySelectorAll('[data-account-host]').forEach(mount);
  }

  /* ---------------- Salvataggi ---------------- */
  function setMsg(root, key, text, tone = '') {
    const el = root.querySelector(`[data-acct-msg="${key}"]`);
    if (!el) return;
    el.textContent = text || '';
    el.dataset.tone = tone;
  }

  async function saveName(root) {
    const first = root.querySelector('[data-acct-first]').value.trim().replace(/\s+/g, ' ');
    const last = root.querySelector('[data-acct-last]').value.trim().replace(/\s+/g, ' ');
    if (!first || !last) return setMsg(root, 'profile', 'Scrivi nome e cognome.', 'error');
    if (!NAME_RE.test(first) || !NAME_RE.test(last)) return setMsg(root, 'profile', 'Usa solo lettere, spazi, apostrofi o trattini (massimo 40 caratteri).', 'error');
    const full = `${first} ${last}`;
    const btn = root.querySelector('[data-acct-form="profile"] [type="submit"]');
    btn.disabled = true;
    setMsg(root, 'profile', 'Salvo…');
    try {
      await db().collection('users').doc(user.uid).set({ profile: { firstName: first, lastName: last, displayName: full, nameUpdatedAt: FV().serverTimestamp() } }, { merge: true });
      try { await user.updateProfile({ displayName: full }); } catch { /* il profilo su Firestore basta */ }
      profile = { ...profile, firstName: first, lastName: last, displayName: full };
      // Il nuovo nome anche nelle classifiche in cui sei già presente
      await Promise.all(COURSES.map(async (course) => {
        try {
          const ref = db().collection('courseLeaderboards').doc(course).collection('entries').doc(user.uid);
          const snap = await ref.get();
          if (snap.exists) await ref.set({ displayName: full.slice(0, 60) }, { merge: true });
        } catch { /* classifica non raggiungibile: si aggiorna al prossimo obiettivo */ }
      }));
      document.querySelectorAll('[data-acct-sum="profile"]').forEach((el) => { el.textContent = full; });
      document.querySelectorAll('[data-account-name]').forEach((el) => { el.textContent = full; });
      setMsg(root, 'profile', 'Salvato.', 'ok');
    } catch (error) {
      setMsg(root, 'profile', error?.code === 'permission-denied' ? 'Salvataggio non permesso: riprova più tardi.' : authErrorText(error), 'error');
    } finally {
      btn.disabled = false;
    }
  }

  function strength(pw) {
    let score = 0;
    if (pw.length >= MIN_PASSWORD) score++;
    if (pw.length >= 12) score++;
    if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
    if (/\d/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;
    return Math.min(4, score);
  }
  function updateMeter(form) {
    const pw = form.querySelector('[data-acct-new]')?.value || '';
    const s = pw ? strength(pw) : 0;
    const meter = form.querySelector('[data-acct-meter]');
    const text = form.querySelector('[data-acct-meter-text]');
    if (!meter) return;
    meter.dataset.level = String(s);
    const labels = ['', 'Debole', 'Discreta', 'Buona', 'Ottima'];
    text.textContent = !pw ? `Almeno ${MIN_PASSWORD} caratteri: meglio se con lettere, numeri e un simbolo.`
      : pw.length < MIN_PASSWORD ? `Ancora ${MIN_PASSWORD - pw.length} ${MIN_PASSWORD - pw.length === 1 ? 'carattere' : 'caratteri'}.`
      : `Sicurezza: ${labels[s] || 'Debole'}.`;
  }

  async function changePassword(root, form) {
    const creating = form.dataset.acctForm === 'password-create';
    const current = form.querySelector('[data-acct-current]')?.value || '';
    const next = form.querySelector('[data-acct-new]').value;
    const again = form.querySelector('[data-acct-new2]').value;
    if (!creating && !current) return setMsg(root, 'password', 'Scrivi la password attuale.', 'error');
    if (next.length < MIN_PASSWORD) return setMsg(root, 'password', `La nuova password deve avere almeno ${MIN_PASSWORD} caratteri.`, 'error');
    if (next !== again) return setMsg(root, 'password', 'Le due nuove password non coincidono.', 'error');
    if (!creating && next === current) return setMsg(root, 'password', 'La nuova password è uguale a quella attuale.', 'error');
    const btn = form.querySelector('[type="submit"]');
    btn.disabled = true;
    setMsg(root, 'password', creating ? 'Creo la password…' : 'Cambio la password…');
    const EmailAuth = window.firebase.auth.EmailAuthProvider;
    try {
      if (creating) {
        const cred = EmailAuth.credential(user.email, next);
        try {
          await user.linkWithCredential(cred);
        } catch (error) {
          if (error?.code !== 'auth/requires-recent-login' || !hasGoogle()) throw error;
          await user.reauthenticateWithPopup(new window.firebase.auth.GoogleAuthProvider());
          await user.linkWithCredential(cred);
        }
        setMsg(root, 'password', 'Password creata: ora puoi entrare anche con email e password.', 'ok');
        setTimeout(remountAll, 1800);
      } else {
        await user.reauthenticateWithCredential(EmailAuth.credential(user.email, current));
        await user.updatePassword(next);
        form.reset();
        updateMeter(form);
        setMsg(root, 'password', 'Password cambiata. Dalla prossima volta entra con quella nuova.', 'ok');
      }
    } catch (error) {
      setMsg(root, 'password', authErrorText(error), 'error');
    } finally {
      btn.disabled = false;
    }
  }

  async function sendReset(root, btn) {
    if (!user?.email) return;
    btn.disabled = true;
    try {
      await fq().auth.sendPasswordResetEmail(user.email);
      setMsg(root, 'password', `Ti abbiamo mandato un’email a ${user.email}: apri il link per scegliere la nuova password (guarda anche nello spam).`, 'ok');
    } catch (error) {
      setMsg(root, 'password', authErrorText(error), 'error');
    } finally {
      setTimeout(() => { btn.disabled = false; }, 30000);
    }
  }

  function bind(root) {
    root.onsubmit = (event) => {
      const form = event.target.closest('[data-acct-form]');
      if (!form) return;
      event.preventDefault();
      if (form.dataset.acctForm === 'profile') saveName(root);
      else changePassword(root, form);
    };
    root.oninput = (event) => {
      const form = event.target.closest('[data-acct-form^="password"]');
      if (form && event.target.matches('[data-acct-new]')) updateMeter(form);
    };
    root.onchange = (event) => {
      if (event.target.matches('[data-acct-show]')) {
        const form = event.target.closest('form');
        form.querySelectorAll('input[data-acct-current], input[data-acct-new], input[data-acct-new2]').forEach((i) => { i.type = event.target.checked ? 'text' : 'password'; });
      }
    };
    root.onclick = (event) => {
      const reset = event.target.closest('[data-acct-reset]');
      if (reset) sendReset(root, reset);
    };
    // Una sezione aperta alla volta: il foglio resta corto anche sul telefono
    root.querySelectorAll('.acct-sec').forEach((sec) => {
      sec.addEventListener('toggle', () => {
        if (!sec.open) return;
        root.querySelectorAll('.acct-sec[open]').forEach((other) => { if (other !== sec) other.open = false; });
      });
    });
  }

  /* ---------------- Finestra (portale e Arte) ---------------- */
  function openModal() {
    if (!user || document.querySelector('.account-modal')) return;
    const modal = document.createElement('div');
    modal.className = 'modal account-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'accountModalTitle');
    modal.innerHTML = `<div class="modal-card account-modal-card">
      <div class="modal-head">
        <div class="account-modal-id">
          <span class="account-avatar" aria-hidden="true">${esc((fullName() || user.email || '?').trim().charAt(0).toUpperCase())}</span>
          <div><p class="eyebrow">Account</p><h3 id="accountModalTitle" data-account-name>${esc(fullName() || 'Il tuo account')}</h3><p class="account-email">${esc(user.email || '')}</p></div>
        </div>
        <button class="icon-btn" type="button" data-account-close aria-label="Chiudi">${ICONS.close}</button>
      </div>
      <div data-account-host></div>
      <button class="danger-btn account-logout" type="button" data-account-logout>Esci dall’account</button>
    </div>`;
    document.body.appendChild(modal);
    mount(modal.querySelector('[data-account-host]'));
    const previous = document.activeElement;
    requestAnimationFrame(() => modal.querySelector('[data-account-close]')?.focus({ preventScroll: true }));
    const close = () => { modal.remove(); try { previous?.focus?.({ preventScroll: true }); } catch { /* niente */ } };
    modal.addEventListener('click', async (event) => {
      if (event.target === modal || event.target.closest('[data-account-close]')) { close(); return; }
      if (event.target.closest('[data-account-logout]')) {
        try { await fq().auth.signOut(); } finally { close(); window.location.reload(); }
      }
    });
    modal.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.stopPropagation(); close(); } });
  }

  /* ---------------- Avvio ---------------- */
  async function onUser(u) {
    user = u;
    profile = {};
    document.querySelectorAll('[data-account-open]').forEach((b) => { b.hidden = !u; });
    if (!u) { remountAll(); return; }
    try {
      const snap = await db().collection('users').doc(u.uid).get();
      profile = snap.exists ? (snap.data()?.profile || {}) : {};
    } catch { profile = {}; }
    remountAll();
  }

  function start() {
    const auth = fq().auth;
    if (!auth || !db()) return;
    document.addEventListener('click', (event) => {
      if (event.target.closest('[data-account-open]')) openModal();
    });
    document.addEventListener('quiz:push-change', (event) => {
      document.querySelectorAll('[data-acct-sum="push"]').forEach((el) => { el.textContent = event.detail?.label || ''; });
    });
    auth.onAuthStateChanged((u) => { if (!user || !u || user.uid !== u.uid) onUser(u || null); });
  }

  window.QuizAccountPanel = Object.freeze({ open: openModal, refresh: () => onUser(user) });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(start, 0));
  else setTimeout(start, 0);
})();
