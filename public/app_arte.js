(() => {
  'use strict';
  const errText = (e) => (window.QuizErrors ? window.QuizErrors.text(e) : (e?.message || String(e)));

  const OWNER_ADMIN_UID = 'uPsEYGwQwrXZEwt5KID6DnVt51p2';
  const WORKS = Array.isArray(window.ARTE_WORKS) ? window.ARTE_WORKS : [];
  const WORKS_BY_ID = new Map(WORKS.map((w) => [Number(w.id), w]));
  const FIELDS = [
    { key: 'opera', label: 'Nome opera', list: 'operaOptions' },
    { key: 'data', label: 'Data', list: 'dataOptions' },
    { key: 'artista', label: 'Artista', list: 'artistaOptions' },
    { key: 'corrente', label: 'Corrente artistica', list: 'correnteOptions' },
    { key: 'luogo', label: 'Luogo di conservazione', list: 'luogoOptions', optionalByWork: true }
  ];
  const TARGET_DATE = new Date('2026-07-15T23:59:59+02:00');
  const els = {};
  let currentUser = null;
  let currentProfile = {};
  let isAdmin = false;
  let accessGranted = false;
  // Il cloud si aggiorna solo dopo averlo letto: niente sovrascritture con la copia del dispositivo
  let cloudLoaded = false;
  let state = null;
  let currentQuiz = null;
  let currentIndex = 0;
  let currentAnswers = {};
  let currentHints = new Set();
  let pendingResults = [];
  let currentSudoku = null;
  let FEATURE_SETTINGS = {};

  document.addEventListener('DOMContentLoaded', init);

  function init(){
    bindElements(); setupTheme(); bindEvents(); populateOptions(); setupAuth(); updateCountdown(); setInterval(updateCountdown, 1000);
  }

  function bindElements(){
    ['themeToggle','adminBellBtn','adminPendingBadge','logoutBtn','authGate','gateTitle','gateText','arteMain','homeView','quizView','resultsView','statsView','startMixedBtn','startExamBtn','examStatus','showStatsBtn','correnteSelect','startCorrenteBtn','startWrongBtn','startMarkedBtn','sudokuModeSelect','startSudokuBtn','sudokuView','sudokuTitle','sudokuSubtitle','sudokuLives','sudokuScore','exitSudokuBtn','sudokuGrid','sudokuLegend','sudokuChallenge','refreshLeaderboardsBtn','leaderboardDailyList','leaderboardAllTimeList','homeStats','countdownBig','quizModeLabel','quizProgressTitle','quizCounter','exitQuizBtn','sessionProgressBar','workImage','imageFallback','workMeta','answerFields','hintPanel','hintBtn','markWorkBtn','submitWorkBtn','nextWorkBtn','workFeedback','resultTitle','resultSummary','backHomeFromResultsBtn','retryWrongFromResultsBtn','answersReview','backHomeFromStatsBtn','statsGrid','fieldStatsList','historyList','toast'].forEach((id)=>{ els[id]=document.getElementById(id); });
  }

  function bindEvents(){
    els.themeToggle?.addEventListener('click', toggleTheme);
    els.logoutBtn?.addEventListener('click', logout);
    els.adminBellBtn?.addEventListener('click', () => location.href='admin.html');
    els.startMixedBtn?.addEventListener('click', () => startQuiz('mixed'));
    els.startExamBtn?.addEventListener('click', () => startQuiz('exam'));
    els.startCorrenteBtn?.addEventListener('click', () => startQuiz('corrente', els.correnteSelect.value));
    els.startWrongBtn?.addEventListener('click', () => startQuiz('wrong'));
    els.startMarkedBtn?.addEventListener('click', () => startQuiz('marked'));
    els.startSudokuBtn?.addEventListener('click', () => startSudoku(els.sudokuModeSelect?.value || 'corrente'));
    els.refreshLeaderboardsBtn?.addEventListener('click', loadSudokuLeaderboards);
    els.exitSudokuBtn?.addEventListener('click', () => { currentSudoku = null; showView('homeView'); });
    els.markWorkBtn?.addEventListener('click', toggleCurrentWorkMarked);
    els.showStatsBtn?.addEventListener('click', () => { if (blockedByFeature('stats')) return; renderStats(); showView('statsView'); });
    els.exitQuizBtn?.addEventListener('click', () => showView('homeView'));
    els.hintBtn?.addEventListener('click', showHintChoices);
    els.submitWorkBtn?.addEventListener('click', submitCurrentWork);
    els.nextWorkBtn?.addEventListener('click', nextWork);
    els.backHomeFromResultsBtn?.addEventListener('click', () => { renderHome(); showView('homeView'); });
    els.retryWrongFromResultsBtn?.addEventListener('click', () => startQuiz('wrong'));
    els.backHomeFromStatsBtn?.addEventListener('click', () => showView('homeView'));
  }

  function setupAuth(){
    const fb = window.FirebaseQuiz;
    if (!fb?.configured) return setGate('Firebase non configurato', 'Controlla firebase-config.js.');
    fb.auth.onAuthStateChanged(async (user) => {
      currentUser = user;
      cloudLoaded = false;
      clearTimeout(scheduleCloudSync._t);
      if (!user) { location.href='index.html'; return; }
      try {
        // Letture in parallelo: si entra prima nel corso
        const [adminFlag, snap, courseSettingsFirst] = await Promise.all([
          checkIsAdmin(user.uid),
          db().collection('users').doc(user.uid).get(),
          fetchCourseSettings()
        ]);
        if (currentUser !== user) return;
        isAdmin = adminFlag;
        const data = snap.exists ? (snap.data() || {}) : {};
        currentProfile = data.profile || {};
        const access = data.access || {};

        if (!isAdmin) {
          const courseSettingsSnap = courseSettingsFirst;
          const siteSnap = FEATURE_SETTINGS.site || {};
          const systemGate = (kind, scope, title, reason) => {
            setGate(title, reason || '');
            window.QuizGate?.show({ kind, scope, reason, courseLabel: 'Arte · Quinto Liceo' });
          };
          if (siteSnap.maintenance) { systemGate('maintenance', 'site', 'Sito in manutenzione', siteSnap.maintenanceMessage); return; }
          if (siteSnap.blocked) { systemGate('blocked', 'site', 'Sito non disponibile', siteSnap.blockReason); return; }
          if (courseSettingsSnap.maintenance) { systemGate('maintenance', 'course', 'Corso in manutenzione', courseSettingsSnap.maintenanceMessage); return; }
          if (courseSettingsSnap.blocked || courseSettingsSnap.hidden) { systemGate('blocked', 'course', 'Corso non disponibile', courseSettingsSnap.blockReason); return; }
        }

        if (!isAdmin && access.banned) {
          setGate('Account bloccato', `Questo account è stato bloccato.${access.banReason ? ` Motivo: ${access.banReason}` : ''}`);
          return;
        }
        accessGranted = isAdmin || access.courseAccess?.arte === true;
        if (!accessGranted) {
          setGate('Corso non autorizzato', 'Non hai l’autorizzazione per entrare nel corso Arte. Torna alla schermata corsi e richiedi accesso.');
          return;
        }
        els.authGate.classList.add('hidden');
        els.arteMain.classList.remove('hidden');
        els.logoutBtn.classList.remove('hidden');
        state = loadState();
        await loadCloudState();
        renderHome();
        applyFeatureGatingUI();
        await loadAdminPendingBell();
        await loadCourseAnnouncements();
        await loadSudokuLeaderboards();
      } catch(error){ setGate('Errore account', errText(error)); }
    });
  }

  async function checkIsAdmin(uid){
    if (uid === OWNER_ADMIN_UID) return true;
    try { const snap = await db().collection('admins').doc(uid).get(); return Boolean(snap.exists && snap.data()?.active); }
    catch { return false; }
  }

  async function fetchCourseSettings(){
    try {
      const snap = await db().collection('courseSettings').get();
      const next = {};
      snap.forEach((doc) => { next[doc.id] = doc.data() || {}; });
      FEATURE_SETTINGS = next;
      return next.arte || {};
    } catch { FEATURE_SETTINGS = {}; return {}; }
  }

  function getFeatureState(feature) {
    return FEATURE_SETTINGS[`arte.${feature}`] || {};
  }

  function blockedByFeature(feature) {
    if (isAdmin) return false;
    const f = getFeatureState(feature);
    if (f.maintenance) {
      showToast(`Funzione in manutenzione.${f.maintenanceMessage ? ' ' + f.maintenanceMessage : ''}`);
      return true;
    }
    if (f.blocked) {
      showToast(`Funzione bloccata.${f.blockReason ? ' Motivo: ' + f.blockReason : ''}`);
      return true;
    }
    if (f.hidden) {
      showToast('Funzione non disponibile al momento.');
      return true;
    }
    return false;
  }

  function applyFeatureGatingUI() {
    const targets = {
      mixed: [els.startMixedBtn],
      corrente: [els.startCorrenteBtn],
      wrong: [els.startWrongBtn],
      exam: [els.startExamBtn],
      marked: [els.startMarkedBtn],
      sudoku: [els.startSudokuBtn],
      stats: [els.showStatsBtn]
    };
    Object.entries(targets).forEach(([feature, buttons]) => {
      // "Novità": lo vedono tutti, admin compreso
      buttons.forEach((btn) => window.QuizNovita?.mark(btn, getFeatureState(feature).novita === true));
      if (isAdmin) return;
      const blocked = Boolean(getFeatureState(feature).blocked || getFeatureState(feature).maintenance || getFeatureState(feature).hidden);
      buttons.forEach((btn) => { if (btn && blocked) btn.disabled = true; });
    });
  }

  async function loadAdminPendingBell(){
    if (!isAdmin || !els.adminBellBtn) return;
    try {
      const snap = await db().collection('accountRequests').limit(200).get();
      let count = 0; snap.forEach((doc)=>{ const s=(doc.data()?.status||'pending'); if(['pending','review'].includes(s)) count++; });
      els.adminPendingBadge.textContent = String(count);
      els.adminBellBtn.classList.remove('hidden');
    } catch {}
  }

  function setGate(title, text){
    els.gateTitle.textContent = title;
    els.gateText.textContent = text;
    els.authGate.classList.remove('hidden');
    els.arteMain.classList.add('hidden');
  }

  function loadState(){
    const key = storageKey();
    try { const merged = { ...defaultState(), ...(JSON.parse(localStorage.getItem(key) || '{}')) }; if(!Array.isArray(merged.markedWorkIds)) merged.markedWorkIds=[]; if(!Array.isArray(merged.adminObjectives)) merged.adminObjectives=[]; return merged; }
    catch { return defaultState(); }
  }
  function saveState(){ localStorage.setItem(storageKey(), JSON.stringify(state)); scheduleCloudSync(); }
  function scheduleCloudSync(){
    if(!currentUser || !accessGranted || isAdmin || !cloudLoaded) return;
    clearTimeout(scheduleCloudSync._t);
    scheduleCloudSync._t = setTimeout(async () => {
      try {
        await db().collection('users').doc(currentUser.uid).collection('courseData').doc('arte').set({
          ...state,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      } catch (error) { console.warn('Sync Arte non riuscito', error); }
    }, 600);
  }
  function storageKey(){ return `quizNuotoArte:v1:${currentUser?.uid || 'guest'}`; }
  function defaultState(){
    const fieldStats = {}; FIELDS.forEach((f)=>{ fieldStats[f.key] = { answered:0, correct:0, wrong:0, hinted:0 }; });
    return { stats:{ totalWorks:0, correctWorks:0, wrongWorks:0, totalFields:0, correctFields:0, wrongFields:0, quizCount:0, hintCount:0, history:[] }, progress:{ completedIds:[] }, wrongWorkIds:[], markedWorkIds:[], fieldStats, recentSignatures:[], adminObjectives:[] };
  }


  async function loadCloudState(){
    if(!currentUser || !accessGranted) return;
    try {
      const snap = await db().collection('users').doc(currentUser.uid).collection('courseData').doc('arte').get();
      if(snap.exists) {
        state = mergeArteState(state || defaultState(), snap.data() || {});
        localStorage.setItem(storageKey(), JSON.stringify(state));
      }
      cloudLoaded = true;
      scheduleCloudSync();
    } catch(error) {
      console.warn('Caricamento cloud Arte non riuscito', error);
      // si riprova quando torna la rete; intanto si studia sul dispositivo
      const user = currentUser;
      window.addEventListener('online', () => { if (currentUser === user && !cloudLoaded) loadCloudState().then(() => renderHome?.()); }, { once: true });
    }
  }

  function mergeArteState(local, cloud){
    const base = { ...defaultState(), ...(local || {}) };
    const out = { ...base, ...(cloud || {}) };
    out.stats = { ...(base.stats || {}), ...(cloud.stats || {}) };
    out.progress = { ...(base.progress || {}), ...(cloud.progress || {}) };
    out.progress.completedIds = uniqueIds([...(base.progress?.completedIds || []), ...(cloud.progress?.completedIds || [])]);
    out.wrongWorkIds = uniqueIds([...(base.wrongWorkIds || []), ...(cloud.wrongWorkIds || [])]).filter((id)=>WORKS_BY_ID.has(id));
    out.markedWorkIds = uniqueIds([...(base.markedWorkIds || []), ...(cloud.markedWorkIds || [])]).filter((id)=>WORKS_BY_ID.has(id));
    out.recentSignatures = Array.isArray(cloud.recentSignatures) ? cloud.recentSignatures.slice(0,120) : (Array.isArray(base.recentSignatures) ? base.recentSignatures.slice(0,120) : []);
    out.fieldStats = { ...(base.fieldStats || {}), ...(cloud.fieldStats || {}) };
    out.adminObjectives = Array.isArray(cloud.adminObjectives) ? cloud.adminObjectives : (Array.isArray(base.adminObjectives) ? base.adminObjectives : []);
    out.adminManualLog = Array.isArray(cloud.adminManualLog) ? cloud.adminManualLog : (Array.isArray(base.adminManualLog) ? base.adminManualLog : []);
    return out;
  }

  function uniqueIds(values){ return [...new Set((values || []).map(Number).filter((id)=>Number.isFinite(id)))]; }

  function populateOptions(){
    const lists = {
      operaOptions: unique(WORKS.map(w=>w.opera)),
      dataOptions: unique(WORKS.map(w=>w.data)),
      artistaOptions: unique(WORKS.map(w=>w.artista)),
      correnteOptions: unique(WORKS.map(w=>w.corrente)),
      luogoOptions: unique(WORKS.filter(w=>w.luogoRichiesto).map(w=>w.luogo))
    };
    Object.entries(lists).forEach(([id, values]) => {
      const el = document.getElementById(id); if (!el) return;
      el.innerHTML = values.map((v)=>`<option value="${escapeHtml(v)}"></option>`).join('');
    });
    const correnti = unique(WORKS.map(w=>w.corrente));
    els.correnteSelect.innerHTML = correnti.map((c)=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  }

  function renderHome(){
    if (window.QuizStudyTracker?.syncCourseProgress) {
      window.QuizStudyTracker.syncCourseProgress('arte', new Set(state.progress.completedIds || []).size);
    }
    const done = new Set(state.progress.completedIds || []);
    const completedAll = done.size >= WORKS.length;
    const acc = state.stats.totalFields ? Math.round((state.stats.correctFields / state.stats.totalFields) * 100) : 0;
    if (els.startExamBtn) {
      els.startExamBtn.disabled = !completedAll;
      els.startExamBtn.textContent = completedAll ? 'Avvia Esamone Arte' : `Esamone bloccato · ${done.size}/${WORKS.length}`;
    }
    if (els.examStatus) {
      els.examStatus.textContent = completedAll
        ? 'Hai completato tutte le opere: l’Esamone è disponibile.'
        : `Completa tutte le ${WORKS.length} opere almeno una volta per sbloccare l’Esamone.`;
    }
    els.homeStats.innerHTML = `
      <div class="stat-card"><strong>${done.size}/${WORKS.length}</strong><span>Opere completate almeno una volta</span></div>
      <div class="stat-card"><strong>${state.stats.quizCount || 0}</strong><span>Quiz completati</span></div>
      <div class="stat-card"><strong>${acc}%</strong><span>Precisione campi</span></div>
      <div class="stat-card"><strong>${state.wrongWorkIds?.length || 0}</strong><span>Opere da ripassare</span></div>
      <div class="stat-card"><strong>${state.markedWorkIds?.length || 0}</strong><span>Opere segnate</span></div>
    `;
  }

  function startQuiz(mode, filterValue=''){
    if (!accessGranted) return showToast('Corso non autorizzato.');
    if (blockedByFeature(mode)) return;
    const works = pickWorks(mode, filterValue);
    if (!works.length) return showToast('Non ci sono opere disponibili per questo quiz.');
    currentQuiz = { mode, filterValue, works, startedAt: new Date().toISOString(), signature: signature(works) };
    currentIndex = 0; pendingResults = [];
    renderCurrentWork(); showView('quizView');
  }

  function pickWorks(mode, filterValue){
    let pool = WORKS.slice();
    let label = 'Quiz misto';
    const done = new Set(state.progress.completedIds || []);
    if (mode === 'exam') {
      if (done.size < WORKS.length) return [];
      label = 'Esamone Arte';
    }
    if (mode === 'corrente') { pool = WORKS.filter(w=>w.corrente === filterValue); label = `Corrente · ${filterValue}`; }
    if (mode === 'wrong') { const ids = new Set(state.wrongWorkIds || []); pool = WORKS.filter(w=>ids.has(w.id)); label = 'Ripasso errori'; }
    if (mode === 'marked') { const ids = new Set(state.markedWorkIds || []); pool = WORKS.filter(w=>ids.has(w.id)); label = 'Opere segnate'; }
    if (mode === 'mixed' && done.size < WORKS.length) {
      const remaining = WORKS.filter(w=>!done.has(w.id));
      pool = remaining.length ? remaining : pool;
    }
    let sample = [];
    const max = Math.min(10, pool.length);
    for(let attempt=0; attempt<80; attempt++){
      sample = shuffle(pool).slice(0, max);
      const sig = signature(sample);
      if(!(state.recentSignatures || []).includes(sig)) break;
    }
    sample.quizLabel = label;
    return sample;
  }

  function renderCurrentWork(){
    const work = currentQuiz.works[currentIndex];
    currentAnswers = {}; currentHints = new Set();
    els.quizModeLabel.textContent = currentQuiz.works.quizLabel || 'Quiz Arte';
    els.quizProgressTitle.textContent = `Opera ${currentIndex + 1}/${currentQuiz.works.length}`;
    els.quizCounter.textContent = `${currentIndex + 1}/${currentQuiz.works.length}`;
    els.sessionProgressBar.style.width = `${Math.round((currentIndex / currentQuiz.works.length) * 100)}%`;
    els.workMeta.textContent = `ID opera ${work.id}${work.paginaPdf ? ' · pagina programma ' + work.paginaPdf : ''}`;
    els.workImage.src = work.imageUrl || '';
    els.workImage.alt = `Opera da riconoscere #${work.id}`;
    els.imageFallback.classList.add('hidden');
    els.workImage.classList.remove('hidden');
    els.workImage.onerror = () => { els.workImage.classList.add('hidden'); els.imageFallback.classList.remove('hidden'); };
    els.answerFields.innerHTML = FIELDS.map((field)=> fieldHtml(field, work)).join('');
    els.answerFields.querySelectorAll('[data-field-input]').forEach((input)=> input.addEventListener('input', () => { currentAnswers[input.dataset.fieldInput] = input.value; }));
    els.hintPanel.classList.add('hidden'); els.hintPanel.innerHTML = '';
    els.workFeedback.classList.add('hidden'); els.workFeedback.innerHTML = '';
    updateMarkButton(work.id);
    els.submitWorkBtn.classList.remove('hidden'); els.nextWorkBtn.classList.add('hidden');
    els.hintBtn.disabled = currentQuiz.mode === 'exam';
    els.hintBtn.classList.toggle('hidden', currentQuiz.mode === 'exam');
  }

  function fieldHtml(field, work){
    const disabled = field.optionalByWork && !work.luogoRichiesto;
    return `<label class="arte-field ${disabled ? 'disabled' : ''}">
      <span>${escapeHtml(field.label)}</span>
      <input data-field-input="${field.key}" list="${field.list}" placeholder="Scrivi o scegli dal menu" ${disabled ? 'disabled value="Non richiesto per questa opera"' : ''} autocomplete="off" />
    </label>`;
  }

  function showHintChoices(){
    const work = currentQuiz.works[currentIndex];
    const available = FIELDS.filter(f => !(f.optionalByWork && !work.luogoRichiesto) && !currentHints.has(f.key));
    if(!available.length) return showToast('Hai già usato tutti gli aiuti disponibili per questa opera.');
    els.hintPanel.innerHTML = `<p class="message">Scegli un campo: lo compiliamo noi con la risposta corretta.</p><div class="split-buttons">${available.map(f=>`<button class="secondary-btn small-btn" data-hint-field="${f.key}" type="button">${escapeHtml(f.label)}</button>`).join('')}</div>`;
    els.hintPanel.classList.remove('hidden');
    els.hintPanel.querySelectorAll('[data-hint-field]').forEach((btn)=> btn.addEventListener('click', () => applyHint(btn.dataset.hintField)));
  }

  function applyHint(fieldKey){
    const work = currentQuiz.works[currentIndex];
    const input = els.answerFields.querySelector(`[data-field-input="${CSS.escape(fieldKey)}"]`);
    if(!input) return;
    input.value = work[fieldKey] || '';
    input.disabled = true;
    currentAnswers[fieldKey] = input.value;
    currentHints.add(fieldKey);
    state.stats.hintCount = Number(state.stats.hintCount || 0) + 1;
    state.fieldStats[fieldKey] = state.fieldStats[fieldKey] || { answered:0, correct:0, wrong:0, hinted:0 };
    state.fieldStats[fieldKey].hinted += 1;
    saveState();
    els.hintPanel.classList.add('hidden');
    showToast('Aiuto applicato.');
  }

  function submitCurrentWork(){
    const work = currentQuiz.works[currentIndex];
    const result = evaluateWork(work);
    pendingResults.push(result);
    updateStateWithResult(result);
    // Niente feedback immediato: le correzioni vengono mostrate solo a fine quiz.
    els.workFeedback.classList.add('hidden');
    els.workFeedback.innerHTML = '';
    els.submitWorkBtn.classList.add('hidden');
    els.nextWorkBtn.classList.remove('hidden');
    els.hintBtn.disabled = true;
    saveState();
    // Streak solo per il quiz misto, come per gli altri corsi: le altre modalita
    // (corrente, ripasso errori, opere segnate, esamone) non alimentano il fuoco.
    if (currentQuiz?.mode === 'mixed' && window.QuizStudyTracker?.recordActivity) {
      window.QuizStudyTracker.recordActivity('arte', 1);
      if (result.correctWork) window.QuizStudyTracker.recordCorrectAnswers?.('arte', 1);
    }
    window.QuizStudyTracker?.syncCourseProgress?.('arte', state.progress.completedIds.length);
  }

  function evaluateWork(work){
    const fields = [];
    FIELDS.forEach((field)=>{
      if(field.optionalByWork && !work.luogoRichiesto) return;
      const userValue = currentAnswers[field.key] || '';
      const correctValue = work[field.key] || '';
      const correct = normalize(userValue) === normalize(correctValue);
      fields.push({ key: field.key, label: field.label, userValue, correctValue, correct, hinted: currentHints.has(field.key) });
    });
    const correctCount = fields.filter(f=>f.correct).length;
    return { workId: work.id, opera: work.opera, imageUrl: work.imageUrl, correctWork: correctCount === fields.length, correctCount, totalFields: fields.length, fields };
  }

  function updateStateWithResult(result){
    state.stats.totalWorks += 1;
    if(result.correctWork) state.stats.correctWorks += 1; else state.stats.wrongWorks += 1;
    state.stats.totalFields += result.totalFields;
    state.stats.correctFields += result.correctCount;
    state.stats.wrongFields += result.totalFields - result.correctCount;
    if(!state.progress.completedIds.includes(result.workId)) state.progress.completedIds.push(result.workId);
    if(result.correctWork) state.wrongWorkIds = (state.wrongWorkIds || []).filter(id => id !== result.workId);
    else if(!state.wrongWorkIds.includes(result.workId)) state.wrongWorkIds.push(result.workId);
    result.fields.forEach((f)=>{
      state.fieldStats[f.key] = state.fieldStats[f.key] || { answered:0, correct:0, wrong:0, hinted:0 };
      state.fieldStats[f.key].answered += 1;
      if(f.correct) state.fieldStats[f.key].correct += 1; else state.fieldStats[f.key].wrong += 1;
    });
  }


  function updateMarkButton(workId){
    if(!els.markWorkBtn) return;
    const marked = (state.markedWorkIds || []).includes(Number(workId));
    els.markWorkBtn.textContent = marked ? '★ Opera segnata' : '☆ Segna opera';
    els.markWorkBtn.classList.toggle('is-marked', marked);
  }

  function toggleCurrentWorkMarked(){
    if(!currentQuiz?.works?.length || !state) return;
    const id = Number(currentQuiz.works[currentIndex]?.id);
    if(!id) return;
    const set = new Set(state.markedWorkIds || []);
    if(set.has(id)) { set.delete(id); showToast('Opera rimossa dalle segnate.'); }
    else { set.add(id); showToast('Opera segnata.'); }
    state.markedWorkIds = [...set];
    updateMarkButton(id);
    saveState();
  }

  function renderFeedback(result){
    els.workFeedback.innerHTML = `<strong>${result.correctWork ? 'Opera completata correttamente.' : `Corrette ${result.correctCount}/${result.totalFields}`}</strong>
      <div class="answer-review-list">${result.fields.map(f=>`<div class="review-answer ${f.correct ? 'correct' : 'wrong'}"><span>${escapeHtml(f.label)}</span><strong>${f.correct ? '✓' : '✕'}</strong><small>Risposta corretta: ${escapeHtml(f.correctValue)}</small></div>`).join('')}</div>`;
    els.workFeedback.classList.remove('hidden');
  }

  function nextWork(){
    currentIndex += 1;
    if(currentIndex >= currentQuiz.works.length) return finishQuiz();
    renderCurrentWork();
  }

  function finishQuiz(){
    state.stats.quizCount += 1;
    const correctWorks = pendingResults.filter(r=>r.correctWork).length;
    const totalFields = pendingResults.reduce((a,r)=>a+r.totalFields,0);
    const correctFields = pendingResults.reduce((a,r)=>a+r.correctCount,0);
    const accuracy = totalFields ? Math.round((correctFields/totalFields)*100) : 0;
    state.stats.history.unshift({ date: new Date().toISOString(), mode: currentQuiz.works.quizLabel || 'Quiz Arte', total: pendingResults.length, correctWorks, totalFields, correctFields, accuracy });
    state.stats.history = state.stats.history.slice(0, 30);
    state.recentSignatures = [currentQuiz.signature, ...(state.recentSignatures || []).filter(s=>s!==currentQuiz.signature)].slice(0, 120);
    saveState();
    renderResults({ correctWorks, totalWorks: pendingResults.length, correctFields, totalFields, accuracy });
    showView('resultsView');
  }

  function renderResults(summary){
    els.resultTitle.textContent = `Hai riconosciuto ${summary.correctWorks}/${summary.totalWorks} opere`;
    els.resultSummary.innerHTML = `
      <div class="stat-card"><strong>${summary.accuracy}%</strong><span>Precisione campi</span></div>
      <div class="stat-card"><strong>${summary.correctFields}/${summary.totalFields}</strong><span>Campi corretti</span></div>
      <div class="stat-card"><strong>${summary.correctWorks}</strong><span>Opere perfette</span></div>
    `;
    els.answersReview.innerHTML = pendingResults.map((r)=>`<article class="review-card"><h4>${escapeHtml(r.opera)}</h4><p>${r.correctCount}/${r.totalFields} campi corretti</p>${r.fields.map(f=>`<div class="review-line ${f.correct ? 'correct' : 'wrong'}"><span>${escapeHtml(f.label)}</span><strong>${f.correct ? '✓' : '✕'}</strong><em>${escapeHtml(f.correctValue)}</em></div>`).join('')}</article>`).join('');
  }

  function renderStats(){
    const acc = state.stats.totalFields ? Math.round((state.stats.correctFields/state.stats.totalFields)*100) : 0;
    els.statsGrid.innerHTML = `
      <div class="stat-card"><strong>${state.progress.completedIds.length}/${WORKS.length}</strong><span>Opere completate</span></div>
      <div class="stat-card"><strong>${state.stats.quizCount}</strong><span>Quiz completati</span></div>
      <div class="stat-card"><strong>${state.stats.totalWorks}</strong><span>Opere viste</span></div>
      <div class="stat-card"><strong>${acc}%</strong><span>Precisione totale</span></div>
      <div class="stat-card"><strong>${state.stats.hintCount || 0}</strong><span>Aiuti usati</span></div>
    `;
    els.fieldStatsList.innerHTML = FIELDS.map((f)=>{
      const s = state.fieldStats[f.key] || { answered:0, correct:0, wrong:0, hinted:0 };
      const p = s.answered ? Math.round((s.correct/s.answered)*100) : 0;
      return `<div class="history-item"><div><strong>${escapeHtml(f.label)}</strong><span>${s.correct}/${s.answered} corrette · ${s.wrong} errori · ${s.hinted || 0} aiuti</span></div><div class="status-pill">${p}%</div></div>`;
    }).join('');
    els.historyList.innerHTML = (state.stats.history || []).length ? state.stats.history.map(h=>`<div class="history-item"><div><strong>${escapeHtml(h.mode)}</strong><span>${formatDate(h.date)} · ${h.correctWorks}/${h.total} opere perfette · ${h.correctFields}/${h.totalFields} campi</span></div><div class="status-pill">${h.accuracy}%</div></div>`).join('') : '<p class="message">Nessuno storico.</p>';
  }


  async function loadCourseAnnouncements(){
    if (!currentUser || !accessGranted) return;
    try {
      const snap = await db().collection('announcements').where('active','==',true).where('scope','==','arte').limit(20).get();
      const items = [];
      snap.forEach((doc)=>items.push({ id: doc.id, ...doc.data() }));
      if(!items.length) return;
      items.sort((a,b)=>Number(b.createdAt?.seconds||0)-Number(a.createdAt?.seconds||0));
      const seen = getSeenAnnouncements();
      const unseen = items.filter(item=>!seen.includes(item.id));
      if(unseen.length) showAnnouncementPopup(unseen);
    } catch(error) { console.warn('Annunci arte non caricati', error); }
  }
  function getSeenAnnouncements(){ try { return JSON.parse(localStorage.getItem(`quizNuotoSeenAnnouncements:${currentUser?.uid}`) || '[]'); } catch { return []; } }
  function setSeenAnnouncements(ids){ localStorage.setItem(`quizNuotoSeenAnnouncements:${currentUser?.uid}`, JSON.stringify([...new Set(ids)])); }
  function showAnnouncementPopup(items){
    const modal=document.createElement('div');
    modal.className='modal';
    const main=items[0] || {};
    modal.innerHTML=`<div class="modal-card account-request-card site-dialog-card announcement-dialog-card"><div class="modal-head"><div><p class="eyebrow">Arte</p><h3>${escapeHtml(main.title || 'Annuncio')}</h3></div><button class="icon-btn" type="button" data-close-announcement aria-label="Chiudi">×</button></div><div class="announcement-popup-list">${items.map((item,index)=>`<div class="announcement-popup-item ${index===0?'featured':''}">${index===0?'':`<strong>${escapeHtml(item.title || 'Annuncio')}</strong>`}<p>${escapeHtml(item.message || '')}</p></div>`).join('')}</div><div class="site-dialog-actions"><button class="primary-btn" type="button" data-close-announcement>Ho capito</button></div></div>`;
    const close=()=>{ setSeenAnnouncements([...getSeenAnnouncements(), ...items.map(i=>i.id)]); modal.remove(); };
    modal.querySelectorAll('[data-close-announcement]').forEach(btn=>btn.addEventListener('click', close));
    document.body.appendChild(modal);
  }


  // =========================
  // Classifica Sudoku Arte
  // =========================
  function todayKey(){
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth()+1).padStart(2,'0');
    const d = String(now.getDate()).padStart(2,'0');
    return `${y}-${m}-${d}`;
  }

  function leaderboardName(){
    const profileName = String(currentProfile?.displayName || `${currentProfile?.firstName || ''} ${currentProfile?.lastName || ''}`.trim()).trim();
    return profileName || currentUser?.displayName || currentUser?.email || 'Utente';
  }

  function dailyScoreRef(day = todayKey()){
    return db().collection('leaderboards').doc('arteSudoku').collection('daily').doc(day).collection('scores').doc(currentUser.uid);
  }

  function allTimeScoreRef(){
    return db().collection('leaderboards').doc('arteSudoku').collection('allTime').doc('global').collection('scores').doc(currentUser.uid);
  }

  async function maybeStoreBestScore(ref, payload){
    const snap = await ref.get();
    const old = snap.exists ? (snap.data() || {}) : null;
    const oldScore = Number(old?.score || 0);
    const oldCompleted = Number(old?.completed || 0);
    const oldCorrect = Number(old?.correct || 0);
    const better = !old || payload.score > oldScore || (payload.score === oldScore && payload.completed > oldCompleted) || (payload.score === oldScore && payload.completed === oldCompleted && payload.correct > oldCorrect);
    if (!better) return false;
    await ref.set(payload, { merge: true });
    return true;
  }

  async function submitSudokuLeaderboard(game, won){
    if (!currentUser || !game) return;
    const totalEmpty = game.cells.filter((cell)=>!cell.given).length;
    const completed = game.cells.filter((cell)=>cell.filled && !cell.given).length;
    const payload = {
      uid: currentUser.uid,
      displayName: leaderboardName(),
      email: currentUser.email || currentProfile?.email || '',
      course: 'arte',
      game: 'sudoku-opere',
      mode: game.mode,
      modeLabel: game.mode === 'misto' ? 'Misto' : SUDOKU_FIELDS[game.mode]?.label || game.mode,
      score: Number(game.score || 0),
      won: Boolean(won),
      completed,
      total: totalEmpty,
      correct: Number(game.correct || 0),
      wrong: Number(game.wrong || 0),
      dayKey: todayKey(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    try {
      await Promise.all([
        maybeStoreBestScore(dailyScoreRef(payload.dayKey), payload),
        maybeStoreBestScore(allTimeScoreRef(), payload)
      ]);
      await loadSudokuLeaderboards();
    } catch(error) {
      console.warn('Classifica Sudoku non aggiornata', error);
    }
  }

  async function loadSudokuLeaderboards(){
    if (!currentUser || !accessGranted || !els.leaderboardDailyList || !els.leaderboardAllTimeList) return;
    renderLeaderboardLoading();
    try {
      const [dailySnap, allTimeSnap] = await Promise.all([
        db().collection('leaderboards').doc('arteSudoku').collection('daily').doc(todayKey()).collection('scores').orderBy('score','desc').limit(10).get(),
        db().collection('leaderboards').doc('arteSudoku').collection('allTime').doc('global').collection('scores').orderBy('score','desc').limit(10).get()
      ]);
      renderLeaderboardList(els.leaderboardDailyList, docsToRows(dailySnap));
      renderLeaderboardList(els.leaderboardAllTimeList, docsToRows(allTimeSnap));
    } catch(error) {
      console.warn('Classifica Sudoku non caricata', error);
      const msg = '<p class="message">Classifica non disponibile. Controlla le Firestore rules.</p>';
      els.leaderboardDailyList.innerHTML = msg;
      els.leaderboardAllTimeList.innerHTML = msg;
    }
  }

  function renderLeaderboardLoading(){
    const msg = '<p class="message">Caricamento classifica…</p>';
    els.leaderboardDailyList.innerHTML = msg;
    els.leaderboardAllTimeList.innerHTML = msg;
  }

  function docsToRows(snap){
    const rows = [];
    snap.forEach((doc)=>rows.push({ id: doc.id, ...(doc.data() || {}) }));
    return rows;
  }

  function renderLeaderboardList(container, rows){
    if (!container) return;
    if (!rows.length) {
      container.innerHTML = '<p class="message">Nessun punteggio registrato.</p>';
      return;
    }
    container.innerHTML = rows.map((row, index)=>`
      <div class="leaderboard-row ${row.uid === currentUser?.uid ? 'current-user' : ''}">
        <div class="leaderboard-rank">${index + 1}</div>
        <div class="leaderboard-player">
          <strong>${escapeHtml(row.displayName || row.email || 'Utente')}</strong>
          <span>${escapeHtml(row.modeLabel || row.mode || 'Sudoku')} · ${Number(row.completed || 0)}/${Number(row.total || 0)} celle · ${Number(row.correct || 0)} corrette</span>
        </div>
        <div class="leaderboard-score">${Number(row.score || 0)} pt</div>
      </div>
    `).join('');
  }


  // =========================
  // Sudoku delle Opere
  // =========================
  const SUDOKU_FIELDS = {
    artista: { label: 'Autore', question: 'Chi è l’autore di quest’opera?' },
    data: { label: 'Data', question: 'A quale fascia cronologica appartiene quest’opera?' },
    luogo: { label: 'Luogo di conservazione', question: 'Qual è il luogo di conservazione?' },
    corrente: { label: 'Corrente artistica', question: 'Qual è la corrente artistica?' }
  };

  function startSudoku(mode){
    if (!accessGranted) return showToast('Corso non autorizzato.');
    if (blockedByFeature('sudoku')) return;
    const normalizedMode = ['artista','data','luogo','corrente','misto'].includes(mode) ? mode : 'corrente';
    const categories = buildSudokuCategorySet(normalizedMode);
    if (!categories) return showToast('Non ci sono dati sufficienti per questa modalità.');
    const solution = generateSudokuSolution();
    const givens = pickSudokuGivens(34);
    const cells = [];
    for (let r=0; r<9; r++) {
      for (let c=0; c<9; c++) {
        const idx = r*9+c;
        const value = solution[r][c];
        cells.push({ r, c, value, given: givens.has(idx), filled: givens.has(idx), challenge: null, tries: 0 });
      }
    }
    currentSudoku = {
      mode: normalizedMode,
      categories,
      solution,
      cells,
      lives: 3,
      score: 0,
      correct: 0,
      wrong: 0,
      startedAt: new Date().toISOString(),
      selectedIndex: null
    };
    renderSudoku();
    showView('sudokuView');
  }

  function buildSudokuCategorySet(mode){
    const fields = mode === 'misto' ? ['artista','data','luogo','corrente'] : [mode];
    const result = {};
    for (const field of fields) {
      const cats = getSudokuCategories(field);
      if (cats.length < 9) return null;
      result[field] = cats.slice(0,9);
    }
    return result;
  }

  function getSudokuCategories(field){
    if (field === 'data') {
      return [
        'Fino al 1799',
        '1800–1819',
        '1820–1839',
        '1840–1859',
        '1860–1879',
        '1880–1899',
        '1900–1909',
        '1910–1919',
        'Dal 1920 in poi'
      ];
    }
    const values = WORKS
      .filter((w)=> field !== 'luogo' || w.luogoRichiesto)
      .map((w)=> normalizeSudokuValue(field, w))
      .filter(Boolean);
    const counts = values.reduce((acc, value)=>{ acc[value] = (acc[value] || 0) + 1; return acc; }, {});
    return Object.keys(counts).sort((a,b)=> counts[b]-counts[a] || a.localeCompare(b,'it',{numeric:true}));
  }

  function normalizeSudokuValue(field, work){
    if (field === 'data') return dateBucket(work.data);
    if (field === 'luogo') return String(work.luogo || '').trim();
    if (field === 'artista') return String(work.artista || '').trim();
    if (field === 'corrente') return simplifyCorrente(work.corrente || '');
    return '';
  }

  function simplifyCorrente(value){
    const v = String(value || '').toLowerCase();
    const pairs = [
      ['futur', 'Futurismo'],
      ['cub', 'Cubismo'],
      ['impression', 'Impressionismo'],
      ['post-impression', 'Post-impressionismo'],
      ['espression', 'Espressionismo'],
      ['realismo', 'Realismo'],
      ['macchiaioli', 'Realismo'],
      ['romantic', 'Romanticismo'],
      ['sublime', 'Romanticismo'],
      ['neoclassic', 'Neoclassicismo'],
      ['art nouveau', 'Art Nouveau / Secessione'],
      ['secessione', 'Art Nouveau / Secessione'],
      ['surreal', 'Surrealismo'],
      ['astratt', 'Astrattismo'],
      ['metafis', 'Metafisica'],
      ['dada', 'Dadaismo']
    ];
    for (const [needle, label] of pairs) if (v.includes(needle)) return label;
    return String(value || '').trim();
  }

  function dateBucket(value){
    const match = String(value || '').match(/\d{4}/);
    const year = match ? Number(match[0]) : 0;
    if (!year) return '';
    if (year <= 1799) return 'Fino al 1799';
    if (year <= 1819) return '1800–1819';
    if (year <= 1839) return '1820–1839';
    if (year <= 1859) return '1840–1859';
    if (year <= 1879) return '1860–1879';
    if (year <= 1899) return '1880–1899';
    if (year <= 1909) return '1900–1909';
    if (year <= 1919) return '1910–1919';
    return 'Dal 1920 in poi';
  }

  function generateSudokuSolution(){
    const base = 3;
    const side = base * base;
    const pattern = (r,c)=>(base*(r%base)+Math.floor(r/base)+c)%side;
    const shuffleSmall = (a)=>shuffle(a);
    const rows = shuffleSmall([0,1,2]).flatMap((g)=>shuffleSmall([0,1,2]).map((r)=>g*base+r));
    const cols = shuffleSmall([0,1,2]).flatMap((g)=>shuffleSmall([0,1,2]).map((c)=>g*base+c));
    const nums = shuffleSmall([1,2,3,4,5,6,7,8,9]);
    return rows.map((r)=>cols.map((c)=>nums[pattern(r,c)]));
  }

  function pickSudokuGivens(count){
    const all = shuffle(Array.from({length:81},(_,i)=>i));
    return new Set(all.slice(0, count));
  }

  function renderSudoku(){
    if (!currentSudoku) return;
    const label = currentSudoku.mode === 'misto' ? 'Misto' : SUDOKU_FIELDS[currentSudoku.mode]?.label;
    if (els.sudokuTitle) els.sudokuTitle.textContent = `Sudoku · ${label}`;
    if (els.sudokuSubtitle) els.sudokuSubtitle.textContent = currentSudoku.mode === 'misto'
      ? 'Ogni cella può chiedere autore, data, corrente o luogo. Completa la griglia senza finire le vite.'
      : `I numeri 1–9 rappresentano le categorie di ${String(label || '').toLowerCase()}.`;
    if (els.sudokuLives) els.sudokuLives.textContent = `Vite ${currentSudoku.lives}`;
    if (els.sudokuScore) els.sudokuScore.textContent = `${currentSudoku.score} pt`;
    renderSudokuGrid();
    renderSudokuLegend();
    if (isSudokuComplete()) finishSudoku(true);
  }

  function renderSudokuGrid(){
    if (!els.sudokuGrid) return;
    els.sudokuGrid.innerHTML = currentSudoku.cells.map((cell, idx)=>{
      const classes = ['sudoku-cell'];
      if (cell.given) classes.push('given');
      if (cell.filled && !cell.given) classes.push('filled');
      if (currentSudoku.selectedIndex === idx) classes.push('selected');
      return `<button class="${classes.join(' ')}" type="button" data-sudoku-cell="${idx}" ${cell.given ? 'aria-label="Cella già compilata"' : ''}>${cell.filled ? cell.value : ''}</button>`;
    }).join('');
    els.sudokuGrid.querySelectorAll('[data-sudoku-cell]').forEach((btn)=>btn.addEventListener('click',()=>selectSudokuCell(Number(btn.dataset.sudokuCell))));
  }

  function renderSudokuLegend(){
    if (!els.sudokuLegend) return;
    if (currentSudoku.mode === 'misto') {
      els.sudokuLegend.innerHTML = '<h4>Legenda dinamica</h4><p class="message">In modalità Misto la legenda cambia in base alla domanda della cella selezionata.</p>';
      return;
    }
    const cats = currentSudoku.categories[currentSudoku.mode] || [];
    els.sudokuLegend.innerHTML = `<h4>Legenda</h4>${cats.map((cat,i)=>`<div><strong>${i+1}</strong><span>${escapeHtml(cat)}</span></div>`).join('')}`;
  }

  function selectSudokuCell(index){
    if (!currentSudoku) return;
    const cell = currentSudoku.cells[index];
    if (!cell || cell.given || cell.filled) return;
    currentSudoku.selectedIndex = index;
    if (!cell.challenge) cell.challenge = createSudokuChallenge(cell.value);
    renderSudokuGrid();
    renderSudokuChallenge(cell, index);
  }

  function createSudokuChallenge(value){
    const field = currentSudoku.mode === 'misto' ? shuffle(['artista','data','luogo','corrente'])[0] : currentSudoku.mode;
    const category = currentSudoku.categories[field][value - 1];
    const pool = WORKS.filter((work)=> normalizeSudokuValue(field, work) === category);
    const work = pool.length ? shuffle(pool)[0] : shuffle(WORKS)[0];
    return { field, category, workId: work.id };
  }

  function renderSudokuChallenge(cell, index){
    if (!els.sudokuChallenge) return;
    const challenge = cell.challenge;
    const work = WORKS_BY_ID.get(Number(challenge.workId));
    const fieldMeta = SUDOKU_FIELDS[challenge.field];
    const categories = currentSudoku.categories[challenge.field] || [];
    els.sudokuChallenge.innerHTML = `
      <p class="eyebrow">Cella ${cell.r + 1}.${cell.c + 1} · Numero nascosto ${cell.value}</p>
      <h3>${escapeHtml(fieldMeta.question)}</h3>
      <div class="sudoku-work-image-frame">
        ${work?.imageUrl ? `<img src="${escapeHtml(work.imageUrl)}" alt="Opera da riconoscere">` : '<div class="arte-image-fallback">Immagine non disponibile</div>'}
      </div>
      <p class="message">Scegli la risposta corretta. Se sbagli perdi una vita.</p>
      <div class="sudoku-options">
        ${categories.map((cat,i)=>`<button class="secondary-btn sudoku-option-btn" type="button" data-sudoku-answer="${escapeHtml(cat)}"><strong>${i+1}</strong><span>${escapeHtml(cat)}</span></button>`).join('')}
      </div>
    `;
    els.sudokuChallenge.querySelectorAll('[data-sudoku-answer]').forEach((btn)=>btn.addEventListener('click',()=>answerSudokuCell(index, btn.dataset.sudokuAnswer)));
  }

  function answerSudokuCell(index, answer){
    if (!currentSudoku) return;
    const cell = currentSudoku.cells[index];
    if (!cell || cell.filled || !cell.challenge) return;
    const correct = normalize(answer) === normalize(cell.challenge.category);
    const work = WORKS_BY_ID.get(Number(cell.challenge.workId));
    updateSudokuCourseStats(cell.challenge.field, work, correct);
    if (correct) {
      cell.filled = true;
      currentSudoku.correct += 1;
      currentSudoku.score += Math.max(40, 120 - (cell.tries * 25));
      showToast('Corretto. Cella completata.');
      if (els.sudokuChallenge) els.sudokuChallenge.innerHTML = `<p class="eyebrow">Risposta corretta</p><h3>Cella completata</h3><p class="message">Continua scegliendo un’altra cella vuota.</p>`;
      renderSudoku();
    } else {
      cell.tries += 1;
      currentSudoku.wrong += 1;
      currentSudoku.lives -= 1;
      showToast('Risposta sbagliata. Hai perso una vita.');
      renderSudoku();
      if (currentSudoku.lives <= 0) finishSudoku(false);
      else renderSudokuChallenge(cell, index);
    }
  }

  function updateSudokuCourseStats(field, work, correct){
    if (!state || !work) return;
    state.stats.totalWorks += 1;
    state.stats.totalFields += 1;
    if (correct) {
      state.stats.correctFields += 1;
      state.stats.correctWorks += 1;
      if(!state.progress.completedIds.includes(work.id)) state.progress.completedIds.push(work.id);
      state.wrongWorkIds = (state.wrongWorkIds || []).filter(id => id !== work.id);
    } else {
      state.stats.wrongFields += 1;
      state.stats.wrongWorks += 1;
      if(!state.wrongWorkIds.includes(work.id)) state.wrongWorkIds.push(work.id);
    }
    state.fieldStats[field] = state.fieldStats[field] || { answered:0, correct:0, wrong:0, hinted:0 };
    state.fieldStats[field].answered += 1;
    if (correct) state.fieldStats[field].correct += 1; else state.fieldStats[field].wrong += 1;
    saveState();
  }

  function isSudokuComplete(){
    return !!currentSudoku && currentSudoku.cells.every((cell)=>cell.filled);
  }

  function finishSudoku(won){
    if (!currentSudoku) return;
    const totalEmpty = currentSudoku.cells.filter((cell)=>!cell.given).length;
    const completed = currentSudoku.cells.filter((cell)=>cell.filled && !cell.given).length;
    state.stats.quizCount += 1;
    state.stats.history.unshift({
      date: new Date().toISOString(),
      mode: `Sudoku Arte · ${currentSudoku.mode === 'misto' ? 'Misto' : SUDOKU_FIELDS[currentSudoku.mode]?.label}`,
      total: totalEmpty,
      correctWorks: completed,
      totalFields: currentSudoku.correct + currentSudoku.wrong,
      correctFields: currentSudoku.correct,
      accuracy: (currentSudoku.correct + currentSudoku.wrong) ? Math.round((currentSudoku.correct/(currentSudoku.correct+currentSudoku.wrong))*100) : 0
    });
    state.stats.history = state.stats.history.slice(0, 30);
    saveState();
    submitSudokuLeaderboard(currentSudoku, won);
    if (els.sudokuChallenge) {
      els.sudokuChallenge.innerHTML = `
        <p class="eyebrow">${won ? 'Sudoku completato' : 'Partita terminata'}</p>
        <h3>${won ? 'Hai completato correttamente la griglia.' : 'Hai finito le vite.'}</h3>
        <div class="stats-grid compact-stats sudoku-end-stats">
          <div class="stat-card"><strong>${completed}/${totalEmpty}</strong><span>Celle completate</span></div>
          <div class="stat-card"><strong>${currentSudoku.score}</strong><span>Punti</span></div>
          <div class="stat-card"><strong>${currentSudoku.correct}</strong><span>Risposte corrette</span></div>
        </div>
        <div class="result-actions">
          <button class="primary-btn" type="button" data-new-sudoku>Nuova partita</button>
          <button class="secondary-btn" type="button" data-back-home>Torna alla home</button>
        </div>`;
      els.sudokuChallenge.querySelector('[data-new-sudoku]')?.addEventListener('click',()=>startSudoku(currentSudoku.mode));
      els.sudokuChallenge.querySelector('[data-back-home]')?.addEventListener('click',()=>{ currentSudoku=null; showView('homeView'); });
    }
    renderSudokuGrid();
    renderHome();
  }

  function showView(id){
    ['homeView','quizView','sudokuView','resultsView','statsView'].forEach((v)=>{
      els[v]?.classList.toggle('hidden', v !== id);
      els[v]?.classList.toggle('active', v === id);
    });
    if(id==='homeView') renderHome();
  }
  function updateCountdown(){
    const now = new Date(); let ms = TARGET_DATE - now;
    if(ms <= 0) { els.countdownBig && (els.countdownBig.textContent = 'Scaduto'); return; }
    const d = Math.floor(ms/86400000); ms%=86400000; const h=Math.floor(ms/3600000); ms%=3600000; const m=Math.floor(ms/60000); const s=Math.floor((ms%60000)/1000);
    if(els.countdownBig) els.countdownBig.textContent = `${d}g ${String(h).padStart(2,'0')}h ${String(m).padStart(2,'0')}m ${String(s).padStart(2,'0')}s`;
  }

  function unique(values){ return [...new Set(values.map(v=>String(v || '').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'it',{numeric:true})); }
  function shuffle(arr){ const a=arr.slice(); for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
  function signature(works){ return works.map(w=>w.id).sort((a,b)=>a-b).join('-'); }
  function normalize(v){ return String(v || '').trim().toLowerCase().replace(/[“”]/g,'"').replace(/[’]/g,"'").replace(/\s+/g,' '); }
  function formatDate(value){ try { return new Date(value).toLocaleDateString('it-IT',{day:'2-digit',month:'2-digit',year:'numeric'}); } catch { return ''; } }
  function escapeHtml(value){ return String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
  function db(){ return window.FirebaseQuiz.db; }
  async function logout(){ await window.FirebaseQuiz.auth.signOut(); location.href='index.html'; }
  function setupTheme(){ const saved=localStorage.getItem('quizNuotoTheme'); document.body.classList.toggle('dark', saved === 'dark'); if(els.themeToggle) els.themeToggle.textContent = saved === 'dark' ? '☾' : '☀︎'; }
  function toggleTheme(){ const dark=!document.body.classList.contains('dark'); document.body.classList.toggle('dark', dark); localStorage.setItem('quizNuotoTheme', dark ? 'dark' : 'light'); if(els.themeToggle) els.themeToggle.textContent = dark ? '☾' : '☀︎'; }
  function showToast(message){ if(!els.toast) return; els.toast.textContent=message; els.toast.classList.remove('hidden'); clearTimeout(showToast._t); showToast._t=setTimeout(()=>els.toast.classList.add('hidden'), 3000); }
})();
