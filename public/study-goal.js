(() => {
  'use strict';

  const COURSE_CONFIG = {
    istruttore: { label: 'Istruttore di Nuoto', unit: 'domande', total: 1000 },
    bagnino: { label: 'Assistenti Bagnanti Piscina', unit: 'domande', total: 573 },
    arte: { label: 'Arte · Quinto Liceo', unit: 'opere', total: 80 }
  };
  const MARGIN_MAP = { comfortable: 0.25, standard: 0.10, tight: 0 };
  const MILESTONES = [5, 10, 20, 30, 50, 75, 100, 150, 200, 365];
  const COURSES = ['istruttore', 'bagnino', 'arte'];
  const PENDING_KEY = 'quizNuotoPendingActivity';
  let currentUser = null;
  let mounted = false;
  let mountCourse = null;
  let widget = null;
  let refreshSeq = 0;

  document.addEventListener('DOMContentLoaded', () => {
    const fb = window.FirebaseQuiz;
    if (!fb?.configured || !fb.auth) return;
    fb.auth.onAuthStateChanged(async (user) => {
      currentUser = user || null;
      if (!user) {
        widget?.remove();
        widget = null;
        mounted = false;
        return;
      }
      mountCourse = getPageCourse();
      mountWidget();
      await flushPendingActivity();
      await refreshWidget();
    });
  });

  // Il corso si riconosce dalla classe del body (robusto anche se l'URL non termina in .html),
  // con il percorso come ripiego. Il portale e l'admin restituiscono null.
  function getPageCourse() {
    for (const course of COURSES) {
      if (document.body?.classList.contains(`course-${course}`)) return course;
    }
    const match = location.pathname.toLowerCase().match(/\/(istruttore|bagnino|arte)(\.html)?\/?$/);
    return match ? match[1] : null;
  }

  function db() { return window.FirebaseQuiz?.db || null; }
  function config(course) { return COURSE_CONFIG[course] || COURSE_CONFIG.istruttore; }
  function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function yesterdayKey() {
    const d = new Date(); d.setDate(d.getDate()-1);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function keyFromDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function offsetKey(dateKey, offsetDays) {
    const m = String(dateKey).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const base = m ? new Date(Number(m[1]), Number(m[2])-1, Number(m[3])) : new Date();
    base.setDate(base.getDate() + offsetDays);
    return keyFromDate(base);
  }
  // Giorni di calendario tra due chiavi YYYY-MM-DD (b - a), senza problemi di ora legale.
  function daysBetween(a, b) {
    const pa = String(a || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const pb = String(b || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!pa || !pb) return 0;
    const ua = Date.UTC(Number(pa[1]), Number(pa[2]) - 1, Number(pa[3]));
    const ub = Date.UTC(Number(pb[1]), Number(pb[2]) - 1, Number(pb[3]));
    return Math.round((ub - ua) / 86400000);
  }
  // REGOLA DELLA STREAK (unica implementazione, usata da sito, classifica e simulatore admin):
  //  - ogni giorno in cui raggiungi l'obiettivo: +1;
  //  - ogni giorno intero saltato: -1 (mai sotto zero). Es.: 3 → salti un giorno → 2.
  // Nel documento si salvano la streak al momento dell'ultimo giorno riuscito (lastMetDate);
  // i giorni saltati dopo si scalano quando si legge, così il valore è sempre reale
  // anche per chi non apre il sito (e la classifica scende da sola).
  function missedDaysAt(state, dateKey) {
    if (!state?.lastMetDate) return 0;
    return Math.max(0, daysBetween(state.lastMetDate, dateKey) - 1);
  }
  // Streak valida nel giorno dateKey (il giorno in corso non conta ancora come saltato).
  function liveStreakAt(state, dateKey) {
    if (!state || !state.lastMetDate) return 0;
    const streak = Math.max(0, Number(state.streak || 0));
    if (state.lastMetDate >= dateKey) return streak;
    return Math.max(0, streak - missedDaysAt(state, dateKey));
  }
  // met=true quando il traguardo giornaliero è stato raggiunto nel giorno dateKey.
  function nextStreakState(prevState, dateKey, met) {
    let streak = Number(prevState?.streak || 0);
    let bestStreak = Number(prevState?.bestStreak || 0);
    let totalGoalDays = Number(prevState?.totalGoalDays || 0);
    let lastMetDate = prevState?.lastMetDate || null;
    if (met && (!lastMetDate || dateKey > lastMetDate)) {
      streak = liveStreakAt(prevState, dateKey) + 1;
      lastMetDate = dateKey;
      totalGoalDays += 1;
      bestStreak = Math.max(bestStreak, streak);
    }
    return { streak, bestStreak, totalGoalDays, lastMetDate };
  }
  // Tempo che resta fino a mezzanotte (fine del giorno per l'obiettivo).
  function timeLeftToday(now = new Date()) {
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
    const minutes = Math.max(0, Math.round((end - now) / 60000));
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return { minutes, label: h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min` };
  }
  function parseLocalDate(value) {
    if (!value) return null;
    const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2])-1, Number(m[3]), 23, 59, 59, 999);
  }
  function daysUntil(dateValue) {
    const target = parseLocalDate(dateValue);
    if (!target) return null;
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(target.getFullYear(), target.getMonth(), target.getDate());
    return Math.max(0, Math.ceil((end - start) / 86400000) + 1);
  }
  function escapeHtml(value) {
    return String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  }
  function pluralize(value, unit) {
    return unit === 'opere' ? (value === 1 ? 'opera' : 'opere') : (value === 1 ? 'domanda' : 'domande');
  }
  function flameLevel(streak) {
    if (streak >= 365) return 10;
    if (streak >= 200) return 9;
    if (streak >= 150) return 8;
    if (streak >= 100) return 7;
    if (streak >= 75) return 6;
    if (streak >= 50) return 5;
    if (streak >= 30) return 4;
    if (streak >= 20) return 3;
    if (streak >= 10) return 2;
    return streak > 0 ? 1 : 0;
  }
  function safeGoal(raw, course) {
    const c = config(course);
    return {
      courseId: course,
      courseLabel: c.label,
      unit: c.unit,
      totalUnits: Number(raw?.totalUnits || c.total),
      courseCompletedUnits: Number(raw?.courseCompletedUnits || 0),
      goalMode: raw?.goalMode || 'daily',
      dailyTarget: Math.max(1, Number(raw?.dailyTarget || 10)),
      examDate: raw?.examDate || '',
      margin: raw?.margin || 'standard',
      dailyCounts: raw?.dailyCounts && typeof raw.dailyCounts === 'object' ? raw.dailyCounts : {},
      lastMetDate: raw?.lastMetDate || null,
      streak: Number(raw?.streak || 0),
      bestStreak: Number(raw?.bestStreak || 0),
      totalGoalDays: Number(raw?.totalGoalDays || 0),
      lifetimeRecordedUnits: Number(raw?.lifetimeRecordedUnits || 0),
      updatedAt: raw?.updatedAt || null,
      createdAt: raw?.createdAt || null
    };
  }

  function goalRef(course) {
    return db().collection('users').doc(currentUser.uid).collection('studyGoals').doc(course);
  }

  // Lettura "rigida": lancia se Firestore non risponde, restituisce null solo se il documento non esiste.
  // Serve per non scambiare un errore di rete per "obiettivo assente" (e quindi non azzerare la streak).
  async function readGoalStrict(course) {
    if (!currentUser || !db()) throw new Error('Accedi al sito per usare l’obiettivo.');
    const snap = await goalRef(course).get();
    return snap.exists ? safeGoal(snap.data(), course) : null;
  }

  async function readGoal(course) {
    if (!currentUser || !db()) return null;
    try {
      return await readGoalStrict(course);
    } catch (error) {
      console.warn('Obiettivo studio non disponibile:', error);
      return null;
    }
  }

  // ---- Classifica: una per corso, in courseLeaderboards/{corso}/entries/{uid} ----
  function boardRef(course) {
    return db().collection('courseLeaderboards').doc(course).collection('entries');
  }

  function playerName() {
    return currentUser?.displayName?.trim() || (currentUser?.email ? currentUser.email.split('@')[0] : 'Utente');
  }

  // Nella classifica salviamo la streak grezza + lastMetDate: chi legge calcola la streak reale
  // (−1 per ogni giorno saltato), quindi chi smette scende da solo fino a uscire dalla classifica.
  async function writeLeaderboard(goal) {
    if (!currentUser || !db() || !goal?.courseId || !goal.lastMetDate) return;
    try {
      const ref = boardRef(goal.courseId).doc(currentUser.uid);
      const previousSnap = await ref.get();
      const previous = previousSnap.exists ? (previousSnap.data() || {}) : {};
      const live = liveStreakAt(goal, todayKey());
      await ref.set({
        uid: currentUser.uid,
        displayName: playerName().slice(0, 60),
        streak: Number(goal.streak || 0),
        bestStreak: Math.max(Number(previous.bestStreak || 0), Number(goal.bestStreak || 0)),
        totalGoalDays: Math.max(Number(previous.totalGoalDays || 0), Number(goal.totalGoalDays || 0)),
        lastMetDate: goal.lastMetDate,
        flameLevel: flameLevel(live),
        courseId: goal.courseId,
        courseLabel: goal.courseLabel || config(goal.courseId).label,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    } catch (error) {
      console.warn('Classifica non aggiornata:', error);
    }
  }

  // Riallinea la classifica una volta al giorno per corso (copre chi aveva gia una streak
  // prima di questa versione, o una scrittura fallita per rete assente).
  async function syncLeaderboardOnce(goal) {
    if (!goal?.courseId || !currentUser) return;
    if (liveStreakAt(goal, todayKey()) <= 0) return;
    const flag = `quizNuotoBoardSync:${currentUser.uid}:${goal.courseId}:${todayKey()}:${goal.streak}`;
    try { if (localStorage.getItem(flag)) return; } catch { /* storage non disponibile */ }
    await writeLeaderboard(goal);
    try { localStorage.setItem(flag, '1'); } catch { /* ignora */ }
  }

  async function readBoard(course, limit = 200) {
    if (!db() || !currentUser) return [];
    const today = todayKey();
    try {
      // Tutti quelli con una streak salvata: la streak reale (con i giorni saltati scalati) si calcola qui
      const snap = await boardRef(course).where('streak', '>', 0).limit(limit).get();
      const rows = [];
      snap.forEach((doc) => rows.push(doc.data() || {}));
      return rows
        .map((row) => ({ ...row, live: liveStreakAt(row, today), missed: missedDaysAt(row, today), doneToday: row.lastMetDate === today }))
        .filter((row) => row.live > 0)
        .sort((a, b) => b.live - a.live || Number(b.doneToday) - Number(a.doneToday) || Number(b.bestStreak || 0) - Number(a.bestStreak || 0) || Number(b.totalGoalDays || 0) - Number(a.totalGoalDays || 0));
    } catch (error) {
      console.warn('Lettura classifica non riuscita:', error);
      return [];
    }
  }

  // ---- Classifica "risposte corrette" (solo quiz misto, indipendente dall'obiettivo/streak) ----
  // Scrive sullo stesso documento per-corso della classifica streak (un solo doc per utente per
  // corso), ma non richiede affatto che un obiettivo giornaliero sia stato impostato o raggiunto:
  // conta semplicemente le risposte giuste nel quiz misto, per sempre, corso per corso.
  async function recordCorrectAnswers(course, correctCount) {
    const add = Math.floor(Number(correctCount));
    if (!currentUser || !db() || !Number.isFinite(add) || add <= 0) return;
    try {
      const ref = boardRef(course).doc(currentUser.uid);
      const snap = await ref.get();
      const previous = snap.exists ? (snap.data() || {}) : {};
      await ref.set({
        uid: currentUser.uid,
        displayName: playerName().slice(0, 60),
        courseId: course,
        courseLabel: config(course).label,
        totalCorrect: Number(previous.totalCorrect || 0) + add,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    } catch (error) {
      console.warn('Classifica risposte corrette non aggiornata:', error);
    }
  }

  async function readBoardByCorrect(course, limit = 200) {
    if (!db() || !currentUser) return [];
    try {
      const snap = await boardRef(course).where('totalCorrect', '>', 0).limit(limit).get();
      const rows = [];
      snap.forEach((doc) => rows.push(doc.data() || {}));
      return rows.sort((a, b) => Number(b.totalCorrect || 0) - Number(a.totalCorrect || 0));
    } catch (error) {
      console.warn('Lettura classifica risposte corrette non riuscita:', error);
      return [];
    }
  }

  // saveGoal scrive SOLO le impostazioni dell'obiettivo: non tocca mai streak, record e conteggi.
  // (Prima riscriveva anche quei campi partendo da una lettura che, se falliva, li azzerava.)
  async function saveGoal(course, values) {
    if (!currentUser || !db()) throw new Error('Accedi al sito per impostare l’obiettivo.');
    const c = config(course);
    let previous = null;
    let readOk = true;
    try { previous = await readGoalStrict(course); } catch { readOk = false; }
    const now = firebase.firestore.FieldValue.serverTimestamp();
    const settings = safeGoal({ ...(previous || {}), ...values, courseId: course, courseLabel: c.label, unit: c.unit, totalUnits: c.total }, course);
    const payload = {
      courseId: course,
      courseLabel: c.label,
      unit: c.unit,
      totalUnits: c.total,
      goalMode: settings.goalMode,
      dailyTarget: settings.dailyTarget,
      examDate: settings.examDate,
      margin: settings.margin,
      updatedAt: now
    };
    if (readOk && !previous) payload.createdAt = now;
    await goalRef(course).set(payload, { merge: true });
    await syncLeaderboardOnce(settings);
    await refreshWidget(course);
    return settings;
  }

  function buildGoalCalculation(course, mode, target, examDate, margin, completedUnits) {
    const c = config(course);
    const totalRemaining = Math.max(0, c.total - Math.max(0, Number(completedUnits || 0)));
    if (mode === 'deadline' && examDate) {
      const days = daysUntil(examDate);
      if (days !== null && days > 0) {
        const usableDays = Math.max(1, Math.floor(days * (1 - (MARGIN_MAP[margin] ?? 0.10))));
        const recommended = Math.max(1, Math.ceil(totalRemaining / usableDays));
        return { daily: recommended, days, usableDays, remaining: totalRemaining };
      }
    }
    const daily = Math.max(1, Number(target || 10));
    return { daily, days: Math.max(1, Math.ceil(totalRemaining / daily)), usableDays: Math.max(1, Math.ceil(totalRemaining / daily)), remaining: totalRemaining };
  }

  function makeSetupModal(course, existing = null, onSaved = null) {
    const c = config(course);
    const goal = safeGoal(existing || {}, course);
    const modal = document.createElement('div');
    modal.className = 'study-goal-modal modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.innerHTML = `
      <div class="modal-card study-goal-card">
        <div class="modal-head">
          <div>
            <p class="eyebrow">Il tuo percorso</p>
            <h3>${existing ? 'Modifica obiettivo' : 'Imposta il tuo obiettivo'}</h3>
            <p class="message">Prima di iniziare <strong>${escapeHtml(c.label)}</strong>, scegli il ritmo che vuoi mantenere. Il fuoco cresce quando raggiungi l’obiettivo giornaliero.</p>
          </div>
          <button class="icon-btn" type="button" data-study-close aria-label="Chiudi">×</button>
        </div>
        <div class="study-goal-summary">
          <div><strong>${c.total}</strong><span>${escapeHtml(pluralize(c.total, c.unit))} nel percorso</span></div>
          <div><strong>${goal.courseCompletedUnits || 0}</strong><span>già completate</span></div>
        </div>
        <div class="study-goal-mode-row">
          <button type="button" class="study-mode-btn ${goal.goalMode === 'daily' ? 'active' : ''}" data-mode="daily">🎯 Ritmo giornaliero</button>
          <button type="button" class="study-mode-btn ${goal.goalMode === 'deadline' ? 'active' : ''}" data-mode="deadline">📅 Data esame</button>
        </div>
        <div class="study-goal-pane" data-pane="daily">
          <p class="study-help">Scegli quante ${escapeHtml(c.unit)} vuoi completare ogni giorno.</p>
          <div class="study-target-grid">
            ${[10,20,30].map(n => `<button type="button" class="study-target-btn ${goal.goalMode === 'daily' && goal.dailyTarget === n ? 'active' : ''}" data-target="${n}">${n}<span>${escapeHtml(c.unit)}/giorno</span></button>`).join('')}
          </div>
          <label class="study-inline-label">Obiettivo personalizzato<input id="studyDailyTarget" type="number" min="1" max="500" value="${goal.dailyTarget || 10}" /></label>
        </div>
        <div class="study-goal-pane ${goal.goalMode === 'deadline' ? '' : 'hidden'}" data-pane="deadline">
          <label class="study-inline-label">Data dell’esame<input id="studyExamDate" type="date" value="${escapeHtml(goal.examDate || '')}" /></label>
          <label class="study-inline-label">Quanto margine vuoi?
            <select id="studyMargin">
              <option value="comfortable" ${goal.margin === 'comfortable' ? 'selected' : ''}>Comodo · finisci prima</option>
              <option value="standard" ${goal.margin === 'standard' ? 'selected' : ''}>Standard · piccolo margine</option>
              <option value="tight" ${goal.margin === 'tight' ? 'selected' : ''}>Tirato · fino alla scadenza</option>
            </select>
          </label>
        </div>
        <div class="study-calculation" id="studyCalculation"></div>
        <p class="study-goal-error message" id="studyGoalError"></p>
        <div class="study-goal-actions result-actions">
          <button type="button" class="secondary-btn" data-study-close>Annulla</button>
          <button type="button" class="primary-btn" data-study-save>Salva e ${existing ? 'continua' : 'inizia'}</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    let mode = goal.goalMode === 'deadline' ? 'deadline' : 'daily';
    const dailyInput = modal.querySelector('#studyDailyTarget');
    const examInput = modal.querySelector('#studyExamDate');
    const marginInput = modal.querySelector('#studyMargin');
    const calc = modal.querySelector('#studyCalculation');
    const err = modal.querySelector('#studyGoalError');

    const update = () => {
      modal.querySelectorAll('[data-mode]').forEach(btn => btn.classList.toggle('active', btn.dataset.mode === mode));
      modal.querySelectorAll('[data-pane]').forEach(pane => pane.classList.toggle('hidden', pane.dataset.pane !== mode));
      const result = buildGoalCalculation(course, mode, Number(dailyInput.value || 10), examInput.value, marginInput.value, goal.courseCompletedUnits);
      const days = result.days;
      calc.innerHTML = mode === 'deadline' && examInput.value && days
        ? `<strong>${result.daily} ${escapeHtml(c.unit)}/giorno</strong><span>Con ${escapeHtml(examInput.value)} e un margine ${marginInput.options[marginInput.selectedIndex].text.toLowerCase()}, il ritmo richiesto è circa ${result.daily} al giorno.</span>`
        : `<strong>${result.daily} ${escapeHtml(c.unit)}/giorno</strong><span>Con questo ritmo completeresti il percorso rimanente in circa ${days} ${days === 1 ? 'giorno' : 'giorni'}.</span>`;
    };

    modal.querySelectorAll('[data-mode]').forEach(btn => btn.addEventListener('click', () => { mode = btn.dataset.mode; update(); }));
    modal.querySelectorAll('[data-target]').forEach(btn => btn.addEventListener('click', () => { dailyInput.value = btn.dataset.target; mode = 'daily'; update(); }));
    dailyInput.addEventListener('input', update);
    examInput.addEventListener('change', update);
    marginInput.addEventListener('change', update);
    modal.querySelectorAll('[data-study-close]').forEach(btn => btn.addEventListener('click', () => modal.remove()));
    modal.querySelector('[data-study-save]').addEventListener('click', async () => {
      err.textContent = '';
      let dailyTarget = Number(dailyInput.value || 0);
      if (mode === 'deadline') {
        if (!examInput.value || (daysUntil(examInput.value) || 0) <= 0) {
          err.textContent = 'Inserisci una data d’esame futura.';
          return;
        }
        dailyTarget = buildGoalCalculation(course, 'deadline', dailyTarget, examInput.value, marginInput.value, goal.courseCompletedUnits).daily;
      }
      if (!Number.isFinite(dailyTarget) || dailyTarget < 1) {
        err.textContent = 'Inserisci almeno 1 attività al giorno.';
        return;
      }
      const saveBtn = modal.querySelector('[data-study-save]');
      saveBtn.disabled = true;
      saveBtn.textContent = 'Salvataggio…';
      try {
        const saved = await saveGoal(course, { goalMode: mode, dailyTarget, examDate: mode === 'deadline' ? examInput.value : '', margin: marginInput.value || 'standard' });
        modal.remove();
        if (typeof onSaved === 'function') onSaved(saved);
      } catch (error) {
        err.textContent = error.message || 'Impossibile salvare l’obiettivo.';
        saveBtn.disabled = false;
        saveBtn.textContent = `Salva e ${existing ? 'continua' : 'inizia'}`;
      }
    });

    update();
    return modal;
  }

  async function ensureGoal(course, onSaved = null) {
    let existing = null;
    try {
      existing = await readGoalStrict(course);
    } catch (error) {
      // Rete assente o Firestore non raggiungibile: non blocchiamo l'ingresso al corso
      // con una finestra che non potrebbe nemmeno salvare.
      console.warn('Obiettivo non verificabile, entro comunque nel corso:', error);
      return { offline: true };
    }
    if (existing) return existing;
    makeSetupModal(course, null, onSaved);
    return null;
  }

  // Ultimo valore già sincronizzato per corso: niente letture dal database se non è cambiato niente
  const lastSyncedUnits = new Map();
  async function syncCourseProgress(course, completedUnits) {
    const value = Math.max(0, Number(completedUnits || 0));
    const key = `${currentUser?.uid || ''}:${course}`;
    if (lastSyncedUnits.get(key) === value) return;
    lastSyncedUnits.set(key, value);
    const goal = await readGoal(course);
    if (!goal) return;
    if (value === goal.courseCompletedUnits) return;
    try {
      await goalRef(course).set({
        courseCompletedUnits: Math.min(goal.totalUnits, value),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      await refreshWidget();
    } catch (error) {
      console.warn('Sincronizzazione progresso obiettivo non riuscita:', error);
    }
  }

  // ---- Registrazione attivita (con coda locale se la rete manca) ----
  function readPending() {
    try { return JSON.parse(localStorage.getItem(PENDING_KEY) || '[]'); } catch { return []; }
  }
  function writePending(list) {
    try { localStorage.setItem(PENDING_KEY, JSON.stringify(list.slice(-200))); } catch { /* ignora */ }
  }
  function queueActivity(item) {
    const list = readPending();
    list.push(item);
    writePending(list);
  }

  let flushing = false;
  async function flushPendingActivity() {
    if (flushing || !currentUser || !db()) return;
    const all = readPending();
    const mine = all.filter((item) => item.uid === currentUser.uid);
    if (!mine.length) return;
    flushing = true;
    const others = all.filter((item) => item.uid !== currentUser.uid);
    const remaining = [];
    let failed = false;
    for (const item of mine) {
      if (failed) { remaining.push(item); continue; }
      try { await applyActivity(item.course, item.amount, item.key); }
      catch { failed = true; remaining.push(item); }
    }
    writePending([...others, ...remaining]);
    flushing = false;
  }

  // Lancia se la lettura/scrittura su Firestore fallisce (cosi il chiamante puo mettere in coda).
  async function applyActivity(course, amount, key) {
    const goal = await readGoalStrict(course);
    if (!goal) return; // nessun obiettivo impostato per questo corso: niente streak
    const add = Math.max(1, Math.floor(Number(amount)));
    const nextCount = Number(goal.dailyCounts[key] || 0) + add;
    // Il giorno vale per la streak se il traguardo e raggiunto e quel giorno non e ancora stato accreditato.
    // Il confronto con lastMetDate evita azzeramenti se cambi obiettivo a meta giornata
    // e impedisce a un'attivita "vecchia" in coda di far tornare indietro la streak.
    const credit = nextCount >= goal.dailyTarget && (!goal.lastMetDate || key > goal.lastMetDate);
    const next = nextStreakState(goal, key, credit);
    const lifetimeRecordedUnits = Number(goal.lifetimeRecordedUnits || 0) + add;
    await goalRef(course).set({
      dailyCounts: { [key]: nextCount },
      streak: next.streak,
      bestStreak: next.bestStreak,
      totalGoalDays: next.totalGoalDays,
      lastMetDate: next.lastMetDate,
      lifetimeRecordedUnits,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    const nextGoal = safeGoal({ ...goal, dailyCounts: { ...goal.dailyCounts, [key]: nextCount }, ...next, lifetimeRecordedUnits }, course);
    try {
      await writeLeaderboard(nextGoal);
      await refreshWidget();
      if (credit && key === todayKey()) celebrateMilestone(course, nextGoal);
    } catch (error) {
      console.warn('Aggiornamento grafico obiettivo non riuscito:', error);
    }
  }

  async function recordActivity(course, amount = 1) {
    if (!currentUser || !db() || !Number.isFinite(Number(amount)) || Number(amount) <= 0) return;
    const key = todayKey();
    try {
      await applyActivity(course, amount, key);
    } catch (error) {
      console.warn('Attivita non registrata, la riprovo piu tardi:', error);
      queueActivity({ uid: currentUser.uid, course, key, amount: Math.floor(Number(amount)) });
    }
  }

  function displayStreak(goal) {
    if (!goal) return 0;
    return liveStreakAt(goal, todayKey());
  }
  // 'done' obiettivo di oggi fatto · 'risk' streak accesa ma oggi ancora da fare · 'start' nessuna streak
  function streakState(goal) {
    const today = todayKey();
    if (!goal) return 'none';
    if (goal.lastMetDate === today) return 'done';
    return displayStreak(goal) > 0 ? 'risk' : 'start';
  }
  // Frase sotto al fuoco: cosa manca oggi, entro quando, e se la streak è scesa per giorni saltati.
  function streakStatusText(goal, unit) {
    const today = todayKey();
    const live = displayStreak(goal);
    const done = Number(goal.dailyCounts?.[today] || 0);
    const missing = Math.max(0, goal.dailyTarget - done);
    const missed = missedDaysAt(goal, today);
    const parts = [];
    if (missed > 0 && Number(goal.streak || 0) > 0) {
      parts.push(`Hai saltato ${missed === 1 ? '1 giorno' : `${missed} giorni`}: la streak è scesa da ${goal.streak} a ${live}.`);
    }
    if (goal.lastMetDate === today) {
      parts.push(`Obiettivo di oggi fatto: streak al sicuro fino a domani.`);
    } else {
      parts.push(live > 0
        ? `Ti mancano ${missing} ${unit} prima di mezzanotte: se salti oggi la streak scende a ${live - 1}.`
        : `Fai ${missing} ${unit} prima di mezzanotte per accendere il fuoco.`);
    }
    return parts.join(' ');
  }

  // ---- Conto alla rovescia fino a mezzanotte, sul fuoco (secondo per secondo) ----
  function secondsToMidnight(now = new Date()) {
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
    return Math.max(0, Math.floor((end - now) / 1000));
  }
  function countdownHtml(extraClass = '') {
    return `<span class="study-countdown ${extraClass}" data-study-countdown role="timer" aria-label="Tempo che resta fino a mezzanotte"><span data-cd="h">--</span><i>:</i><span data-cd="m">--</span><i>:</i><span class="study-cd-s" data-cd="s">--</span></span>`;
  }
  let countdownTimer = null;
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  let countdownDay = '';
  function tickCountdowns() {
    const nodes = document.querySelectorAll('[data-study-countdown]');
    const day = todayKey();
    if (countdownDay && day !== countdownDay) { countdownDay = day; refreshWidget(); return; }
    countdownDay = day;
    if (!nodes.length) return;
    const left = secondsToMidnight();
    const values = { h: String(Math.floor(left / 3600)).padStart(2, '0'), m: String(Math.floor((left % 3600) / 60)).padStart(2, '0'), s: String(left % 60).padStart(2, '0') };
    nodes.forEach((node) => {
      ['h', 'm', 's'].forEach((k) => {
        const part = node.querySelector(`[data-cd="${k}"]`);
        if (!part || part.textContent === values[k]) return;
        part.textContent = values[k];
        // "tac": la cifra che cambia scende di scatto (animazione senza ricalcolare la pagina)
        if (!reduceMotion && part.animate) {
          part.animate([{ transform: 'translateY(-60%)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 340, easing: 'cubic-bezier(.2, .9, .3, 1.35)' });
        }
      });
      node.classList.toggle('is-urgent', left < 3600);
      node.classList.toggle('is-close', left >= 3600 && left < 3 * 3600);
    });
  }
  function startCountdowns() {
    if (countdownTimer) return;
    const loop = () => {
      tickCountdowns();
      countdownTimer = setTimeout(loop, 1000 - (Date.now() % 1000) + 8);
    };
    loop();
  }

  function celebrateMilestone(course, goal) {
    const today = todayKey();
    const key = `quizNuotoStudyMilestone:${currentUser.uid}:${course}:${today}`;
    try {
      if (localStorage.getItem(key) === String(goal.dailyTarget)) return;
      localStorage.setItem(key, String(goal.dailyTarget));
    } catch { /* storage non disponibile: mostriamo comunque */ }
    document.body.classList.add('study-milestone-flash');
    const overlay = document.createElement('div');
    overlay.className = 'study-milestone-overlay';
    overlay.innerHTML = `<div class="study-milestone-card"><div class="study-big-fire">🔥</div><p class="eyebrow">Obiettivo raggiunto</p><h2>${goal.dailyTarget} ${escapeHtml(goal.unit)}</h2><p>Il tuo fuoco sale a <strong>${displayStreak(goal)} ${displayStreak(goal) === 1 ? 'giorno' : 'giorni'}</strong> di streak.</p><button type="button" class="primary-btn" data-study-celebrate>Continua</button></div>`;
    overlay.querySelector('[data-study-celebrate]').addEventListener('click', () => overlay.remove());
    document.body.appendChild(overlay);
    setTimeout(() => overlay.remove(), 4200);
    setTimeout(() => document.body.classList.remove('study-milestone-flash'), 1000);
  }

  // ---- Riquadro streak ----
  // Portale: un solo riquadro con la streak di ciascun corso a cui hai accesso.
  // Pagina corso: riquadro con la streak di quel corso + pulsante per la classifica di quel corso.
  function mountWidget() {
    if (mounted || !currentUser) return;
    const host = getWidgetHost();
    if (!host) return;
    widget = document.createElement('section');
    if (mountCourse) {
      widget.className = 'study-goal-widget panel';
      widget.innerHTML = `<div class="study-widget-head"><div><p class="eyebrow">Obiettivo e streak</p><h2>Il tuo fuoco</h2></div><div class="study-widget-actions"><button type="button" class="secondary-btn small-btn" data-study-leaderboard>🏆 Classifica</button><button type="button" class="secondary-btn small-btn" data-study-settings>⚙ Obiettivo</button></div></div><div class="study-widget-body"><div class="study-flame-wrap"><div class="study-fire-box"><div class="study-fire" data-study-fire aria-label="Fuoco streak">🔥</div>${countdownHtml()}</div><strong data-study-streak>0</strong><span data-study-streak-label>giorni</span></div><div class="study-widget-copy"><strong data-study-today>Imposta il tuo primo obiettivo.</strong><span data-study-copy>Quando raggiungi la quota del giorno, il fuoco cresce e la streak aumenta.</span><div class="study-mini-progress"><span data-study-progress-bar></span></div><span class="study-mini-progress-text" data-study-progress-text>—</span></div></div>`;
      host.prepend(widget);
      widget.querySelector('[data-study-settings]').addEventListener('click', async () => {
        makeSetupModal(mountCourse, await readGoal(mountCourse));
      });
      widget.querySelector('[data-study-leaderboard]').addEventListener('click', () => showLeaderboard(mountCourse));
    } else {
      widget.className = 'study-goal-widget study-portal-widget panel hidden';
      widget.innerHTML = `<div class="study-widget-head"><div><p class="eyebrow">Le tue streak</p><h2>Il tuo fuoco, corso per corso</h2></div></div><div class="study-portal-grid" data-study-portal-grid></div>`;
      host.prepend(widget);
    }
    mounted = true;
  }

  function getWidgetHost() {
    const slot = document.getElementById('studyGoalSlot');
    if (slot) return slot;
    if (mountCourse) return document.getElementById('homeView');
    return document.getElementById('mainContent');
  }

  async function refreshWidget() {
    if (!widget || !currentUser) return;
    const seq = ++refreshSeq;
    if (!mountCourse) return refreshPortalWidget(seq);
    const course = mountCourse;
    const goal = await readGoal(course);
    if (seq !== refreshSeq || !widget) return;
    const c = config(course);
    const streak = displayStreak(goal);
    const todayCount = goal ? Number(goal.dailyCounts[todayKey()] || 0) : 0;
    const target = goal?.dailyTarget || 0;
    const pct = target ? Math.min(100, Math.round((todayCount / target) * 100)) : 0;
    widget.classList.toggle('study-widget-has-goal', Boolean(goal));
    widget.classList.toggle('study-widget-no-goal', !goal);
    widget.dataset.course = course;
    widget.querySelector('[data-study-streak]').textContent = String(streak);
    widget.querySelector('[data-study-streak-label]').textContent = streak === 1 ? 'giorno' : 'giorni';
    widget.querySelector('[data-study-fire]').dataset.level = String(flameLevel(streak));
    widget.querySelector('[data-study-progress-bar]').style.width = `${pct}%`;
    widget.querySelector('[data-study-progress-text]').textContent = goal ? `${todayCount} / ${target} ${c.unit} oggi` : 'Nessun obiettivo impostato';
    widget.querySelector('[data-study-today]').textContent = goal ? `${Math.min(todayCount, target)} / ${target} ${c.unit}` : 'Imposta il tuo obiettivo';
    const settingsBtn = widget.querySelector('[data-study-settings]');
    settingsBtn.textContent = goal ? '⚙ Obiettivo' : 'Imposta obiettivo';
    settingsBtn.classList.toggle('primary-btn', !goal);
    settingsBtn.classList.toggle('secondary-btn', Boolean(goal));
    const copy = widget.querySelector('[data-study-copy]');
    if (!goal) copy.textContent = 'Scegli il ritmo giornaliero: quando lo raggiungi si accende il fuoco.';
    else {
      copy.textContent = streakStatusText(goal, c.unit);
      syncLeaderboardOnce(goal);
    }
    widget.dataset.streakState = goal ? streakState(goal) : 'none';
    const running = Boolean(goal) && goal.lastMetDate !== todayKey();
    widget.querySelector('[data-study-countdown]').hidden = !running;
    if (running) startCountdowns();
    tickCountdowns();
  }

  async function refreshPortalWidget(seq) {
    // Mostriamo solo i corsi visibili e sbloccati per l'utente (lo stato delle card lo decide portal.js).
    const visible = COURSES.filter((course) => {
      const card = document.getElementById(`course${course[0].toUpperCase()}${course.slice(1)}Card`);
      return card && !card.classList.contains('hidden') && card.classList.contains('unlocked');
    });
    if (!visible.length) { widget.classList.add('hidden'); return; }
    const goals = await Promise.all(visible.map((course) => readGoal(course)));
    if (seq !== refreshSeq || !widget) return;
    const today = todayKey();
    widget.querySelector('[data-study-portal-grid]').innerHTML = visible.map((course, i) => {
      const goal = goals[i];
      const c = config(course);
      const streak = displayStreak(goal);
      const count = goal ? Number(goal.dailyCounts[today] || 0) : 0;
      const line = !goal ? 'obiettivo non impostato'
        : goal.lastMetDate === today ? `✓ obiettivo di oggi fatto (${goal.dailyTarget} ${c.unit})`
        : `oggi ${Math.min(count, goal.dailyTarget)} / ${goal.dailyTarget} ${c.unit} · ne mancano ${Math.max(0, goal.dailyTarget - count)}`;
      const running = Boolean(goal) && goal.lastMetDate !== today;
      return `<div class="study-portal-tile${running ? ' is-running' : ''}" data-course="${course}"><div class="study-fire-box"><div class="study-fire" data-level="${flameLevel(streak)}" aria-hidden="true">🔥</div>${running ? countdownHtml('is-small') : ''}</div><div class="study-portal-text"><b>${escapeHtml(c.label)}</b><span class="study-portal-streak"><strong>${streak}</strong> ${streak === 1 ? 'giorno' : 'giorni'}</span><small>${escapeHtml(line)}</small></div></div>`;
    }).join('');
    widget.classList.remove('hidden');
    if (widget.querySelector('[data-study-countdown]')) startCountdowns();
    tickCountdowns();
  }

  async function showLeaderboard(course = mountCourse, initialTab = 'streak') {
    if (!course || document.querySelector('.study-leaderboard-modal')) return;
    const c = config(course);
    const modal = document.createElement('div');
    modal.className = 'study-leaderboard-modal modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.innerHTML = `<div class="modal-card study-leaderboard-card">
      <div class="modal-head">
        <div><p class="eyebrow">Classifica del corso</p><h3>🏆 ${escapeHtml(c.label)}</h3></div>
        <button class="icon-btn" type="button" data-study-leader-close aria-label="Chiudi">×</button>
      </div>
      <div class="study-leader-tabs">
        <button type="button" class="admin-tab" data-leader-tab="streak">🔥 Streak</button>
        <button type="button" class="admin-tab" data-leader-tab="correct">✅ Risposte corrette</button>
      </div>
      <p class="message" data-leader-caption></p>
      <div class="study-leaderboard-list" data-leader-list><p class="message">Carico…</p></div>
      <p class="study-your-rank" data-leader-rank></p>
      <div class="site-dialog-actions"><button class="primary-btn" type="button" data-study-leader-close>Chiudi</button></div>
    </div>`;
    document.body.appendChild(modal);
    modal.querySelectorAll('[data-study-leader-close]').forEach((btn) => btn.addEventListener('click', () => modal.remove()));

    const captions = {
      streak: 'Streak reale di questo corso: +1 per ogni giorno con l’obiettivo raggiunto, −1 per ogni giorno saltato. Nessuna email viene mostrata.',
      correct: 'Risposte giuste nel quiz misto di questo corso, per sempre. Nessuna email viene mostrata.'
    };

    async function renderTab(kind) {
      modal.querySelectorAll('[data-leader-tab]').forEach((btn) => btn.classList.toggle('active', btn.dataset.leaderTab === kind));
      modal.querySelector('[data-leader-caption]').textContent = captions[kind];
      const listEl = modal.querySelector('[data-leader-list]');
      const rankEl = modal.querySelector('[data-leader-rank]');
      listEl.innerHTML = '<p class="message">Carico…</p>';
      rankEl.textContent = '';
      const rows = kind === 'streak' ? await readBoard(course) : await readBoardByCorrect(course);
      if (modal.dataset.activeTab !== undefined && modal.dataset.activeTab !== kind) return; // una scheda piu recente ha gia sostituito questa
      const myIndex = rows.findIndex((row) => row.uid === currentUser?.uid);
      if (!rows.length) {
        listEl.innerHTML = kind === 'streak'
          ? '<p class="message">Nessun fuoco acceso in questo corso. Raggiungi l’obiettivo di oggi per aprire la classifica.</p>'
          : '<p class="message">Nessuna risposta giusta nel quiz misto ancora registrata per questo corso.</p>';
      } else if (kind === 'streak') {
        listEl.innerHTML = rows.map((row, i) => {
          const trend = row.doneToday ? '<span class="study-rank-trend up">✓ oggi</span>'
            : row.missed > 0 ? `<span class="study-rank-trend down">↓ ${row.missed === 1 ? '1 giorno saltato' : `${row.missed} giorni saltati`}</span>`
            : '<span class="study-rank-trend">oggi da fare</span>';
          return `<div class="study-rank-row ${row.uid === currentUser?.uid ? 'current' : ''}"><strong>${i + 1}</strong><span class="study-rank-fire">🔥</span><div><b>${escapeHtml(row.displayName || 'Utente')}</b><small>record ${Number(row.bestStreak || 0)} gg · ${trend}</small></div><em>${row.live} gg</em></div>`;
        }).join('');
      } else {
        listEl.innerHTML = rows.map((row, i) => `<div class="study-rank-row ${row.uid === currentUser?.uid ? 'current' : ''}"><strong>${i + 1}</strong><span class="study-rank-fire">✅</span><div><b>${escapeHtml(row.displayName || 'Utente')}</b><small>quiz misto</small></div><em>${Number(row.totalCorrect || 0)}</em></div>`).join('');
      }
      rankEl.textContent = myIndex >= 0
        ? `La tua posizione: #${myIndex + 1}.`
        : (kind === 'streak' ? 'Non sei ancora in classifica: raggiungi l’obiettivo di oggi.' : 'Non sei ancora in classifica: rispondi bene a qualche domanda nel quiz misto.');
    }

    modal.querySelectorAll('[data-leader-tab]').forEach((btn) => btn.addEventListener('click', () => { modal.dataset.activeTab = btn.dataset.leaderTab; renderTab(btn.dataset.leaderTab); }));
    modal.dataset.activeTab = initialTab;
    renderTab(initialTab);
  }

  window.QuizStudyTracker = {
    ensureGoal,
    saveGoal,
    readGoal,
    recordActivity,
    syncCourseProgress,
    refresh: refreshWidget,
    openSetup: async (course) => makeSetupModal(course, await readGoal(course)),
    leaderboard: showLeaderboard,
    readBoard,
    recordCorrectAnswers,
    readBoardByCorrect,
    config: COURSE_CONFIG,
    // Usati dal simulatore streak nel pannello admin: stessa identica funzione di transizione
    // del tracciamento reale, cosi il test verifica la logica vera e non una copia.
    test: { nextStreakState, liveStreakAt, missedDaysAt, daysBetween, todayKey, offsetKey, flameLevel, timeLeftToday, secondsToMidnight }
  };
})();
