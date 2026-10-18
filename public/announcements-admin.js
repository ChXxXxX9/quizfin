/* ==========================================================================
   Quiz Nuoto — composer degli annunci nel pannello admin (announcements-admin.js)
   Crea, modifica, duplica, attiva/disattiva ed elimina gli annunci, con
   anteprima dal vivo identica a quella che vedono gli utenti.
   ========================================================================== */
(() => {
  'use strict';

  const root = () => document.getElementById('annAdmin');
  if (!document.getElementById('announcementsSection')) return;

  const fq = () => window.FirebaseQuiz || {};
  const db = () => fq().db;
  const FV = () => window.firebase.firestore.FieldValue;
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (sel, r = document) => r.querySelector(sel);
  const $$ = (sel, r = document) => Array.from(r.querySelectorAll(sel));

  const COURSE_LABELS = { istruttore: 'Istruttore di Nuoto', bagnino: 'Assistenti Bagnanti Piscina', arte: 'Arte · Quinto Liceo' };
  const DISPLAY_LABELS = { popup: 'Popup', banner: 'Banner in cima', fullscreen: 'Schermo intero' };
  const TONE_LABELS = { info: 'Info', success: 'Novità', warning: 'Avviso', danger: 'Importante', event: 'Evento' };
  const FREQ_LABELS = { once: 'Una volta', daily: 'Una volta al giorno', everyVisit: 'A ogni accesso', times: 'Un numero di volte', always: 'Sempre (fisso)' };
  const WHERE_LABELS = { portal: 'Schermata dei corsi', courses: 'Dentro i corsi', everywhere: 'Ovunque' };
  const MAX_IMAGE_CHARS = 320 * 1024; // resta leggero: ogni utente lo scarica a ogni accesso

  let admin = null;
  let list = [];
  let users = null;
  let editingId = null;
  let draft = emptyDraft();
  let started = false;

  function emptyDraft() {
    return {
      title: '', body: '', display: 'popup', tone: 'info', image: null, qr: null,
      buttons: [{ label: '', url: '' }, { label: '', url: '' }, { label: '', url: '' }],
      requireAck: false, ackLabel: 'OK, ho letto',
      scope: 'global', where: 'portal', targetUid: '', targetName: '',
      startAt: '', endAt: '', frequency: 'once', maxViews: 3, dismissible: true, active: true
    };
  }

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
    if (v instanceof Date) return v;
    if (typeof v.toDate === 'function') return v.toDate();
    if (typeof v.seconds === 'number') return new Date(v.seconds * 1000);
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  function toLocalInput(v) {
    const d = toDate(v);
    if (!d) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function fmt(v) {
    const d = toDate(v);
    return d ? d.toLocaleString('it-IT', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  }
  function plainText(markup) {
    return String(markup || '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1').replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)').replace(/^#{1,3}\s+/gm, '').trim();
  }

  /* ---------------- Struttura del pannello ---------------- */
  function chips(name, options, value) {
    return `<div class="ann-chips" role="radiogroup">${Object.entries(options).map(([k, label]) => `<label class="ann-chip"><input type="radio" name="${name}" value="${k}" ${k === value ? 'checked' : ''}><span>${esc(label)}</span></label>`).join('')}</div>`;
  }
  function renderShell() {
    const r = root();
    if (!r) return;
    r.innerHTML = `
      <section class="panel ann-composer">
        <div class="section-title compact-title">
          <div><h3 data-ann-heading>Nuovo annuncio</h3><p class="message">Scrivi, scegli come appare, chi lo vede e per quanto: a destra vedi l'anteprima esatta.</p></div>
          <button class="ghost-btn small-btn" type="button" data-ann-act="new">Nuovo</button>
        </div>
        <div class="ann-composer-grid">
          <form class="ann-form" autocomplete="off" onsubmit="return false">
            <fieldset><legend>Contenuto</legend>
              <label for="annfTitle">Titolo</label>
              <input id="annfTitle" data-f="title" type="text" maxlength="120" placeholder="Es. Lezione spostata a giovedì" />
              <label for="annfBody">Testo</label>
              <div class="ann-toolbar" role="toolbar" aria-label="Formattazione">
                <button type="button" data-fmt="bold" title="Grassetto"><b>B</b></button>
                <button type="button" data-fmt="italic" title="Corsivo"><i>I</i></button>
                <button type="button" data-fmt="link" title="Link">🔗 Link</button>
                <button type="button" data-fmt="list" title="Elenco">• Elenco</button>
                <button type="button" data-fmt="heading" title="Titoletto">Titoletto</button>
              </div>
              <textarea id="annfBody" data-f="body" rows="7" maxlength="4000" placeholder="Scrivi qui. **grassetto**, *corsivo*, [testo del link](https://…), elenchi con - all'inizio della riga."></textarea>
              <p class="ann-hint">Formattazione: <code>**grassetto**</code> · <code>*corsivo*</code> · <code>[testo](https://link)</code> · righe che iniziano con <code>-</code> diventano un elenco. I link scritti per intero diventano cliccabili da soli.</p>
            </fieldset>

            <fieldset><legend>Aspetto</legend>
              <label>Come appare</label>
              ${chips('annDisplay', DISPLAY_LABELS, 'popup')}
              <label>Colore</label>
              ${chips('annTone', TONE_LABELS, 'info')}
            </fieldset>

            <fieldset><legend>Immagine o foto</legend>
              <div class="ann-image-row">
                <label class="secondary-btn small-btn ann-file">Carica dal dispositivo<input id="annfFile" type="file" accept="image/*" hidden /></label>
                <button class="ghost-btn small-btn" type="button" data-ann-act="image-remove">Togli immagine</button>
              </div>
              <label for="annfImageUrl">…oppure link di un'immagine</label>
              <input id="annfImageUrl" type="url" placeholder="https://…/foto.jpg" />
              <label for="annfImageAlt">Descrizione dell'immagine (per chi non la vede)</label>
              <input id="annfImageAlt" type="text" maxlength="160" />
              <label class="checkline"><input id="annfImageContain" type="checkbox" /> Mostra l'immagine intera (senza ritagliarla)</label>
              <p class="ann-hint" data-ann-image-info>Le foto caricate vengono ridotte e salvate dentro l'annuncio.</p>
            </fieldset>

            <fieldset><legend>QR code</legend>
              <label for="annfQr">Link o testo del QR code</label>
              <input id="annfQr" type="text" maxlength="1200" placeholder="https://… (vuoto = niente QR)" />
              <label for="annfQrCaption">Didascalia</label>
              <input id="annfQrCaption" type="text" maxlength="120" placeholder="Es. Inquadra per iscriverti" />
            </fieldset>

            <fieldset><legend>Pulsanti con link</legend>
              ${[0, 1, 2].map((i) => `<div class="ann-btn-row"><input data-btn-label="${i}" type="text" maxlength="40" placeholder="Pulsante ${i + 1}" /><input data-btn-url="${i}" type="url" placeholder="https://…" /></div>`).join('')}
            </fieldset>

            <fieldset><legend>Conferma di lettura</legend>
              <label class="checkline"><input id="annfAck" type="checkbox" /> L'utente deve premere un pulsante di conferma (finché non lo fa, l'annuncio ricompare)</label>
              <label for="annfAckLabel">Testo del pulsante</label>
              <input id="annfAckLabel" type="text" maxlength="40" value="OK, ho letto" />
            </fieldset>

            <fieldset><legend>Chi lo vede</legend>
              <label for="annfScope">Destinatari</label>
              <select id="annfScope">
                <option value="global">Tutti gli utenti</option>
                <option value="istruttore">Solo corso Istruttore di Nuoto</option>
                <option value="bagnino">Solo corso Assistenti Bagnanti Piscina</option>
                <option value="arte">Solo corso Arte · Quinto Liceo</option>
                <option value="user">Un utente</option>
              </select>
              <div data-ann-where>
                <label for="annfWhere">Dove</label>
                <select id="annfWhere">${Object.entries(WHERE_LABELS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
              </div>
              <div data-ann-user hidden>
                <label for="annfUserSearch">Utente</label>
                <input id="annfUserSearch" type="search" placeholder="Cerca per nome o email…" />
                <select id="annfUser" size="5"></select>
              </div>
            </fieldset>

            <fieldset><legend>Quando e quante volte</legend>
              <div class="ann-two">
                <div><label for="annfStart">Dal (facoltativo)</label><input id="annfStart" type="datetime-local" /></div>
                <div><label for="annfEnd">Fino al (facoltativo)</label><input id="annfEnd" type="datetime-local" /></div>
              </div>
              <label for="annfFreq">Frequenza</label>
              <select id="annfFreq">${Object.entries(FREQ_LABELS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
              <div data-ann-times hidden><label for="annfTimes">Quante volte</label><input id="annfTimes" type="number" min="1" max="50" value="3" /></div>
              <label class="checkline" data-ann-dismiss><input id="annfDismiss" type="checkbox" checked /> Il banner si può chiudere</label>
              <label class="checkline" data-ann-again hidden><input id="annfAgain" type="checkbox" /> Mostralo di nuovo a tutti, anche a chi l'ha già visto o confermato</label>
              <p class="ann-hint">Per non mostrarlo a nessuno salvalo come bozza o disattivalo dall'elenco.</p>
            </fieldset>

            <div class="ann-form-actions">
              <button class="primary-btn" type="button" data-ann-act="publish">Pubblica</button>
              <button class="secondary-btn" type="button" data-ann-act="draft">Salva come bozza</button>
              <button class="ghost-btn" type="button" data-ann-act="preview">Prova come utente</button>
            </div>
            <p class="message" data-ann-msg></p>
          </form>

          <aside class="ann-preview-pane" aria-label="Anteprima">
            <p class="settings-group-title">Anteprima</p>
            <div data-ann-preview></div>
            <p class="ann-hint" data-ann-summary></p>
          </aside>
        </div>
      </section>

      <section class="panel">
        <div class="section-title compact-title">
          <h3>Tutti gli annunci</h3>
          <button class="secondary-btn small-btn" type="button" data-ann-act="reload">Aggiorna</button>
        </div>
        <div data-ann-list class="admin-list"><p class="message">Carico…</p></div>
      </section>`;
    bind();
    fillForm(draft);
    updatePreview();
  }

  /* ---------------- Modulo ↔ bozza ---------------- */
  function fillForm(d) {
    const r = root();
    $('#annfTitle', r).value = d.title;
    $('#annfBody', r).value = d.body;
    $$('input[name="annDisplay"]', r).forEach((i) => { i.checked = i.value === d.display; });
    $$('input[name="annTone"]', r).forEach((i) => { i.checked = i.value === d.tone; });
    $('#annfImageUrl', r).value = d.image && !String(d.image.src).startsWith('data:') ? d.image.src : '';
    $('#annfImageAlt', r).value = d.image?.alt || '';
    $('#annfImageContain', r).checked = d.image?.fit === 'contain';
    $('#annfQr', r).value = d.qr?.text || '';
    $('#annfQrCaption', r).value = d.qr?.caption || '';
    [0, 1, 2].forEach((i) => {
      $(`[data-btn-label="${i}"]`, r).value = d.buttons[i]?.label || '';
      $(`[data-btn-url="${i}"]`, r).value = d.buttons[i]?.url || '';
    });
    $('#annfAck', r).checked = Boolean(d.requireAck);
    $('#annfAckLabel', r).value = d.ackLabel || 'OK, ho letto';
    $('#annfScope', r).value = d.scope;
    $('#annfWhere', r).value = d.where;
    $('#annfStart', r).value = toLocalInput(d.startAt);
    $('#annfEnd', r).value = toLocalInput(d.endAt);
    $('#annfFreq', r).value = d.frequency;
    $('#annfTimes', r).value = d.maxViews || 3;
    $('#annfDismiss', r).checked = d.dismissible !== false;
    $('#annfAgain', r).checked = false;
    $('[data-ann-again]', r).hidden = !editingId;
    $('[data-ann-heading]', r).textContent = editingId ? 'Modifica annuncio' : 'Nuovo annuncio';
    $('[data-ann-act="publish"]', r).textContent = editingId ? 'Salva e pubblica' : 'Pubblica';
    updateImageInfo();
    syncVisibility();
    if (d.scope === 'user') ensureUsers().then(() => renderUserOptions(d.targetUid));
  }
  function readForm() {
    const r = root();
    const imageUrl = $('#annfImageUrl', r).value.trim();
    let image = draft.image && String(draft.image.src).startsWith('data:') ? { ...draft.image } : null;
    if (imageUrl) image = { src: imageUrl };
    if (image) {
      image.alt = $('#annfImageAlt', r).value.trim();
      image.fit = $('#annfImageContain', r).checked ? 'contain' : 'cover';
    }
    const qrText = $('#annfQr', r).value.trim();
    const userSel = $('#annfUser', r);
    draft = {
      ...draft,
      title: $('#annfTitle', r).value.trim(),
      body: $('#annfBody', r).value,
      display: $('input[name="annDisplay"]:checked', r)?.value || 'popup',
      tone: $('input[name="annTone"]:checked', r)?.value || 'info',
      image,
      qr: qrText ? { text: qrText, caption: $('#annfQrCaption', r).value.trim() } : null,
      buttons: [0, 1, 2].map((i) => ({ label: $(`[data-btn-label="${i}"]`, r).value.trim(), url: $(`[data-btn-url="${i}"]`, r).value.trim() })),
      requireAck: $('#annfAck', r).checked,
      ackLabel: $('#annfAckLabel', r).value.trim() || 'OK, ho letto',
      scope: $('#annfScope', r).value,
      where: $('#annfWhere', r).value,
      targetUid: $('#annfScope', r).value === 'user' ? (userSel?.value || draft.targetUid || '') : '',
      targetName: $('#annfScope', r).value === 'user' ? (userSel?.selectedOptions?.[0]?.dataset.name || draft.targetName || '') : '',
      startAt: $('#annfStart', r).value,
      endAt: $('#annfEnd', r).value,
      frequency: $('#annfFreq', r).value,
      maxViews: Math.max(1, Math.min(50, Number($('#annfTimes', r).value) || 3)),
      dismissible: $('#annfDismiss', r).checked
    };
    return draft;
  }
  function syncVisibility() {
    const r = root();
    const scope = $('#annfScope', r).value;
    $('[data-ann-where]', r).hidden = scope !== 'global';
    $('[data-ann-user]', r).hidden = scope !== 'user';
    $('[data-ann-times]', r).hidden = $('#annfFreq', r).value !== 'times';
    const display = $('input[name="annDisplay"]:checked', r)?.value;
    $('[data-ann-dismiss]', r).hidden = display !== 'banner';
    $('#annfAckLabel', r).disabled = !$('#annfAck', r).checked;
    const always = $('#annfFreq option[value="always"]', r);
    if (always) always.textContent = display === 'banner' ? 'Sempre (banner fisso)' : 'Sempre (a ogni accesso)';
  }
  function summary(d) {
    const who = d.scope === 'global' ? `Tutti · ${WHERE_LABELS[d.where]}` : d.scope === 'user' ? `Solo ${d.targetName || 'un utente'}` : `Corso ${COURSE_LABELS[d.scope]}`;
    const freq = d.frequency === 'times' ? `${d.maxViews} volte` : FREQ_LABELS[d.frequency];
    const when = [d.startAt ? `dal ${fmt(d.startAt)}` : '', d.endAt ? `fino al ${fmt(d.endAt)}` : ''].filter(Boolean).join(' ') || 'da subito, senza scadenza';
    return `${DISPLAY_LABELS[d.display]} · ${who} · ${freq} · ${when}${d.requireAck ? ' · con conferma' : ''}`;
  }
  function updatePreview() {
    const r = root();
    if (!r || !window.QuizAnnouncements) return;
    const d = readForm();
    const a = window.QuizAnnouncements.normalize({ ...d, buttons: d.buttons.filter((b) => b.label && b.url) });
    $('[data-ann-preview]', r).innerHTML = `<div class="ann-preview-frame ann-preview-${d.display}">${window.QuizAnnouncements.render(a, { preview: true })}${d.requireAck && d.display !== 'banner' ? `<div class="ann-footer"><button class="primary-btn" type="button" tabindex="-1">${esc(d.ackLabel)}</button></div>` : ''}</div>`;
    $('[data-ann-summary]', r).textContent = summary(d);
  }

  /* ---------------- Immagine ---------------- */
  function updateImageInfo() {
    const r = root();
    const info = $('[data-ann-image-info]', r);
    if (!info) return;
    const src = draft.image?.src || '';
    info.textContent = src.startsWith('data:')
      ? `Foto caricata (${Math.round(src.length / 1024)} KB).`
      : 'Le foto caricate vengono ridotte e salvate dentro l’annuncio.';
  }
  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Immagine non leggibile.')); };
      img.src = url;
    });
  }
  async function compress(file) {
    const img = await loadImage(file);
    let maxSide = 1200;
    let quality = 0.8;
    for (let attempt = 0; attempt < 8; attempt++) {
      const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      const data = canvas.toDataURL('image/jpeg', quality);
      if (data.length <= MAX_IMAGE_CHARS) return data;
      if (quality > 0.6) quality -= 0.1; else maxSide = Math.round(maxSide * 0.8);
    }
    throw new Error('Foto troppo grande anche dopo la riduzione: prova con un’altra.');
  }

  /* ---------------- Utenti (per gli annunci a un singolo utente) ---------------- */
  async function ensureUsers() {
    if (users) return users;
    users = [];
    try {
      const snap = await db().collection('users').limit(500).get();
      snap.forEach((doc) => {
        const p = doc.data()?.profile || {};
        const name = [p.firstName, p.lastName].filter(Boolean).join(' ') || p.displayName || '';
        users.push({ uid: doc.id, name: name || p.email || doc.id, email: p.email || '' });
      });
      users.sort((a, b) => a.name.localeCompare(b.name, 'it'));
    } catch (error) { toast(`Utenti non caricati: ${error.message}`); }
    return users;
  }
  function renderUserOptions(selected) {
    const r = root();
    const q = ($('#annfUserSearch', r)?.value || '').trim().toLowerCase();
    const sel = $('#annfUser', r);
    if (!sel || !users) return;
    const filtered = users.filter((u) => !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)).slice(0, 200);
    sel.innerHTML = filtered.map((u) => `<option value="${esc(u.uid)}" data-name="${esc(u.name)}" ${u.uid === selected ? 'selected' : ''}>${esc(u.name)}${u.email && u.email !== u.name ? ` · ${esc(u.email)}` : ''}</option>`).join('');
  }

  /* ---------------- Salvataggio ---------------- */
  function validate(d) {
    if (!d.title) return 'Scrivi un titolo.';
    if (!d.body.trim() && !d.image && !d.qr) return 'Aggiungi un testo, un’immagine o un QR code.';
    if (d.scope === 'user' && !d.targetUid) return 'Scegli l’utente a cui mandarlo.';
    const badBtn = d.buttons.find((b) => (b.label && !b.url) || (!b.label && b.url));
    if (badBtn) return 'Ogni pulsante ha bisogno sia del testo sia del link.';
    const badUrl = d.buttons.find((b) => b.url && !/^(https?:\/\/|mailto:|tel:|[\w./-]+\.html)/i.test(b.url));
    if (badUrl) return `Link del pulsante non valido: ${badUrl.url}`;
    if (d.image && !String(d.image.src).startsWith('data:') && !/^https?:\/\//i.test(d.image.src)) return 'Il link dell’immagine deve iniziare con https://';
    if (d.startAt && d.endAt && new Date(d.endAt) <= new Date(d.startAt)) return 'La data di fine deve venire dopo quella di inizio.';
    return '';
  }
  function asTimestamp(local) {
    if (!local) return null;
    const d = new Date(local);
    if (Number.isNaN(d.getTime())) return null;
    const T = window.firebase?.firestore?.Timestamp;
    return T?.fromDate ? T.fromDate(d) : d;
  }
  async function save(active) {
    const r = root();
    const d = readForm();
    const problem = validate(d);
    const msg = $('[data-ann-msg]', r);
    if (problem) { msg.textContent = problem; return; }
    msg.textContent = 'Salvo…';
    const payload = {
      version: 2,
      title: d.title,
      body: d.body,
      message: plainText(d.body).slice(0, 2000),
      display: d.display,
      tone: d.tone,
      image: d.image || null,
      qr: d.qr || null,
      buttons: d.buttons.filter((b) => b.label && b.url),
      requireAck: d.requireAck,
      ackLabel: d.ackLabel,
      scope: d.scope,
      where: d.scope === 'global' ? d.where : 'everywhere',
      targetUid: d.scope === 'user' ? d.targetUid : null,
      targetName: d.scope === 'user' ? d.targetName : null,
      startAt: asTimestamp(d.startAt),
      endAt: asTimestamp(d.endAt),
      frequency: d.frequency,
      maxViews: d.maxViews,
      dismissible: d.dismissible,
      active,
      rev: editingId && $('#annfAgain', r).checked ? (d.rev || 0) + 1 : (d.rev || 0),
      updatedAt: FV().serverTimestamp(),
      updatedBy: admin.uid
    };
    const size = JSON.stringify(payload).length;
    if (size > 950 * 1024) { msg.textContent = 'L’annuncio è troppo pesante: usa una foto più piccola.'; return; }
    try {
      if (editingId) {
        await db().collection('announcements').doc(editingId).set(payload, { merge: true });
      } else {
        await db().collection('announcements').add({ ...payload, createdAt: FV().serverTimestamp(), createdBy: admin.uid });
      }
      msg.textContent = '';
      toast(active ? (editingId ? 'Annuncio aggiornato e pubblicato.' : 'Annuncio pubblicato.') : 'Bozza salvata.');
      editingId = null;
      draft = emptyDraft();
      fillForm(draft);
      updatePreview();
      await reload();
    } catch (error) {
      msg.textContent = error?.code === 'permission-denied' ? 'Firestore ha rifiutato il salvataggio: questo account è admin?' : `Salvataggio non riuscito: ${error.message}`;
    }
  }

  /* ---------------- Elenco ---------------- */
  function statusOf(a) {
    const now = Date.now();
    if (!a.active) return { key: 'draft', label: 'Bozza / spento' };
    if (a.startAt && a.startAt.getTime() > now) return { key: 'scheduled', label: `Programmato · ${fmt(a.startAt)}` };
    if (a.endAt && a.endAt.getTime() < now) return { key: 'expired', label: 'Scaduto' };
    return { key: 'live', label: 'Attivo' };
  }
  async function reload() {
    const r = root();
    if (!r || !db() || !admin) return;
    const box = $('[data-ann-list]', r);
    try {
      const snap = await db().collection('announcements').limit(200).get();
      list = [];
      snap.forEach((doc) => {
        const raw = doc.data() || {};
        const a = window.QuizAnnouncements.normalize(raw, doc.id);
        a.raw = raw;
        list.push(a);
      });
      list.sort((x, y) => (y.createdAt?.getTime() || 0) - (x.createdAt?.getTime() || 0));
      if (!list.length) { box.innerHTML = '<p class="message">Nessun annuncio ancora. Creane uno qui sopra.</p>'; return; }
      box.innerHTML = list.map((a) => {
        const st = statusOf(a);
        const who = a.scope === 'global' ? `Tutti · ${WHERE_LABELS[a.where] || 'Schermata dei corsi'}` : a.scope === 'user' ? `Utente: ${a.raw.targetName || a.targetUid}` : `Corso ${COURSE_LABELS[a.scope] || a.scope}`;
        return `<article class="request-card ann-admin-card" data-ann-row="${esc(a.id)}">
          <div class="user-headline"><strong>${esc(a.title)}</strong><span class="status-pill ${st.key === 'live' ? '' : st.key === 'draft' || st.key === 'expired' ? 'warning' : ''}">${esc(st.label)}</span></div>
          <p class="request-meta">${esc(DISPLAY_LABELS[a.display])} · ${esc(TONE_LABELS[a.tone])} · ${esc(who)} · ${esc(a.frequency === 'times' ? `${a.maxViews} volte` : FREQ_LABELS[a.frequency])}${a.endAt ? ` · fino al ${esc(fmt(a.endAt))}` : ''}${a.createdAt ? ` · creato ${esc(fmt(a.createdAt))}` : ''}</p>
          ${a.requireAck ? `<p class="request-meta" data-ann-acks="${esc(a.id)}">Conferme: …</p>` : ''}
          <div class="request-actions">
            <button class="secondary-btn small-btn" type="button" data-ann-row-act="edit">Modifica</button>
            <button class="ghost-btn small-btn" type="button" data-ann-row-act="duplicate">Duplica</button>
            <button class="ghost-btn small-btn" type="button" data-ann-row-act="show">Prova</button>
            <button class="${a.active ? 'warning-btn' : 'primary-btn'} small-btn" type="button" data-ann-row-act="toggle">${a.active ? 'Disattiva' : 'Attiva'}</button>
            <button class="danger-btn small-btn" type="button" data-ann-row-act="delete">Elimina</button>
          </div>
        </article>`;
      }).join('');
      list.filter((a) => a.requireAck).forEach(loadAcks);
    } catch (error) {
      box.innerHTML = `<p class="message">Annunci non caricati: ${esc(error.message)}</p>`;
    }
  }
  async function loadAcks(a) {
    const el = root()?.querySelector(`[data-ann-acks="${CSS.escape(a.id)}"]`);
    if (!el) return;
    try {
      const snap = await db().collection('announcements').doc(a.id).collection('acks').get();
      const names = [];
      // contano solo le conferme della versione attuale (dopo "mostralo di nuovo" si riparte da zero)
      snap.forEach((d) => { if (Number(d.data()?.rev || 0) === (a.rev || 0)) names.push(d.data()?.name || d.id); });
      el.innerHTML = names.length
        ? `Conferme: <strong>${names.length}</strong> <details><summary>Chi ha confermato</summary><p>${names.map(esc).join(', ')}</p></details>`
        : 'Conferme: nessuna ancora.';
    } catch (error) { el.textContent = `Conferme non lette: ${error.message}`; }
  }
  function edit(a, asCopy) {
    const raw = a.raw || {};
    editingId = asCopy ? null : a.id;
    draft = {
      ...emptyDraft(),
      title: asCopy ? `${a.title} (copia)` : a.title,
      body: a.body,
      display: a.display,
      tone: a.tone,
      image: a.image,
      qr: a.qr,
      buttons: [0, 1, 2].map((i) => a.buttons[i] || { label: '', url: '' }),
      requireAck: a.requireAck,
      ackLabel: a.ackLabel,
      scope: a.scope,
      where: a.where,
      targetUid: a.targetUid,
      targetName: raw.targetName || '',
      startAt: a.startAt,
      endAt: a.endAt,
      frequency: a.frequency,
      maxViews: a.maxViews,
      dismissible: a.dismissible,
      active: a.active,
      rev: asCopy ? 0 : (a.rev || 0)
    };
    fillForm(draft);
    updatePreview();
    root().querySelector('.ann-composer')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  async function onRowAction(btn) {
    const row = btn.closest('[data-ann-row]');
    const a = list.find((x) => x.id === row?.dataset.annRow);
    if (!a) return;
    const act = btn.dataset.annRowAct;
    if (act === 'edit') return edit(a, false);
    if (act === 'duplicate') return edit(a, true);
    if (act === 'show') return window.QuizAnnouncements.openPopup({ ...a, __normalized: true }, { preview: true });
    if (act === 'delete' && btn.dataset.armed !== '1') {
      btn.dataset.armed = '1';
      btn.textContent = 'Confermi? Tocca di nuovo';
      setTimeout(() => { btn.dataset.armed = ''; btn.textContent = 'Elimina'; }, 4000);
      return;
    }
    btn.disabled = true;
    try {
      if (act === 'toggle') {
        await db().collection('announcements').doc(a.id).set({ active: !a.active, updatedAt: FV().serverTimestamp(), updatedBy: admin.uid }, { merge: true });
        toast(a.active ? 'Annuncio disattivato.' : 'Annuncio attivato.');
      }
      if (act === 'delete') {
        await db().collection('announcements').doc(a.id).delete();
        if (editingId === a.id) { editingId = null; draft = emptyDraft(); fillForm(draft); updatePreview(); }
        toast('Annuncio eliminato.');
      }
      await reload();
    } catch (error) {
      toast(`Operazione non riuscita: ${error.message}`);
      btn.disabled = false;
    }
  }

  /* ---------------- Eventi ---------------- */
  function wrapSelection(textarea, before, after, placeholder) {
    const { selectionStart: s, selectionEnd: e, value } = textarea;
    const selected = value.slice(s, e) || placeholder;
    textarea.value = value.slice(0, s) + before + selected + after + value.slice(e);
    textarea.focus();
    textarea.setSelectionRange(s + before.length, s + before.length + selected.length);
  }
  function prefixLines(textarea, prefix) {
    const { selectionStart: s, selectionEnd: e, value } = textarea;
    const lineStart = value.lastIndexOf('\n', s - 1) + 1;
    const block = value.slice(lineStart, e) || 'voce';
    const out = block.split('\n').map((l) => (l.startsWith(prefix) ? l : prefix + l)).join('\n');
    textarea.value = value.slice(0, lineStart) + out + value.slice(e);
    textarea.focus();
  }
  function bind() {
    const r = root();
    r.addEventListener('input', (event) => {
      if (event.target.id === 'annfUserSearch') { renderUserOptions(draft.targetUid); return; }
      if (event.target.id === 'annfImageUrl') draft.image = null;
      syncVisibility();
      updatePreview();
    });
    r.addEventListener('change', async (event) => {
      if (event.target.id === 'annfScope' && event.target.value === 'user') { await ensureUsers(); renderUserOptions(draft.targetUid); }
      if (event.target.id === 'annfFile' && event.target.files?.[0]) {
        const info = $('[data-ann-image-info]', r);
        info.textContent = 'Riduco la foto…';
        try {
          const src = await compress(event.target.files[0]);
          draft.image = { src, alt: $('#annfImageAlt', r).value.trim(), fit: $('#annfImageContain', r).checked ? 'contain' : 'cover' };
          $('#annfImageUrl', r).value = '';
          updateImageInfo();
        } catch (error) { info.textContent = error.message; }
        event.target.value = '';
      }
      syncVisibility();
      updatePreview();
    });
    r.addEventListener('click', (event) => {
      const fmtBtn = event.target.closest('[data-fmt]');
      if (fmtBtn) {
        const ta = $('#annfBody', r);
        const kind = fmtBtn.dataset.fmt;
        if (kind === 'bold') wrapSelection(ta, '**', '**', 'testo in grassetto');
        if (kind === 'italic') wrapSelection(ta, '*', '*', 'testo in corsivo');
        if (kind === 'link') wrapSelection(ta, '[', '](https://)', 'testo del link');
        if (kind === 'list') prefixLines(ta, '- ');
        if (kind === 'heading') prefixLines(ta, '# ');
        updatePreview();
        return;
      }
      const act = event.target.closest('[data-ann-act]')?.dataset.annAct;
      if (act === 'publish') save(true);
      if (act === 'draft') save(false);
      if (act === 'preview') {
        const d = readForm();
        const problem = validate(d);
        if (problem) { $('[data-ann-msg]', r).textContent = problem; return; }
        window.QuizAnnouncements.openPopup({ ...d, buttons: d.buttons.filter((b) => b.label && b.url), id: 'anteprima' }, { preview: true });
      }
      if (act === 'new') { editingId = null; draft = emptyDraft(); fillForm(draft); updatePreview(); }
      if (act === 'image-remove') { draft.image = null; $('#annfImageUrl', r).value = ''; updateImageInfo(); updatePreview(); }
      if (act === 'reload') reload();
      const rowBtn = event.target.closest('[data-ann-row-act]');
      if (rowBtn) onRowAction(rowBtn);
    });
  }

  function start() {
    if (started) return;
    const auth = fq().auth;
    if (!auth || !db() || !window.QuizAnnouncements) return;
    started = true;
    renderShell();
    auth.onAuthStateChanged((u) => { if (u) { admin = u; reload(); } });
  }

  window.QuizAnnouncementsAdmin = Object.freeze({ reload: () => reload() });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(start, 0));
  else setTimeout(start, 0);
})();
