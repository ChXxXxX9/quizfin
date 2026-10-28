/* ==========================================================================
   Quiz Nuoto — livello di presentazione (shell.js)
   --------------------------------------------------------------------------
   Separato dalla logica dei corsi: non legge né scrive dati, osserva il DOM
   che gli script dei corsi aggiornano e ne ricava lo stato dell'interfaccia.

   - body[data-view]: vista attiva (o "none" se il contenuto è nascosto),
     usata dal CSS per la modalità focus e per la navigazione.
   - Navigazione: pulsanti con data-proxy="#id" cliccano il comando reale;
     aria-current sulla voce della vista attiva.
   - Quadrante: [data-dial-source] legge "x / y" dal testo indicato e muove
     arco e lancetta (--p, 0–100).
   - Barra superiore che si stacca durante lo scorrimento (body.is-scrolled).
   - Tema scuro di sistema se l'utente non ha mai scelto; colore della barra
     del browser (meta theme-color) sempre allineato al tema.
   - Tastiera su computer: A–D/1–4 per rispondere, Invio/→ avanti, ← indietro,
     S segna, H suggerimento, E spiegazione, Esc chiude finestre e pannelli.
   - Pannello account a foglio: si chiude toccando fuori o con Esc.
   - Avviso quando la connessione cade.
   Ogni parte è difensiva: se un elemento manca, quella parte non fa nulla.
   ========================================================================== */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const isVisible = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const body = document.body;

  /* ---------------- Vista attiva ---------------- */
  function currentView() {
    const active = $$('.view').find((v) => v.classList.contains('active') && !v.classList.contains('hidden') && isVisible(v));
    return active ? active.id : 'none';
  }

  function syncView() {
    const view = currentView();
    if (body.dataset.view !== view) {
      body.dataset.view = view;
      $$('[data-nav-view]').forEach((el) => {
        if (el.dataset.navView === view) el.setAttribute('aria-current', 'page');
        else el.removeAttribute('aria-current');
      });
    }
  }

  /* ---------------- Quadranti ---------------- */
  function parseFraction(text) {
    const m = String(text || '').match(/(\d+)\s*\/\s*(\d+)/);
    if (!m) return null;
    const done = Number(m[1]);
    const total = Number(m[2]);
    if (!total) return { done, total, pct: 0 };
    return { done, total, pct: Math.max(0, Math.min(100, (done / total) * 100)) };
  }

  function syncDials() {
    $$('.dial[data-dial-source]').forEach((dial) => {
      const src = $(dial.dataset.dialSource);
      const frac = src ? parseFraction(src.textContent) : null;
      if (!frac) return;
      const pct = Math.round(frac.pct * 10) / 10;
      if (dial.style.getPropertyValue('--p') !== String(pct)) dial.style.setProperty('--p', String(pct));
      const label = $('[data-dial-value]', dial);
      const shown = pct > 0 && pct < 1 ? '<1%' : `${Math.round(pct)}%`;
      if (label && label.textContent !== shown) label.textContent = shown;
      dial.setAttribute('aria-label', `${dial.getAttribute('aria-label')?.split(':')[0] || 'Avanzamento'}: ${frac.done} su ${frac.total}`);
    });
  }

  /* ---------------- Aggiornamento coalescente ---------------- */
  let queued = false;
  let themeDirty = true;
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      syncView();
      syncDials();
      if (themeDirty) { themeDirty = false; syncThemeColor(); }
    });
  }
  // Cambi che non riguardano viste, quadranti o tema (il conto alla rovescia ogni secondo,
  // le animazioni del banner) non fanno ricalcolare niente: meno lavoro, tocchi più pronti.
  const IGNORE_MUTATIONS = '[data-study-countdown], .nf-banner, .toast';
  function onMutations(records) {
    let relevant = false;
    for (const r of records) {
      const el = r.target.nodeType === 1 ? r.target : r.target.parentElement;
      if (el && el.closest && el.closest(IGNORE_MUTATIONS)) continue;
      relevant = true;
      if (el === body && r.attributeName === 'class') themeDirty = true;
    }
    if (relevant) schedule();
  }

  /* ---------------- Tema ---------------- */
  const THEME_KEY = 'quizNuotoTheme';
  function storedTheme() {
    try { return localStorage.getItem(THEME_KEY); } catch { return null; }
  }
  function applySystemTheme() {
    if (storedTheme()) return;
    const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    if (mq && mq.matches) body.classList.add('dark');
    mq?.addEventListener?.('change', (e) => {
      if (storedTheme()) return;
      body.classList.toggle('dark', e.matches);
      themeDirty = true;
      schedule();
    });
  }
  function syncThemeColor() {
    const meta = $('meta[name="theme-color"]');
    if (!meta) return;
    const bg = getComputedStyle(body).backgroundColor;
    if (bg && meta.content !== bg) meta.content = bg;
  }

  /* ---------------- Navigazione via proxy ---------------- */
  function onProxyClick(event) {
    const trigger = event.target.closest('[data-proxy]');
    if (!trigger) return;
    const targets = trigger.dataset.proxy.split(',').map((s) => s.trim()).filter(Boolean);
    const view = body.dataset.view;
    if (trigger.dataset.navView && trigger.dataset.navView === view) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    const target = targets.map((sel) => $(sel)).find((el) => el && !el.disabled && (isVisible(el) || targets.length === 1));
    if (target) target.click();
  }

  /* ---------------- Pannello account a foglio ---------------- */
  function closeAccountSheet() {
    const card = $('#authCard');
    if (!card || body.classList.contains('app-locked') || card.classList.contains('hidden')) return false;
    if (getComputedStyle(card).position !== 'fixed') return false;
    card.classList.add('hidden');
    return true;
  }
  function onDocumentClick(event) {
    const card = $('#authCard');
    if (!card || card.classList.contains('hidden') || body.classList.contains('app-locked')) return;
    if (getComputedStyle(card).position !== 'fixed') return;
    if (card.contains(event.target) || event.target.closest('#accountBtn')) return;
    // Il tocco sullo sfondo oscurato chiude soltanto il pannello: non deve attivare ciò che c'è sotto.
    event.preventDefault();
    event.stopPropagation();
    card.classList.add('hidden');
  }

  /* ---------------- Tastiera ---------------- */
  const CLOSE_SELECTORS = [
    '[data-site-cancel]', '[data-site-close]', '[data-study-leader-close]', '[data-study-close]',
    '#timerCancelBtn', '#explanationCloseBtn', '#installCloseBtn', '#fadGoalCancelBtn', '#accountRequestCloseBtn',
    '.modal-head .icon-btn'
  ];
  function topModal() {
    const open = $$('.modal, .study-milestone-overlay').filter((m) => !m.classList.contains('hidden') && isVisible(m));
    return open[open.length - 1] || null;
  }
  function clickIfUsable(el) {
    if (el && !el.disabled && isVisible(el)) { el.click(); return true; }
    return false;
  }
  function onKeyDown(event) {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const tag = (event.target.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || event.target.isContentEditable;

    if (event.key === 'Escape') {
      const modal = topModal();
      if (modal) {
        for (const sel of CLOSE_SELECTORS) { if (clickIfUsable($(sel, modal))) { event.preventDefault(); return; } }
        if (modal.classList.contains('study-milestone-overlay')) { modal.click(); return; }
        return;
      }
      if (closeAccountSheet()) event.preventDefault();
      return;
    }
    if (typing || topModal()) return;

    const view = body.dataset.view;
    const key = event.key.toLowerCase();
    if (view === 'quizView') {
      const letters = ['a', 'b', 'c', 'd', 'e', 'f'];
      let index = letters.indexOf(key);
      if (index < 0 && /^[1-6]$/.test(key)) index = Number(key) - 1;
      if (index >= 0) {
        const options = $$('#optionsList .option-btn');
        if (options[index] && !options[index].disabled) { event.preventDefault(); options[index].click(); }
        return;
      }
      if (key === 'enter' || key === 'arrowright') { if (clickIfUsable($('#nextQuestionBtn'))) event.preventDefault(); return; }
      if (key === 'arrowleft') { if (clickIfUsable($('#prevQuestionBtn'))) event.preventDefault(); return; }
      if (key === 's') { if (clickIfUsable($('#markQuestionBtn'))) event.preventDefault(); return; }
      if (key === 'h') { if (clickIfUsable($('#hintBtn'))) event.preventDefault(); return; }
      if (key === 'e') { if (clickIfUsable($('#explainBtn'))) event.preventDefault(); return; }
    }
    if (view === 'flashcardView') {
      if (key === '1' || key === '2' || key === 'a' || key === 'b') {
        const index = (key === '1' || key === 'a') ? 0 : 1;
        const options = $$('#flashcardOptions .option-btn');
        if (options[index] && !options[index].disabled) { event.preventDefault(); options[index].click(); }
        return;
      }
      if (key === 'enter' || key === 'arrowright') { if (clickIfUsable($('#flashcardNextBtn'))) event.preventDefault(); return; }
      if (key === 's') { if (clickIfUsable($('#flashcardMarkBtn'))) event.preventDefault(); return; }
    }
  }

  /* ---------------- Barra che si stacca ---------------- */
  let ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      body.classList.toggle('is-scrolled', window.scrollY > 8);
    });
  }

  /* ---------------- Connessione ---------------- */
  let banner = null;
  function syncNetwork() {
    if (navigator.onLine) { banner?.remove(); banner = null; return; }
    if (banner) return;
    banner = document.createElement('div');
    banner.className = 'net-banner';
    banner.setAttribute('role', 'status');
    banner.textContent = 'Sei offline: quello che fai verrà salvato appena torni in linea.';
    body.appendChild(banner);
  }

  /* ---------------- Avvio ---------------- */
  function start() {
    applySystemTheme();
    syncView();
    syncDials();
    syncThemeColor();
    onScroll();
    syncNetwork();

    new MutationObserver(onMutations).observe(body, {
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden'],
      childList: true,
      characterData: true
    });

    document.addEventListener('click', onProxyClick);
    document.addEventListener('click', onDocumentClick, true);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('online', syncNetwork);
    window.addEventListener('offline', syncNetwork);
  }

  /* ---------------- Novità ---------------- */
  // L'admin può segnare un corso o una funzione come "Novità" (courseSettings: novita: true):
  // il riquadro prende un bordo rosso e un'etichetta "Novità" in alto.
  function markNovita(el, on) {
    if (!el) return;
    const box = el.closest('.tile, .hero, .course-card') || el;
    const card = box.matches('.tile, .hero, .course-card');
    box.classList.toggle('is-novita', Boolean(on));
    box.classList.toggle('novita-card', Boolean(on) && card);
    box.classList.toggle('novita-inline', Boolean(on) && !card);
    let badge = Array.from(box.children).find((c) => c.classList?.contains('novita-badge'));
    if (on && !badge) {
      badge = document.createElement('span');
      badge.className = 'novita-badge';
      badge.textContent = 'Novità';
      box.appendChild(badge);
    }
    if (!on && badge) badge.remove();
  }
  window.QuizNovita = Object.freeze({ mark: markNovita });

  // Gli script dei corsi si inizializzano su DOMContentLoaded: partiamo dopo di loro.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(start, 0));
  else setTimeout(start, 0);
})();
