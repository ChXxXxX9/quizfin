/* ==========================================================================
   Quiz Nuoto — annunci dello staff (announcements.js)
   --------------------------------------------------------------------------
   Mostra gli annunci creati dall'admin (collezione "announcements"):
   - tipo: popup, banner in cima alla pagina, schermo intero;
   - testo formattato (**grassetto**, *corsivo*, [link](https://…), elenchi),
     immagine, QR code, pulsanti con link;
   - conferma obbligatoria ("OK, ho letto") salvata in announcements/{id}/acks/{uid};
   - frequenza: una volta, una volta al giorno, a ogni accesso, N volte, sempre;
   - periodo: da / fino a; destinatari: tutti, un corso, un singolo utente.
   Gli annunci vecchi (solo titolo + messaggio) restano compatibili.

   QuizAnnouncements.render(annuncio, { preview }) → HTML della scheda (usato anche dall'admin)
   QuizAnnouncements.richText(testo) → HTML sicuro del testo formattato
   QuizAnnouncements.openPopup(annuncio, { preview }) → mostra un annuncio come popup
   ========================================================================== */
(() => {
  'use strict';

  const COURSES = ['istruttore', 'bagnino', 'arte'];
  const FOCUS_VIEWS = new Set(['quizView', 'flashcardView', 'sudokuView']);
  const TONES = {
    info: { label: 'Annuncio', icon: '📣' },
    success: { label: 'Novità', icon: '✨' },
    warning: { label: 'Avviso', icon: '⚠️' },
    danger: { label: 'Importante', icon: '⛔' },
    event: { label: 'Evento', icon: '📅' }
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const fq = () => window.FirebaseQuiz || {};
  const db = () => fq().db || null;
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const unesc = (v) => String(v ?? '').replace(/&(amp|lt|gt|quot|#39);/g, (m, k) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }[k]));

  /* ---------------- Testo formattato (sicuro: prima si fa l'escape, poi si aggiunge la formattazione) ---------------- */
  function safeHref(raw) {
    const url = unesc(raw).trim();
    if (/^(https?:\/\/|mailto:|tel:)/i.test(url)) return url;
    if (/^www\./i.test(url)) return `https://${url}`;
    if (/^[\w./-]+\.html([?#].*)?$/i.test(url)) return url; // pagina del sito (es. istruttore.html)
    return null;
  }
  function inline(text) {
    let out = text;
    // [testo](link)
    out = out.replace(/\[([^\]\n]{1,200})\]\(([^)\s]{1,600})\)/g, (m, label, href) => {
      const url = safeHref(href);
      return url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${label}</a>` : label;
    });
    // link nudi
    out = out.replace(/(^|[\s(])((?:https?:\/\/|www\.)[^\s<]{3,300})/g, (m, pre, href) => {
      const clean = href.replace(/[.,;:!?)]+$/, '');
      const tail = href.slice(clean.length);
      const url = safeHref(clean);
      return url ? `${pre}<a href="${esc(url)}" target="_blank" rel="noopener">${clean}</a>${tail}` : m;
    });
    out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    out = out.replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
    out = out.replace(/~~([^~\n]+)~~/g, '<s>$1</s>');
    return out;
  }
  function richText(src) {
    const lines = esc(String(src || '').replace(/\r\n?/g, '\n')).split('\n');
    const html = [];
    let para = [];
    let list = null; // { tag, items }
    const flushPara = () => { if (para.length) { html.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; } };
    const flushList = () => { if (list) { html.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`); list = null; } };
    lines.forEach((line) => {
      const t = line.trim();
      const ul = t.match(/^[-•*]\s+(.*)$/);
      const ol = t.match(/^\d{1,2}[.)]\s+(.*)$/);
      const h = t.match(/^#{1,3}\s+(.*)$/);
      if (!t) { flushPara(); flushList(); return; }
      if (ul || ol) {
        flushPara();
        const tag = ul ? 'ul' : 'ol';
        if (!list || list.tag !== tag) { flushList(); list = { tag, items: [] }; }
        list.items.push((ul || ol)[1]);
        return;
      }
      flushList();
      if (h) { flushPara(); html.push(`<p class="ann-heading">${inline(h[1])}</p>`); return; }
      para.push(t);
    });
    flushPara(); flushList();
    return html.join('');
  }

  /* ---------------- Normalizzazione (anche annunci vecchi) ---------------- */
  function toDate(v) {
    if (!v) return null;
    if (v instanceof Date) return v;
    if (typeof v.toDate === 'function') return v.toDate();
    if (typeof v.seconds === 'number') return new Date(v.seconds * 1000);
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  function normalize(raw = {}, id = '') {
    const buttons = Array.isArray(raw.buttons) ? raw.buttons.filter((b) => b && b.label && safeHref(esc(b.url || ''))).slice(0, 3) : [];
    const display = ['popup', 'banner', 'fullscreen'].includes(raw.display) ? raw.display : 'popup';
    return {
      id: id || raw.id || '',
      title: String(raw.title || 'Annuncio'),
      body: String(raw.body ?? raw.message ?? ''),
      tone: TONES[raw.tone] ? raw.tone : 'info',
      display,
      image: raw.image && raw.image.src ? { src: String(raw.image.src), alt: String(raw.image.alt || ''), fit: raw.image.fit === 'contain' ? 'contain' : 'cover' } : null,
      qr: raw.qr && raw.qr.text ? { text: String(raw.qr.text).slice(0, 1200), caption: String(raw.qr.caption || '') } : null,
      buttons,
      requireAck: Boolean(raw.requireAck),
      ackLabel: String(raw.ackLabel || 'OK, ho letto'),
      frequency: ['once', 'daily', 'everyVisit', 'times', 'always'].includes(raw.frequency) ? raw.frequency : 'once',
      maxViews: Math.max(1, Math.min(50, Number(raw.maxViews) || 3)),
      dismissible: raw.dismissible !== false,
      where: ['portal', 'courses', 'everywhere'].includes(raw.where) ? raw.where : 'portal',
      scope: raw.scope || 'global',
      targetUid: raw.targetUid || '',
      startAt: toDate(raw.startAt),
      endAt: toDate(raw.endAt),
      active: raw.active !== false,
      priority: Number(raw.priority || 0),
      rev: Math.max(0, Math.floor(Number(raw.rev) || 0)),
      createdAt: toDate(raw.createdAt)
    };
  }

  /* ---------------- Scheda ---------------- */
  function qrHtml(qr) {
    if (!qr || !window.QuizQR) return '';
    let svg = '';
    try { svg = window.QuizQR.svg(qr.text, { ecl: 'M', border: 3, title: qr.caption || qr.text }); } catch { return ''; }
    const href = safeHref(esc(qr.text));
    return `<div class="ann-qr">${svg}<div class="ann-qr-text">${qr.caption ? `<strong>${esc(qr.caption)}</strong>` : ''}${href ? `<a href="${esc(href)}" target="_blank" rel="noopener">Apri il link</a>` : `<span>${esc(qr.text)}</span>`}</div></div>`;
  }
  function render(rawOrNormalized, { preview = false } = {}) {
    const a = rawOrNormalized && rawOrNormalized.__normalized ? rawOrNormalized : normalize(rawOrNormalized);
    const tone = TONES[a.tone];
    const buttons = a.buttons.map((b, i) => `<a class="${i === 0 ? 'primary-btn' : 'secondary-btn'}" href="${esc(safeHref(esc(b.url)))}" target="_blank" rel="noopener">${esc(b.label)}</a>`).join('');
    return `<article class="ann ann-${a.display} ann-tone-${a.tone}${a.image ? ' has-media' : ''}" data-ann-id="${esc(a.id)}">
      ${a.image ? `<figure class="ann-media ann-fit-${a.image.fit}"><img src="${esc(a.image.src)}" alt="${esc(a.image.alt)}" loading="lazy" decoding="async"></figure>` : ''}
      <div class="ann-main">
        <p class="ann-kicker"><span aria-hidden="true">${tone.icon}</span> ${esc(tone.label)}${preview ? ' · anteprima' : ''}</p>
        <h3 class="ann-title">${esc(a.title)}</h3>
        ${a.body ? `<div class="ann-text">${richText(a.body)}</div>` : ''}
        ${qrHtml(a.qr)}
        ${buttons ? `<div class="ann-buttons">${buttons}</div>` : ''}
      </div>
    </article>`;
  }

  /* ---------------- Memoria di cosa è stato visto (sul dispositivo) ---------------- */
  let user = null;
  // "rev" cresce quando l'admin chiede di rimostrare un annuncio modificato: si riparte da zero
  const revs = new Map();
  const stateKey = (id) => `quizNuotoAnn:${user?.uid || 'anon'}:${id}${revs.get(id) ? `@${revs.get(id)}` : ''}`;
  function readState(id) { try { return JSON.parse(localStorage.getItem(stateKey(id)) || '{}'); } catch { return {}; } }
  function writeState(id, patch) { try { localStorage.setItem(stateKey(id), JSON.stringify({ ...readState(id), ...patch })); } catch { /* niente */ } }
  const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const shownThisVisit = new Set();

  function shouldShow(a, acked) {
    const now = Date.now();
    if (!a.active) return false;
    if (a.startAt && a.startAt.getTime() > now) return false;
    if (a.endAt && a.endAt.getTime() < now) return false;
    const st = readState(a.id);
    if (a.requireAck) return !acked && !st.acked; // finché non preme OK
    if (a.display === 'banner') {
      if (a.frequency === 'always' || !a.dismissible) return true;
      if (st.dismissed && a.frequency === 'once') return false;
      if (a.frequency === 'daily' && st.dismissedDay === todayKey()) return false;
      if (a.frequency === 'times' && Number(st.views || 0) >= a.maxViews) return false;
      return !(st.dismissed && a.frequency !== 'everyVisit');
    }
    switch (a.frequency) {
      case 'once': return !st.closed;
      case 'daily': return st.lastDay !== todayKey();
      case 'times': return Number(st.views || 0) < a.maxViews;
      case 'everyVisit':
      case 'always': return true;
      default: return !st.closed;
    }
  }
  function countView(a) {
    if (shownThisVisit.has(a.id)) return;
    shownThisVisit.add(a.id);
    const st = readState(a.id);
    writeState(a.id, { views: Number(st.views || 0) + 1, lastDay: todayKey() });
  }

  async function saveAck(a) {
    writeState(a.id, { acked: true, closed: true });
    try {
      await db()?.collection('announcements').doc(a.id).collection('acks').doc(user.uid).set({
        uid: user.uid,
        name: (user.displayName || user.email || '').slice(0, 80),
        rev: a.rev || 0,
        at: window.firebase.firestore.FieldValue.serverTimestamp()
      });
    } catch (error) { console.warn('Conferma annuncio non salvata:', error); }
  }

  /* ---------------- Popup e schermo intero ---------------- */
  function openPopup(raw, { preview = false, onClose } = {}) {
    const a = raw.__normalized ? raw : { ...normalize(raw, raw.id), __normalized: true };
    const modal = document.createElement('div');
    modal.className = `modal ann-modal ann-modal-${a.display === 'fullscreen' ? 'full' : 'popup'}`;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', a.title);
    const closeLabel = a.requireAck && !preview ? a.ackLabel : (a.requireAck ? a.ackLabel : 'Chiudi');
    modal.innerHTML = `<div class="modal-card ann-card">
      ${a.requireAck ? '' : '<button class="icon-btn ann-x" type="button" data-ann-close aria-label="Chiudi"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>'}
      ${render(a, { preview })}
      <div class="ann-footer">
        ${a.requireAck ? '<p class="ann-ack-note">Per continuare conferma di aver letto.</p>' : ''}
        <button class="primary-btn" type="button" data-ann-ok>${esc(closeLabel)}</button>
      </div>
    </div>`;
    document.body.appendChild(modal);
    document.documentElement.classList.add('ann-lock');
    const previousFocus = document.activeElement;
    requestAnimationFrame(() => $('[data-ann-ok]', modal)?.focus({ preventScroll: true }));
    const close = (how) => {
      modal.remove();
      if (!document.querySelector('.ann-modal')) document.documentElement.classList.remove('ann-lock');
      try { previousFocus?.focus?.({ preventScroll: true }); } catch { /* niente */ }
      onClose?.(how);
    };
    modal.addEventListener('click', (event) => {
      if (event.target.closest('[data-ann-ok]')) { close('ok'); return; }
      if (event.target.closest('[data-ann-close]')) { close('x'); return; }
      if (event.target === modal && !a.requireAck) close('fuori');
    });
    modal.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !a.requireAck) { event.stopPropagation(); close('esc'); }
    });
    return modal;
  }

  /* ---------------- Banner ---------------- */
  function bannerSlot() {
    return document.getElementById('announcementsSlot') || document.getElementById('announcementsPanel');
  }
  function renderBanners(list) {
    const slot = bannerSlot();
    if (!slot) return;
    slot.classList.remove('hidden');
    slot.classList.add('ann-slot');
    slot.innerHTML = list.map((a) => {
      const canClose = !a.requireAck && a.dismissible && a.frequency !== 'always';
      return `<div class="ann-banner-wrap" data-ann-wrap="${esc(a.id)}">
        ${render(a)}
        ${canClose ? `<button class="icon-btn ann-x" type="button" data-ann-dismiss="${esc(a.id)}" aria-label="Chiudi annuncio"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>` : ''}
        ${a.requireAck ? `<div class="ann-footer"><button class="primary-btn small-btn" type="button" data-ann-ack="${esc(a.id)}">${esc(a.ackLabel)}</button></div>` : ''}
      </div>`;
    }).join('');
    slot.hidden = !list.length;
    list.forEach(countView);
    slot.onclick = async (event) => {
      const dismiss = event.target.closest('[data-ann-dismiss]');
      const ack = event.target.closest('[data-ann-ack]');
      const id = dismiss?.dataset.annDismiss || ack?.dataset.annAck;
      if (!id) return;
      const a = list.find((x) => x.id === id);
      if (!a) return;
      if (ack) { ack.disabled = true; await saveAck(a); }
      else writeState(id, { dismissed: true, dismissedDay: todayKey() });
      slot.querySelector(`[data-ann-wrap="${CSS.escape(id)}"]`)?.remove();
      if (!slot.querySelector('.ann-banner-wrap')) slot.hidden = true;
    };
  }

  /* ---------------- Quando la pagina è pronta per un popup ---------------- */
  function pageReady() {
    const main = document.querySelector('#mainContent, #arteMain');
    if (!main || main.classList.contains('hidden') || !main.getClientRects().length) return false;
    if (document.body.classList.contains('app-locked') || document.body.classList.contains('system-gated')) return false;
    if (FOCUS_VIEWS.has(document.body.dataset.view)) return false;
    const busy = Array.from(document.querySelectorAll('.modal, .study-milestone-overlay, .site-dialog-backdrop, .nf-overlay'))
      .some((el) => !el.classList.contains('hidden') && el.getClientRects().length);
    if (busy) return false;
    const card = $('#authCard');
    if (card && !card.classList.contains('hidden') && getComputedStyle(card).position === 'fixed') return false;
    return true;
  }
  function whenReady(cb, { interval = 600, timeout = 10 * 60 * 1000 } = {}) {
    const started = Date.now();
    let streak = 0;
    const tick = () => {
      if (document.hidden) { setTimeout(tick, interval); return; }
      streak = pageReady() ? streak + 1 : 0;
      if (streak >= 2) { cb(); return; }
      if (Date.now() - started < timeout) setTimeout(tick, interval);
    };
    setTimeout(tick, interval);
  }

  /* ---------------- Caricamento ---------------- */
  function pageArea() {
    const body = document.body;
    for (const c of COURSES) if (body.classList.contains(`course-${c}`)) return { area: 'course', course: c };
    if (document.getElementById('promoAdmin') || document.getElementById('adminMain')) return { area: 'admin' };
    return { area: 'portal' };
  }

  async function fetchFor(area, course) {
    const col = db().collection('announcements');
    const queries = [
      col.where('active', '==', true).where('scope', '==', 'global').limit(30).get(),
      col.where('active', '==', true).where('scope', '==', 'user').where('targetUid', '==', user.uid).limit(30).get()
    ];
    if (area === 'course') queries.push(col.where('active', '==', true).where('scope', '==', course).limit(30).get());
    const snaps = await Promise.allSettled(queries);
    const map = new Map();
    snaps.forEach((r) => {
      if (r.status !== 'fulfilled') return;
      r.value.forEach((doc) => { const a = normalize(doc.data() || {}, doc.id); a.__normalized = true; revs.set(doc.id, a.rev); map.set(doc.id, a); });
    });
    return [...map.values()].filter((a) => {
      if (a.scope === 'global') return area === 'portal' ? a.where !== 'courses' : a.where !== 'portal';
      return true;
    });
  }

  async function ackedSet(list) {
    const need = list.filter((a) => a.requireAck && !readState(a.id).acked);
    const out = new Set();
    await Promise.all(need.map(async (a) => {
      try {
        const snap = await db().collection('announcements').doc(a.id).collection('acks').doc(user.uid).get();
        if (snap.exists && Number(snap.data()?.rev || 0) === (a.rev || 0)) { out.add(a.id); writeState(a.id, { acked: true }); }
      } catch { /* senza rete vale il dispositivo */ }
    }));
    return out;
  }

  let loading = false;
  async function load() {
    if (loading || !user || !db()) return;
    const { area, course } = pageArea();
    if (area === 'admin') return;
    loading = true;
    try {
      const all = await fetchFor(area, course);
      const acked = await ackedSet(all);
      const visible = all
        .filter((a) => shouldShow(a, acked.has(a.id)))
        .sort((x, y) => y.priority - x.priority || (y.createdAt?.getTime() || 0) - (x.createdAt?.getTime() || 0));
      renderBanners(visible.filter((a) => a.display === 'banner'));
      const queue = visible.filter((a) => a.display !== 'banner' && !shownThisVisit.has(a.id));
      const next = () => {
        const a = queue.shift();
        if (!a) return;
        whenReady(() => {
          countView(a);
          openPopup(a, {
            onClose: async (how) => {
              if (a.requireAck && how === 'ok') await saveAck(a);
              else writeState(a.id, { closed: true });
              setTimeout(next, 350);
            }
          });
        });
      };
      next();
    } catch (error) {
      console.warn('Annunci non caricati:', error);
    } finally {
      loading = false;
    }
  }

  function start() {
    const auth = fq().auth;
    if (!auth || !db()) return;
    auth.onAuthStateChanged((u) => {
      if (!u) { user = null; const slot = bannerSlot(); if (slot) slot.innerHTML = ''; return; }
      if (user && user.uid === u.uid) return;
      user = u;
      // aspetta che la pagina abbia deciso cosa mostrare (accesso, corso sbloccato…)
      whenReady(load, { interval: 500, timeout: 2 * 60 * 1000 });
    });
  }

  window.QuizAnnouncements = Object.freeze({ render, richText, normalize, openPopup, reload: () => { shownThisVisit.clear(); return load(); }, TONES });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(start, 0));
  else setTimeout(start, 0);
})();
