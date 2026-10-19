/* ==========================================================================
   Quiz Nuoto — notifiche push dal pannello admin (notifications-admin.js)
   - Scrivi una notifica a tutti, a un corso o a un singolo utente: va in coda
     (collezione pushQueue) e la invia il lavoro programmato su GitHub entro
     una decina di minuti (cartella notifiche/ del repository).
   - Promemoria streak: acceso/spento e orari (courseSettings/notifiche).
   - Quanti dispositivi hanno le notifiche attive e storico degli invii.
   ========================================================================== */
(() => {
  'use strict';

  if (!document.getElementById('notificationsSection')) return;
  const root = () => document.getElementById('pushAdmin');
  const fq = () => window.FirebaseQuiz || {};
  const db = () => fq().db;
  const FV = () => window.firebase.firestore.FieldValue;
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (sel, r = root()) => r.querySelector(sel);

  const COURSE_LABELS = { istruttore: 'Istruttore di Nuoto', bagnino: 'Assistenti Bagnanti Piscina', arte: 'Arte · Quinto Liceo' };
  const LINKS = { 'index.html': 'Schermata dei corsi', 'istruttore.html': 'Corso Istruttore', 'bagnino.html': 'Corso Bagnino', 'arte.html': 'Corso Arte', custom: 'Un altro link…' };
  const DEFAULT_SETTINGS = { streakReminders: true, hours: [18, 21] };

  let admin = null;
  let users = [];
  let settings = { ...DEFAULT_SETTINGS };
  let started = false;

  function toast(message) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = message;
    t.classList.remove('hidden');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.add('hidden'), 3000);
  }
  function toDate(v) {
    if (!v) return null;
    if (typeof v.toDate === 'function') return v.toDate();
    if (typeof v.seconds === 'number') return new Date(v.seconds * 1000);
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const fmt = (v) => { const d = toDate(v); return d ? d.toLocaleString('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''; };

  function shell() {
    const r = root();
    r.innerHTML = `
      <section class="panel">
        <div class="section-title compact-title"><div><h3>Manda una notifica</h3>
          <p class="message">Arriva sul telefono o sul computer di chi ha attivato le notifiche, entro una decina di minuti.</p></div></div>
        <div class="push-admin-stats" data-push-stats><p class="message">Conto i dispositivi…</p></div>
        <div class="admin-form push-admin-form">
          <label for="pnTitle">Titolo</label>
          <input id="pnTitle" type="text" maxlength="60" placeholder="Es. Nuove domande nel corso Istruttore" />
          <label for="pnBody">Messaggio</label>
          <textarea id="pnBody" rows="3" maxlength="240" placeholder="Testo breve: si legge nella notifica"></textarea>
          <label for="pnTarget">Destinatari</label>
          <select id="pnTarget">
            <option value="all">Tutti</option>
            <option value="course:istruttore">Corso Istruttore di Nuoto</option>
            <option value="course:bagnino">Corso Assistenti Bagnanti Piscina</option>
            <option value="course:arte">Corso Arte · Quinto Liceo</option>
            <option value="user">Un utente</option>
          </select>
          <div data-pn-user hidden>
            <label for="pnUserSearch">Utente</label>
            <input id="pnUserSearch" type="search" placeholder="Cerca per nome o email…" />
            <select id="pnUser" size="5"></select>
          </div>
          <label for="pnLink">Toccando la notifica si apre</label>
          <select id="pnLink">${Object.entries(LINKS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
          <input id="pnCustom" type="url" placeholder="https://…" hidden />
          <div class="push-admin-preview" data-pn-preview></div>
          <button class="primary-btn" type="button" data-pn-act="send">Metti in invio</button>
          <p class="message" data-pn-msg></p>
          <p class="request-meta">Per farla partire subito senza aspettare: apri <a href="https://github.com/ChXxXxX9/quizfin/actions/workflows/notifiche.yml" target="_blank" rel="noopener">Notifiche su GitHub</a> e premi <strong>Run workflow</strong>.</p>
          <details class="pn-howto">
            <summary>Notifiche puntuali ogni 5 minuti (da fare una volta)</summary>
            <p class="request-meta">GitHub fa partire da solo l'invio solo ogni qualche ora. Con un servizio gratuito che lo avvia ogni 5 minuti, promemoria, avvisi delle richieste e notifiche dello staff arrivano in pochi minuti.</p>
            <ol class="request-meta">
              <li>Su GitHub: foto profilo → <strong>Settings</strong> → <strong>Developer settings</strong> → <strong>Personal access tokens</strong> → <strong>Fine-grained tokens</strong> → <strong>Generate new token</strong>. Nome: <em>Quiz Nuoto notifiche</em>; scadenza: la più lunga; <strong>Only select repositories</strong> → <em>quizfin</em>; in <strong>Repository permissions</strong> metti <strong>Actions: Read and write</strong>. Copia il token (non incollarlo da nessun'altra parte).</li>
              <li>Su <a href="https://cron-job.org" target="_blank" rel="noopener">cron-job.org</a> (gratis): <strong>Create cronjob</strong>. URL: <code>https://api.github.com/repos/ChXxXxX9/quizfin/actions/workflows/notifiche.yml/dispatches</code>; ogni <strong>5 minuti</strong>.</li>
              <li>Nella scheda <strong>Advanced</strong>: metodo <strong>POST</strong>; intestazioni <code>Authorization: Bearer</code> + il token, <code>Accept: application/vnd.github+json</code>, <code>X-GitHub-Api-Version: 2022-11-28</code>; corpo <code>{"ref":"main"}</code>. Salva e premi <strong>Test run</strong>: deve rispondere <strong>204</strong>.</li>
            </ol>
          </details>
        </div>
      </section>

      <section class="panel">
        <div class="section-title compact-title"><div><h3>Promemoria streak</h3>
          <p class="message">A chi ha un obiettivo e non l'ha ancora raggiunto oggi arriva un avviso con quante domande mancano e quanto tempo resta fino a mezzanotte.</p></div></div>
        <div class="admin-form">
          <label class="checkline"><input id="pnStreakOn" type="checkbox" /> Promemoria attivi</label>
          <label>Orari (ora italiana)</label>
          <div class="push-hours">${[12, 14, 16, 17, 18, 19, 20, 21, 22, 23].map((h) => `<label class="ann-chip"><input type="checkbox" data-pn-hour="${h}"><span>${h}:00</span></label>`).join('')}</div>
          <button class="secondary-btn" type="button" data-pn-act="save-settings">Salva promemoria</button>
        </div>
      </section>

      <section class="panel">
        <div class="section-title compact-title"><div><h3>Avvisi per l'admin</h3>
          <p class="message">Una notifica sui dispositivi degli admin quando qualcuno chiede un account, l'accesso a un corso o un ricontrollo. Gli utenti non la ricevono.</p></div></div>
        <div class="admin-form">
          <label class="checkline"><input id="pnAdminReq" type="checkbox" /> Avvisami delle nuove richieste</label>
          <p class="request-meta" data-pn-admin-devices></p>
          <button class="secondary-btn" type="button" data-pn-act="save-admin">Salva</button>
        </div>
      </section>

      <section class="panel">
        <div class="section-title compact-title"><h3>Ultimi invii</h3><button class="secondary-btn small-btn" type="button" data-pn-act="reload">Aggiorna</button></div>
        <div class="admin-list" data-pn-history><p class="message">Carico…</p></div>
      </section>`;
    bind();
    updatePreview();
  }

  function updatePreview() {
    const title = $('#pnTitle').value.trim() || 'Titolo della notifica';
    const body = $('#pnBody').value.trim() || 'Testo della notifica';
    $('[data-pn-preview]').innerHTML = `<div class="push-preview"><img src="icon-192.png" alt=""><div><small>Quiz Nuoto · ora</small><strong>${esc(title)}</strong><span>${esc(body)}</span></div></div>`;
    const target = $('#pnTarget').value;
    $('[data-pn-user]').hidden = target !== 'user';
    $('#pnCustom').hidden = $('#pnLink').value !== 'custom';
  }
  function renderUsers() {
    const q = ($('#pnUserSearch').value || '').trim().toLowerCase();
    const sel = $('#pnUser');
    const filtered = users.filter((u) => !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)).slice(0, 200);
    sel.innerHTML = filtered.map((u) => `<option value="${esc(u.uid)}" data-name="${esc(u.name)}">${esc(u.name)}${u.email && u.email !== u.name ? ` · ${esc(u.email)}` : ''} ${u.devices ? `· 🔔 ${u.devices}` : '· (notifiche spente)'}</option>`).join('');
  }

  async function loadUsers() {
    users = [];
    const snap = await db().collection('users').limit(1000).get();
    snap.forEach((doc) => {
      const data = doc.data() || {};
      const p = data.profile || {};
      const tokens = Array.isArray(data.push?.tokens) ? data.push.tokens.length : 0;
      const name = [p.firstName, p.lastName].filter(Boolean).join(' ') || p.displayName || p.email || doc.id;
      users.push({ uid: doc.id, name, email: p.email || '', devices: tokens, streak: data.push?.streak !== false, access: data.access || {} });
    });
    users.sort((a, b) => a.name.localeCompare(b.name, 'it'));
    const withPush = users.filter((u) => u.devices > 0);
    const devices = withPush.reduce((n, u) => n + u.devices, 0);
    $('[data-push-stats]').innerHTML = `<div class="stats-grid compact-stats">
      <div class="stat-card"><strong>${withPush.length}</strong><span>utenti con notifiche attive</span></div>
      <div class="stat-card"><strong>${devices}</strong><span>dispositivi</span></div>
      <div class="stat-card"><strong>${withPush.filter((u) => u.streak).length}</strong><span>con promemoria streak</span></div>
    </div>`;
    renderUsers();
    const me = users.find((u) => u.uid === admin?.uid);
    const devicesBox = $('[data-pn-admin-devices]');
    if (devicesBox) devicesBox.textContent = me?.devices
      ? `Il tuo account ha ${me.devices} ${me.devices === 1 ? 'dispositivo' : 'dispositivi'} con le notifiche attive.`
      : 'Il tuo account non ha ancora dispositivi con le notifiche: attivale da Account sul telefono per ricevere gli avvisi.';
  }
  async function loadSettings() {
    try {
      const snap = await db().collection('courseSettings').doc('notifiche').get();
      const d = snap.exists ? (snap.data() || {}) : {};
      settings = { streakReminders: d.streakReminders !== false, hours: Array.isArray(d.hours) && d.hours.length ? d.hours.map(Number) : DEFAULT_SETTINGS.hours, adminRequests: d.adminRequests !== false };
    } catch { settings = { ...DEFAULT_SETTINGS }; }
    $('#pnStreakOn').checked = settings.streakReminders;
    $('#pnAdminReq').checked = settings.adminRequests !== false;
    root().querySelectorAll('[data-pn-hour]').forEach((i) => { i.checked = settings.hours.includes(Number(i.dataset.pnHour)); });
  }
  async function loadHistory() {
    const box = $('[data-pn-history]');
    try {
      const snap = await db().collection('pushQueue').limit(100).get();
      const rows = [];
      snap.forEach((doc) => rows.push({ id: doc.id, ...(doc.data() || {}) }));
      rows.sort((a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0));
      if (!rows.length) { box.innerHTML = '<p class="message">Nessuna notifica inviata finora.</p>'; return; }
      box.innerHTML = rows.slice(0, 30).map((r) => {
        const t = r.target || {};
        const who = t.type === 'course' ? `Corso ${COURSE_LABELS[t.course] || t.course}` : t.type === 'user' ? `Utente: ${t.name || t.uid}` : 'Tutti';
        const st = r.status === 'sent'
          ? `<span class="status-pill">Inviata · ${Number(r.stats?.ok || 0)} dispositivi</span>`
          : r.status === 'error' ? '<span class="status-pill danger">Errore</span>' : '<span class="status-pill warning">In coda</span>';
        return `<article class="request-card" data-pn-row="${esc(r.id)}">
          <div class="user-headline"><strong>${esc(r.title || '')}</strong>${st}</div>
          <p class="request-meta">${esc(r.body || '')}</p>
          <p class="request-meta">${esc(who)} · creata ${esc(fmt(r.createdAt))}${r.sentAt ? ` · inviata ${esc(fmt(r.sentAt))}` : ''}${r.stats?.failed ? ` · ${r.stats.failed} non consegnate` : ''}${r.error ? ` · ${esc(r.error)}` : ''}</p>
          ${r.status === 'pending' ? '<div class="request-actions"><button class="ghost-btn small-btn" type="button" data-pn-cancel>Annulla</button></div>' : ''}
        </article>`;
      }).join('');
    } catch (error) {
      box.innerHTML = `<p class="message">Storico non letto: ${esc(error.message)}</p>`;
    }
  }

  async function send() {
    const msg = $('[data-pn-msg]');
    const title = $('#pnTitle').value.trim();
    const body = $('#pnBody').value.trim();
    if (!title || !body) { msg.textContent = 'Scrivi titolo e messaggio.'; return; }
    const targetVal = $('#pnTarget').value;
    let target = { type: 'all' };
    if (targetVal.startsWith('course:')) target = { type: 'course', course: targetVal.slice(7) };
    if (targetVal === 'user') {
      const opt = $('#pnUser').selectedOptions[0];
      if (!opt) { msg.textContent = 'Scegli l’utente.'; return; }
      target = { type: 'user', uid: opt.value, name: opt.dataset.name || '' };
    }
    let url = $('#pnLink').value;
    if (url === 'custom') {
      url = $('#pnCustom').value.trim();
      if (!/^https?:\/\//i.test(url)) { msg.textContent = 'Il link deve iniziare con https://'; return; }
    }
    msg.textContent = 'Metto in coda…';
    try {
      await db().collection('pushQueue').add({ title, body, url, target, status: 'pending', createdAt: FV().serverTimestamp(), createdBy: admin.uid });
      msg.textContent = '';
      $('#pnTitle').value = '';
      $('#pnBody').value = '';
      updatePreview();
      toast('Notifica in coda: parte entro una decina di minuti.');
      loadHistory();
    } catch (error) {
      msg.textContent = error?.code === 'permission-denied' ? 'Firestore ha rifiutato: questo account è admin? Le regole aggiornate sono pubblicate?' : error.message;
    }
  }
  async function saveSettings() {
    const hours = [...root().querySelectorAll('[data-pn-hour]:checked')].map((i) => Number(i.dataset.pnHour)).sort((a, b) => a - b);
    try {
      await db().collection('courseSettings').doc('notifiche').set({ streakReminders: $('#pnStreakOn').checked, hours, updatedAt: FV().serverTimestamp(), updatedBy: admin.uid }, { merge: true });
      toast('Promemoria salvati.');
    } catch (error) { toast(`Non salvato: ${error.message}`); }
  }

  async function saveAdminSettings() {
    try {
      await db().collection('courseSettings').doc('notifiche').set({ adminRequests: $('#pnAdminReq').checked, updatedAt: FV().serverTimestamp(), updatedBy: admin.uid }, { merge: true });
      toast($('#pnAdminReq').checked ? 'Ti avviseremo delle nuove richieste.' : 'Avvisi delle richieste spenti.');
    } catch (error) { toast(`Non salvato: ${error.message}`); }
  }

  function bind() {
    const r = root();
    r.addEventListener('input', (e) => { if (e.target.id === 'pnUserSearch') renderUsers(); updatePreview(); });
    r.addEventListener('change', updatePreview);
    r.addEventListener('click', async (e) => {
      const act = e.target.closest('[data-pn-act]')?.dataset.pnAct;
      if (act === 'send') send();
      if (act === 'save-settings') saveSettings();
      if (act === 'save-admin') saveAdminSettings();
      if (act === 'reload') { loadHistory(); loadUsers(); }
      const cancel = e.target.closest('[data-pn-cancel]');
      if (cancel) {
        const id = cancel.closest('[data-pn-row]')?.dataset.pnRow;
        try { await db().collection('pushQueue').doc(id).delete(); toast('Invio annullato.'); loadHistory(); } catch (error) { toast(error.message); }
      }
    });
  }

  function start() {
    if (started) return;
    const auth = fq().auth;
    if (!auth || !db() || !root()) return;
    started = true;
    shell();
    auth.onAuthStateChanged(async (u) => {
      if (!u) return;
      admin = u;
      await Promise.allSettled([loadUsers(), loadSettings(), loadHistory()]);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(start, 0));
  else setTimeout(start, 0);
})();
