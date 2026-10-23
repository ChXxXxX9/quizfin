(() => {
  'use strict';

  const OWNER_ADMIN_UID = 'uPsEYGwQwrXZEwt5KID6DnVt51p2';
  const QUESTIONS = Array.isArray(window.QUIZ_QUESTIONS) ? window.QUIZ_QUESTIONS : [];
  const BAGNINO_QUESTIONS = Array.isArray(window.BAGNINO_QUESTIONS) ? window.BAGNINO_QUESTIONS : [];
  const ARTE_WORKS = Array.isArray(window.ARTE_WORKS) ? window.ARTE_WORKS : [];
  const QUESTIONS_BY_COURSE = { istruttore: QUESTIONS, bagnino: BAGNINO_QUESTIONS, arte: ARTE_WORKS };
  const TOPICS_BY_COURSE = {
    istruttore: [...new Set(QUESTIONS.map((q) => q.topic))].sort((a, b) => a.localeCompare(b, 'it', { numeric: true })),
    bagnino: [...new Set(BAGNINO_QUESTIONS.map((q) => q.topic))].sort((a, b) => a.localeCompare(b, 'it', { numeric: true })),
    arte: ['Nome opera', 'Data', 'Artista', 'Corrente artistica', 'Luogo di conservazione']
  };
  const els = {};
  let currentUser = null;
  let isAdmin = false;
  let currentAdminRecord = null;
  let adminsByUid = {};
  let selectedStatsCourse = 'istruttore';
  let users = [];
  let accountRequests = [];
  let selectedUid = null;
  let courseSettings = {};
  let fadVideos = [];

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    bindElements();
    setupTheme();
    bindEvents();
    renderSimulator();
    setupAuth();
  }

  function bindElements() {
    [
      'themeToggle','logoutBtn','adminGate','gateTitle','gateText','gateStatus','loginControls','emailInput','passwordInput','loginBtn','googleBtn','adminMessage','adminMain','adminStats','courseStatsToggle','adminTabs','requestsSection','usersSection','announcementsSection','refreshRequestsBtn','accountRequestsList','refreshUsersBtn','userSearchInput','usersList','userDetail','announcementScope','announcementTitle','announcementMessage','createAnnouncementBtn','refreshAnnouncementsBtn','announcementsList','coursesSection','refreshCoursesBtn','courseSettingsList','streakSection','streakUserSelect','streakCourseSelect','streakInspectBtn','streakInspectResult','simFireIcon','simStreakValue','simDayLabel','simSummary','simMetBtn','simSkipBtn','simResetBtn','simLogBody','fadSection','promoSection','notificationsSection','fadVideoTitleInput','fadVideoMinutesInput','fadAddVideoBtn','refreshFadBtn','fadVideoList','fadVideoTotal','fadMinutesTotal','toast'
    ].forEach((id) => { els[id] = document.getElementById(id); });
  }

  function bindEvents() {
    els.themeToggle.addEventListener('click', toggleTheme);
    els.loginBtn.addEventListener('click', loginWithEmail);
    els.googleBtn.addEventListener('click', loginWithGoogle);
    els.logoutBtn.addEventListener('click', logout);
    els.refreshRequestsBtn?.addEventListener('click', loadAccountRequests);
    els.adminTabs?.addEventListener('click', switchAdminSection);
    els.courseStatsToggle?.addEventListener('click', switchStatsCourse);
    els.refreshUsersBtn.addEventListener('click', loadUsers);
    els.userSearchInput.addEventListener('input', renderUsersList);
    els.createAnnouncementBtn.addEventListener('click', createAnnouncement);
    els.refreshAnnouncementsBtn.addEventListener('click', loadAnnouncements);
    els.refreshCoursesBtn?.addEventListener('click', loadCourseSettings);
    els.streakInspectBtn?.addEventListener('click', inspectUserStreak);
    els.simMetBtn?.addEventListener('click', () => simulateDay(true));
    els.simSkipBtn?.addEventListener('click', () => simulateDay(false));
    els.simResetBtn?.addEventListener('click', resetSimulator);
    els.courseSettingsList?.addEventListener('click', handleCourseSettingsClick);
    els.fadAddVideoBtn?.addEventListener('click', addFadVideo);
    els.refreshFadBtn?.addEventListener('click', loadFadVideos);
    els.fadVideoList?.addEventListener('click', handleFadVideoListClick);
  }

  function setupAuth() {
    const fb = window.FirebaseQuiz;
    if (!fb?.configured) {
      setGate('Firebase non configurato', 'Controlla firebase-config.js.', 'Errore', true);
      return;
    }

    fb.auth.getRedirectResult?.().catch((error) => setMessage(error.message));
    fb.auth.onAuthStateChanged(async (user) => {
      currentUser = user;
      isAdmin = false;
      selectedUid = null;

      if (!user) {
        els.adminMain.classList.add('hidden');
        els.adminGate.classList.remove('hidden');
        setGate('Accesso admin', 'Accedi con account owner/admin.', 'Login', false);
        els.loginControls.classList.remove('hidden');
        return;
      }

      try {
        await ensureBootstrapAdmin(user);
        isAdmin = await checkIsAdmin(user.uid);
        currentAdminRecord = isAdmin ? await getAdminRecord(user.uid) : null;
        if (!isAdmin) {
          els.adminMain.classList.add('hidden');
          els.adminGate.classList.remove('hidden');
          setGate('Permesso negato', `L’account ${escapeHtml(user.email || user.uid)} non è admin.`, 'Negato', true);
          els.loginControls.classList.add('hidden');
          return;
        }

        els.adminGate.classList.add('hidden');
        els.adminMain.classList.remove('hidden');
        await loadAdmins();
        await Promise.all([loadAccountRequests(), loadUsers(), loadAnnouncements(), loadCourseSettings(), loadFadVideos()]);
        switchAdminSectionByName('requests');
      } catch (error) {
        setGate('Errore admin', escapeHtml(error.message), 'Errore', true);
      }
    });
  }

  async function ensureBootstrapAdmin(user) {
    if (user.uid !== OWNER_ADMIN_UID) return;
    await db().collection('admins').doc(user.uid).set({
      uid: user.uid,
      email: user.email || 'christiancaputi09@gmail.com',
      role: 'owner',
      active: true,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  }

  async function checkIsAdmin(uid) {
    const snap = await db().collection('admins').doc(uid).get();
    return Boolean(snap.exists && snap.data()?.active);
  }

  async function getAdminRecord(uid) {
    const snap = await db().collection('admins').doc(uid).get();
    return snap.exists ? { uid: snap.id, ...snap.data() } : null;
  }

  async function loadAdmins() {
    adminsByUid = {};
    const snap = await db().collection('admins').get();
    snap.forEach((doc) => { adminsByUid[doc.id] = { uid: doc.id, ...doc.data() }; });
  }

  async function loginWithEmail() {
    const email = els.emailInput.value.trim();
    const password = els.passwordInput.value;
    if (!email || !password) return setMessage('Inserisci email e password.');
    try {
      await window.FirebaseQuiz.auth.signInWithEmailAndPassword(email, password);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function loginWithGoogle() {
    try {
      await window.FirebaseQuiz.auth.signInWithPopup(window.FirebaseQuiz.googleProvider);
    } catch (error) {
      const fallbackCodes = ['auth/popup-blocked', 'auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'auth/operation-not-supported-in-this-environment'];
      if (fallbackCodes.includes(error.code)) return window.FirebaseQuiz.auth.signInWithRedirect(window.FirebaseQuiz.googleProvider);
      setMessage(error.message);
    }
  }

  async function logout() {
    await window.FirebaseQuiz.auth.signOut();
  }

  function switchStatsCourse(event) {
    const btn = event.target.closest('[data-stats-course]');
    if (!btn) return;
    selectedStatsCourse = ['istruttore','bagnino','arte'].includes(btn.dataset.statsCourse) ? btn.dataset.statsCourse : 'istruttore';
    els.courseStatsToggle?.querySelectorAll('[data-stats-course]').forEach((item) => item.classList.toggle('active', item.dataset.statsCourse === selectedStatsCourse));
    renderAdminStats();
    if (selectedUid) renderUserDetail(selectedUid);
  }

  function switchAdminSection(event) {
    const btn = event.target.closest('[data-section]');
    if (!btn) return;
    switchAdminSectionByName(btn.dataset.section);
  }

  function switchAdminSectionByName(name) {
    els.adminTabs?.querySelectorAll('[data-section]').forEach((btn) => btn.classList.toggle('active', btn.dataset.section === name));
    els.requestsSection?.classList.toggle('hidden', name !== 'requests');
    els.usersSection?.classList.toggle('hidden', name !== 'users');
    els.announcementsSection?.classList.toggle('hidden', name !== 'announcements');
    els.coursesSection?.classList.toggle('hidden', name !== 'courses');
    els.streakSection?.classList.toggle('hidden', name !== 'streak');
    els.fadSection?.classList.toggle('hidden', name !== 'fad');
    els.promoSection?.classList.toggle('hidden', name !== 'promo');
    els.notificationsSection?.classList.toggle('hidden', name !== 'notifications');
  }

  async function loadAccountRequests() {
    const snap = await db().collection('accountRequests').limit(200).get();
    accountRequests = [];
    snap.forEach((doc) => accountRequests.push({ id: doc.id, ...doc.data() }));
    accountRequests = accountRequests.filter((r) => ['pending','review'].includes(r.status || 'pending')); 
    accountRequests.sort((a, b) => Number(b.createdAt?.seconds || 0) - Number(a.createdAt?.seconds || 0));
    renderAccountRequests();
  }

  function courseLabel(course) {
    if (course === 'arte') return 'Arte · Quinto Liceo';
    if (course === 'bagnino') return 'Assistenti Bagnanti Piscina';
    if (course === 'istruttore') return 'Istruttore di Nuoto';
    return course || '';
  }

  function normalizeCourses(value) {
    if (Array.isArray(value)) return [...new Set(value.map(String).filter(Boolean))];
    if (typeof value === 'string' && value) return [value];
    return [];
  }

  function renderAccountRequests() {
    const pendingFirst = [...accountRequests].sort((a, b) => {
      const ar = (a.status === 'review') ? 1 : 0;
      const br = (b.status === 'review') ? 1 : 0;
      if (ar !== br) return br - ar;
      return Number(b.createdAt?.seconds || 0) - Number(a.createdAt?.seconds || 0);
    });
    if (!pendingFirst.length) {
      els.accountRequestsList.innerHTML = '<p class="message">Nessuna richiesta account in attesa.</p>';
      return;
    }
    els.accountRequestsList.innerHTML = pendingFirst.map((r) => {
      const requested = normalizeCourses(r.requestedCourses);
      const requestedText = requested.length ? requested.map(courseLabel).join(', ') : 'Non specificato';
      const isReview = r.status === 'review' || r.reviewRequest;
      return `
      <article class="request-card ${isReview ? 'review-request-card' : ''}" data-request-card="${escapeHtml(r.id)}">
        <div class="user-headline">
          <div>
            <h4>${escapeHtml(`${r.firstName || ''} ${r.lastName || ''}`.trim() || r.email || 'Richiesta')}</h4>
            <p class="request-meta">${escapeHtml(r.email || '')} · Corsi richiesti: <strong>${escapeHtml(requestedText)}</strong> · ${formatDateFromTs(r.createdAt)}</p>
            ${isReview ? `<p class="review-warning"><strong>Richiesta di revisione:</strong> l’utente chiede un ricontrollo dopo un rigetto. ${r.isCourseAccessRequest ? 'Se rigetti anche questa, viene bloccato solo il corso richiesto.' : 'Se rigetti anche questa, l’account viene bloccato.'}</p>` : ''}
            ${r.previousRejectNote ? `<p class="message"><strong>Motivo rigetto precedente:</strong> ${escapeHtml(r.previousRejectNote)}</p>` : ''}
            ${r.message ? `<p>${escapeHtml(r.message)}</p>` : ''}
            ${r.uid ? `<p class="message">UID: ${escapeHtml(r.uid)}</p>` : ''}
          </div>
          <div class="status-pill request-status ${isReview ? 'review' : 'pending'}">${isReview ? 'revisione' : 'pending'}</div>
        </div>
        <div class="course-approval-box">
          <label class="checkline"><input type="checkbox" data-course-approve="istruttore" ${requested.includes('istruttore') ? 'checked' : ''} /> Abilita Istruttore di Nuoto</label>
          <label class="checkline"><input type="checkbox" data-course-approve="bagnino" ${requested.includes('bagnino') ? 'checked' : ''} /> Abilita Assistenti Bagnanti Piscina</label>
          <label class="checkline"><input type="checkbox" data-course-approve="arte" ${requested.includes('arte') ? 'checked' : ''} /> Abilita Arte · Quinto Liceo</label>
        </div>
        <div class="request-actions">
          <button class="primary-btn small-btn" type="button" data-approve-request="${escapeHtml(r.id)}">Approva accessi selezionati</button>
          <button class="danger-btn small-btn" type="button" data-reject-request="${escapeHtml(r.id)}">${isReview ? 'Rigetta e blocca' : 'Rigetta'}</button>
        </div>
      </article>`;
    }).join('');
    els.accountRequestsList.querySelectorAll('[data-approve-request]').forEach((btn) => btn.addEventListener('click', () => approveAccountRequest(btn.dataset.approveRequest)));
    els.accountRequestsList.querySelectorAll('[data-reject-request]').forEach((btn) => btn.addEventListener('click', () => rejectAccountRequest(btn.dataset.rejectRequest)));
  }

  async function getIdToken() {
    if (!currentUser) throw new Error('Admin non collegato.');
    return currentUser.getIdToken(true);
  }

  // Ex funzioni Netlify: ora girano nel browser (account-actions.js) con i permessi admin delle regole Firestore
  async function callAdminFunction(name, body) {
    await getIdToken();
    if (!window.QuizAccount) throw new Error('Componente account non caricato: ricarica la pagina.');
    return window.QuizAccount.call(name, body || {});
  }

  async function approveAccountRequest(requestId) {
    const request = accountRequests.find((r) => r.id === requestId);
    if (!request) return showToast('Richiesta non trovata.');
    const card = [...els.accountRequestsList.querySelectorAll('[data-request-card]')].find((el) => el.dataset.requestCard === requestId);
    const approvedCourses = [...(card?.querySelectorAll('[data-course-approve]:checked') || [])].map((el) => el.dataset.courseApprove);
    if (!approvedCourses.length) return showToast('Seleziona almeno un corso da abilitare.');
    const requestedCourses = normalizeCourses(request.requestedCourses);
    const notApproved = requestedCourses.filter((course) => !approvedCourses.includes(course));
    const extra = notApproved.length ? `\n\nI corsi non selezionati verranno segnati come NON approvati: ${notApproved.map(courseLabel).join(', ')}.` : '';
    const confirmed = await siteConfirm({
      title: 'Conferma approvazione',
      message: `Approvare ${request.email} per: ${approvedCourses.map(courseLabel).join(', ')}?${extra}`,
      confirmText: 'Approva accessi',
      tone: 'approve'
    });
    if (!confirmed) return;
    try {
      await callAdminFunction('approve-account-request', { requestId, approvedCourses });
      showToast('Richiesta approvata. Accessi aggiornati.');
      await Promise.all([loadAccountRequests(), loadUsers()]);
    } catch (error) {
      showToast(error.message);
    }
  }

  async function rejectAccountRequest(requestId) {
    const request = accountRequests.find((r) => r.id === requestId);
    if (!request) return showToast('Richiesta non trovata.');
    const isReview = request.status === 'review' || request.reviewRequest;
    const courseOnly = Boolean(request.isCourseAccessRequest);
    const defaultReason = isReview ? (courseOnly ? 'Revisione non approvata. Corso bloccato per questo account.' : 'Revisione non approvata. Account bloccato.') : 'Richiesta non approvata';
    const note = await sitePrompt({
      title: isReview ? 'Motivo del rigetto definitivo' : 'Motivo del rigetto',
      message: isReview ? 'Scrivi il motivo. Verrà mostrato all’utente nella pagina stato/account.' : 'Scrivi il motivo. Verrà mostrato all’utente.',
      defaultValue: defaultReason,
      multiline: true,
      confirmText: isReview ? 'Rigetta definitivamente' : 'Rigetta richiesta',
      tone: 'danger'
    });
    if (note === null) return;
    if (isReview) {
      const confirmed = await siteConfirm({
        title: courseOnly ? 'Bloccare questo corso?' : 'Bloccare account?',
        message: courseOnly ? 'Questa è una revisione: se rigetti, viene bloccato solo il corso richiesto.' : 'Questa è una revisione: se rigetti, l’account viene bloccato.',
        confirmText: courseOnly ? 'Blocca corso' : 'Blocca account',
        tone: 'danger'
      });
      if (!confirmed) return;
    }
    try {
      const result = await callAdminFunction('reject-account-request', { requestId, note });
      showToast(result.courseBlocked ? 'Revisione rigettata: corso bloccato per questo account.' : result.courseOnly ? 'Richiesta corso rigettata.' : result.banned ? 'Revisione rigettata: account bloccato.' : 'Richiesta rigettata.');
      await Promise.all([loadAccountRequests(), loadUsers()]);
    } catch (error) {
      showToast(error.message);
    }
  }

  async function loadUsers() {
    const snap = await db().collection('users').limit(500).get();
    users = [];
    snap.forEach((doc) => users.push({ uid: doc.id, ...doc.data() }));
    await Promise.all(users.map(async (u) => {
      try {
        const bSnap = await db().collection('users').doc(u.uid).collection('courseData').doc('bagnino').get();
        u.courseData = u.courseData || {};
        u.courseData.bagnino = bSnap.exists ? (bSnap.data() || {}) : null;
      } catch { u.courseData = u.courseData || {}; u.courseData.bagnino = null; }
      try {
        const aSnap = await db().collection('users').doc(u.uid).collection('courseData').doc('arte').get();
        u.courseData = u.courseData || {};
        u.courseData.arte = aSnap.exists ? (aSnap.data() || {}) : null;
      } catch { u.courseData = u.courseData || {}; u.courseData.arte = null; }
    }));
    users.sort((a, b) => String(a.profile?.email || '').localeCompare(String(b.profile?.email || ''), 'it'));
    await loadAdmins();
    renderAdminStats();
    renderUsersList();
    renderStreakUserOptions();
    if (selectedUid) renderUserDetail(selectedUid);
  }

  function renderStreakUserOptions() {
    if (!els.streakUserSelect) return;
    const current = els.streakUserSelect.value;
    els.streakUserSelect.innerHTML = '<option value="">— scegli un utente approvato —</option>' +
      users.map((u) => `<option value="${escapeHtml(u.uid)}">${escapeHtml(u.profile?.email || u.uid)}</option>`).join('');
    if (current && users.some((u) => u.uid === current)) els.streakUserSelect.value = current;
  }

  async function inspectUserStreak() {
    const uid = els.streakUserSelect.value;
    const course = els.streakCourseSelect.value;
    if (!uid) { els.streakInspectResult.innerHTML = '<p class="message">Scegli prima un utente.</p>'; return; }
    els.streakInspectResult.innerHTML = '<p class="message">Lettura in corso…</p>';
    try {
      const snap = await db().collection('users').doc(uid).collection('studyGoals').doc(course).get();
      if (!snap.exists) {
        els.streakInspectResult.innerHTML = '<p class="message">Questo utente non ha ancora impostato un obiettivo per questo corso: nessuna streak da mostrare.</p>';
        return;
      }
      const g = snap.data() || {};
      const today = window.QuizStudyTracker?.test?.todayKey?.() || '';
      const live = window.QuizStudyTracker?.test?.liveStreakAt?.(g, today) ?? g.streak ?? 0;
      const missed = window.QuizStudyTracker?.test?.missedDaysAt?.(g, today) ?? 0;
      const alive = live > 0;
      els.streakInspectResult.innerHTML = `
        <div class="stats-grid compact-stats" style="margin-top:10px;">
          <div class="stat-card"><strong>${Number(g.streak || 0)}</strong><span>Streak all’ultimo giorno riuscito</span></div>
          <div class="stat-card"><strong>${live}</strong><span>Streak reale oggi ${alive ? '(accesa)' : '(spenta)'}</span></div>
          <div class="stat-card"><strong>${missed}</strong><span>Giorni saltati da allora (−1 ciascuno)</span></div>
          <div class="stat-card"><strong>${Number(g.bestStreak || 0)}</strong><span>Record</span></div>
          <div class="stat-card"><strong>${Number(g.totalGoalDays || 0)}</strong><span>Giorni obiettivo totali</span></div>
        </div>
        <p class="request-meta" style="margin-top:10px;">Ultimo giorno riuscito: <strong>${escapeHtml(g.lastMetDate || '—')}</strong> · Obiettivo giornaliero: ${Number(g.dailyTarget || 0)} ${escapeHtml(g.unit || '')} · Oggi (${escapeHtml(today)}): ${Number(g.dailyCounts?.[today] || 0)} fatte.</p>
        ${missed > 0 ? `<p class="review-warning">Dall’ultimo giorno riuscito sono passati ${missed} ${missed === 1 ? 'giorno saltato' : 'giorni saltati'}: sul sito e in classifica la streak vale ${live} (${Number(g.streak || 0)} − ${missed}).</p>` : ''}
      `;
    } catch (error) {
      els.streakInspectResult.innerHTML = `<p class="message">Lettura non riuscita: ${escapeHtml(error.message)}</p>`;
    }
  }

  // ---- Simulatore streak: usa la stessa funzione pura del sito (QuizStudyTracker.test),
  // nessun account reale coinvolto. Un "giorno" qui e solo un contatore locale, non una data vera.
  let simDay = 0;
  let simState = { streak: 0, bestStreak: 0, totalGoalDays: 0, lastMetDate: null };
  let simLog = [];

  function simDateKey(dayNumber) {
    // Chiave di data valida (YYYY-MM-DD) generata con la stessa funzione offsetKey del sito,
    // partendo da un giorno fisso: cosi "ieri rispetto al giorno simulato" si calcola
    // esattamente come nella logica vera, senza dipendere dalla data reale del dispositivo.
    return window.QuizStudyTracker.test.offsetKey('2025-01-01', dayNumber);
  }

  // Valore mostrato dopo il giorno simulato = streak reale all'inizio del giorno dopo
  function simShownStreak() {
    const test = window.QuizStudyTracker?.test;
    if (!test || !simDay) return 0;
    return test.liveStreakAt(simState, simDateKey(simDay + 1));
  }

  function renderSimulator() {
    if (!els.simStreakValue) return;
    const shown = simShownStreak();
    els.simStreakValue.textContent = String(shown);
    els.simFireIcon.dataset.level = String(Math.min(10, shown));
    els.simDayLabel.textContent = `Giorno simulato: ${simDay}`;
    els.simSummary.textContent = `Record: ${simState.bestStreak} · Giorni totali riusciti: ${simState.totalGoalDays} · Ultimo giorno riuscito: ${simState.lastMetDate || '—'}`;
    els.simLogBody.innerHTML = simLog.slice().reverse().map((row) => `
      <tr>
        <td>${row.day}</td>
        <td>${row.met ? '✅ Raggiunto' : '⏭ Saltato'}</td>
        <td>${row.streak}</td>
        <td>${row.bestStreak}</td>
        <td>${row.note}</td>
      </tr>`).join('') || '<tr><td colspan="5" class="message">Nessun giorno simulato ancora.</td></tr>';
  }

  function simulateDay(met) {
    const test = window.QuizStudyTracker?.test;
    if (!test) { showToast('Simulatore non disponibile su questa pagina.'); return; }
    const before = simShownStreak();
    simDay += 1;
    const key = simDateKey(simDay);
    simState = test.nextStreakState(simState, key, met);
    const after = test.liveStreakAt(simState, simDateKey(simDay + 1));
    let note = '';
    if (met) note = before === 0 ? 'Fuoco acceso: +1.' : 'Obiettivo raggiunto: +1.';
    else note = before > 0 ? 'Giorno saltato: −1.' : 'Giorno saltato (streak già a zero).';
    simLog.push({ day: simDay, met, streak: after, bestStreak: simState.bestStreak, note });
    renderSimulator();
  }

  function resetSimulator() {
    simDay = 0;
    simState = { streak: 0, bestStreak: 0, totalGoalDays: 0, lastMetDate: null };
    simLog = [];
    renderSimulator();
  }

  function getCourseStatsUser(u, course = selectedStatsCourse) {
    if (course === 'bagnino') return u.courseData?.bagnino || {};
    if (course === 'arte') return getArteLocalStats(u);
    return u || {};
  }

  function getArteLocalStats(u) {
    const a = u.courseData?.arte || {};
    const st = a.stats || {};
    return {
      stats: {
        totalAnswered: st.totalWorks || 0,
        correct: st.correctWorks || 0,
        wrong: st.wrongWorks || 0,
        quizCount: st.quizCount || 0,
        averageScore: st.totalFields ? ((Number(st.correctFields || 0) / Number(st.totalFields || 1)) * 10) : 0,
        history: Array.isArray(st.history) ? st.history.map((h) => ({ mode: h.mode, date: h.date, correct: h.correctWorks || h.correctFields || 0, total: h.total || h.totalFields || 0, wrong: Math.max(0, (h.total || 0) - (h.correctWorks || 0)), vote: h.accuracy ? h.accuracy / 10 : 0 })) : []
      },
      byTopic: {
        'Nome opera': convertField(a.fieldStats?.opera),
        'Data': convertField(a.fieldStats?.data),
        'Artista': convertField(a.fieldStats?.artista),
        'Corrente artistica': convertField(a.fieldStats?.corrente),
        'Luogo di conservazione': convertField(a.fieldStats?.luogo)
      }
    };
  }
  function convertField(f = {}) { return { answered: f.answered || 0, correct: f.correct || 0, wrong: f.wrong || 0 }; }

  function renderAdminStats() {
    const course = selectedStatsCourse;
    const label = course === 'arte' ? 'Arte' : course === 'bagnino' ? 'Bagnino' : 'Istruttore';
    const totals = users.reduce((acc, u) => {
      const cu = getCourseStatsUser(u, course);
      acc.answered += Number(cu.stats?.totalAnswered || 0);
      acc.correct += Number(cu.stats?.correct || 0);
      acc.wrong += Number(cu.stats?.wrong || 0);
      acc.quiz += Number(cu.stats?.quizCount || 0);
      if (u.access?.banned) acc.banned += 1;
      if (u.access?.appVerified || u.profile?.emailVerified) acc.verified += 1;
      if (u.access?.courseAccess?.istruttore === true || (u.access?.appVerified && Object.keys(u.access?.courseAccess || {}).length === 0)) acc.istruttore += 1;
      if (u.access?.courseAccess?.bagnino) acc.bagnino += 1;
      if (u.access?.courseAccess?.arte) acc.arte += 1;
      return acc;
    }, { answered: 0, correct: 0, wrong: 0, quiz: 0, banned: 0, verified: 0, istruttore: 0, bagnino: 0, arte: 0 });
    const accuracy = totals.answered ? Math.round((totals.correct / totals.answered) * 100) : 0;
    els.adminStats.innerHTML = `
      <div class="hero-stat"><strong>${label}</strong><span>Corso selezionato</span></div>
      <div class="hero-stat"><strong>${users.length}</strong><span>Utenti</span></div>
      <div class="hero-stat"><strong>${accountRequests.length}</strong><span>Richieste/revisioni</span></div>
      <div class="hero-stat"><strong>${totals.quiz}</strong><span>Quiz completati</span></div>
      <div class="hero-stat"><strong>${totals.answered}</strong><span>Domande svolte</span></div>
      <div class="hero-stat"><strong>${accuracy}%</strong><span>Precisione media ${label}</span></div>
      <div class="hero-stat"><strong>${totals.istruttore}</strong><span>Accesso Istruttore</span></div>
      <div class="hero-stat"><strong>${totals.bagnino}</strong><span>Accesso Bagnino</span></div>
      <div class="hero-stat"><strong>${totals.arte}</strong><span>Accesso Arte</span></div>
      <div class="hero-stat"><strong>${totals.banned}</strong><span>Bloccati</span></div>
    `;
  }

  function renderUsersList() {
    const query = els.userSearchInput.value.trim().toLowerCase();
    const filtered = users.filter((u) => {
      const email = String(u.profile?.email || '').toLowerCase();
      return !query || email.includes(query) || u.uid.toLowerCase().includes(query);
    });
    if (!filtered.length) {
      els.usersList.innerHTML = '<p class="message">Nessun utente trovato.</p>';
      return;
    }
    els.usersList.innerHTML = filtered.map((u) => {
      const email = u.profile?.email || 'Email non salvata';
      const a = u.access || {};
      const hasCourses = Object.values(a.courseAccess || {}).some((v) => v === true);
      const status = a.banned ? 'Bloccato'
        : (!a.appVerified && hasCourses) ? '⚠ Da sistemare'
        : (a.appVerified && a.requiresEmailVerification === true && !u.profile?.emailVerified) ? 'Verifica email'
        : a.appVerified ? 'OK'
        : a.accountStatus === 'rejected' ? 'Rifiutato'
        : 'In attesa';
      return `
        <button class="admin-user-row ${u.uid === selectedUid ? 'selected' : ''}" type="button" data-uid="${escapeHtml(u.uid)}">
          <span><strong>${escapeHtml(email)}</strong><small>${escapeHtml(u.uid)}</small></span>
          <em>${escapeHtml(status)}</em>
        </button>
      `;
    }).join('');
    els.usersList.querySelectorAll('[data-uid]').forEach((btn) => btn.addEventListener('click', () => renderUserDetail(btn.dataset.uid)));
  }

  function renderUserDetail(uid) {
    selectedUid = uid;
    const u = users.find((item) => item.uid === uid);
    renderUsersList();
    if (!u) {
      els.userDetail.innerHTML = '<p class="message">Utente non trovato.</p>';
      return;
    }
    const course = selectedStatsCourse;
    const courseLabelText = course === 'arte' ? 'Arte · Quinto Liceo' : course === 'bagnino' ? 'Assistenti Bagnanti Piscina' : 'Istruttore di Nuoto';
    const cu = getCourseStatsUser(u, course);
    const s = cu.stats || {};
    const byTopic = cu.byTopic || {};
    const topics = TOPICS_BY_COURSE[course] || [];
    const accuracy = s.totalAnswered ? Math.round((Number(s.correct || 0) / Number(s.totalAnswered || 0)) * 100) : 0;
    const topicRows = topics.map((topic) => {
      const ts = byTopic?.[topic] || { answered: 0, correct: 0, wrong: 0 };
      const acc = ts.answered ? Math.round((ts.correct / ts.answered) * 100) : 0;
      return `<tr><td>${escapeHtml(topic)}</td><td>${ts.answered || 0}</td><td>${ts.correct || 0}</td><td>${ts.wrong || 0}</td><td>${acc}%</td></tr>`;
    }).join('');
    const lastHistory = Array.isArray(s.history) ? s.history.slice(0, 8) : [];
    const adminInfo = adminsByUid[u.uid];
    const canManageAdmins = currentAdminRecord?.role === 'owner' || currentUser?.uid === OWNER_ADMIN_UID;
    els.userDetail.innerHTML = `
      <div class="user-headline">
        <div>
          <h4>${escapeHtml(u.profile?.email || 'Email non salvata')}</h4>
          <p class="message">UID: ${escapeHtml(u.uid)}</p>
        </div>
        <div class="status-pill">${adminInfo?.active ? 'Admin' : (u.access?.banned ? 'Bloccato' : 'Attivo')}</div>
      </div>
      <div class="course-detail-heading"><strong>Statistiche visualizzate:</strong> ${escapeHtml(courseLabelText)}</div>
      <div class="stats-grid compact-stats">
        <div class="stat-card"><strong>${s.totalAnswered || 0}</strong><span>Domande fatte</span></div>
        <div class="stat-card"><strong>${s.correct || 0}</strong><span>Corrette</span></div>
        <div class="stat-card"><strong>${s.wrong || 0}</strong><span>Errate</span></div>
        <div class="stat-card"><strong>${formatVote(s.averageScore)}</strong><span>Voto medio</span></div>
        <div class="stat-card"><strong>${accuracy}%</strong><span>Precisione</span></div>
        <div class="stat-card"><strong>${s.quizCount || 0}</strong><span>Quiz</span></div>
      </div>
      <div class="admin-actions">
        <button id="approveUserBtn" class="primary-btn small-btn" type="button">Approva account</button>
        <button id="removeApprovalBtn" class="secondary-btn small-btn" type="button">Rimuovi approvazione generale</button>
        <button id="banUserBtn" class="danger-btn small-btn" type="button">Blocca utente</button>
        <button id="unbanUserBtn" class="secondary-btn small-btn" type="button">Sblocca utente</button>
        ${canManageAdmins ? `<button id="makeAdminBtn" class="warning-btn small-btn" type="button">${adminInfo?.active ? 'Aggiorna admin' : 'Nomina admin'}</button>` : ''}
        ${canManageAdmins && adminInfo?.active && u.uid !== OWNER_ADMIN_UID ? `<button id="removeAdminBtn" class="danger-btn small-btn" type="button">Rimuovi admin</button>` : ''}
      </div>
      ${(() => {
        const a = u.access || {};
        const corsi = Object.entries(a.courseAccess || {}).filter(([, v]) => v === true).map(([k]) => k);
        const notes = [];
        if (!a.banned && !a.appVerified && corsi.length) notes.push(`<p><strong>Stato incoerente:</strong> ha corsi abilitati (${escapeHtml(corsi.join(', '))}) ma l'account non risulta approvato, quindi non riesce a entrare in nessun corso. Premi <strong>Approva account</strong> per farlo entrare, oppure togli i corsi e salva.</p>`);
        if (a.appVerified && a.requiresEmailVerification === true && !u.profile?.emailVerified) notes.push(`<p><strong>Fermo alla verifica email:</strong> per entrare deve aprire il link che riceve per email. Se non gli arriva (guardate anche nello spam) puoi togliere questo passaggio.</p><button id="skipEmailVerificationBtn" class="secondary-btn small-btn" type="button">Togli l'obbligo di verifica email</button>`);
        return notes.length ? `<div class="admin-warning-box">${notes.join('')}</div>` : '';
      })()}
      <p class="message">Email verificata Firebase: <strong>${u.profile?.emailVerified ? 'sì' : 'no'}</strong> · Approvato admin: <strong>${u.access?.appVerified ? 'sì' : 'no'}</strong>${adminInfo?.active ? ` · Ruolo admin: <strong>${escapeHtml(adminInfo.role || 'admin')}</strong>` : ''}${u.access?.banReason ? ` · Motivo blocco: <strong>${escapeHtml(u.access.banReason)}</strong>` : ''}</p>
      <div class="course-approval-box user-course-box">
        <label class="checkline"><input id="userCourseIstruttore" type="checkbox" ${u.access?.courseAccess?.istruttore === true || (u.access?.appVerified && Object.keys(u.access?.courseAccess || {}).length === 0) ? 'checked' : ''} /> Accesso Istruttore di Nuoto</label>
        <label class="checkline"><input id="userCourseBagnino" type="checkbox" ${u.access?.courseAccess?.bagnino ? 'checked' : ''} /> Accesso Assistenti Bagnanti Piscina</label>
        <label class="checkline"><input id="userCourseArte" type="checkbox" ${u.access?.courseAccess?.arte ? 'checked' : ''} /> Accesso Arte · Quinto Liceo</label>
        <button id="saveUserCoursesBtn" class="primary-btn small-btn" type="button">Salva accessi corsi</button>
      </div>
      <div class="manual-progress-box">
        <h4>Intervento manuale · ${escapeHtml(courseLabelText)}</h4>
        <p class="message">Usalo solo per recuperi certificati: ogni intervento viene salvato nel log del corso.</p>
        <div class="manual-progress-grid">
          <label>Completamenti da aggiungere<input id="manualCompletedAmount" type="number" min="1" max="999" value="10" /></label>
          <button id="addCompletedBtn" class="primary-btn small-btn" type="button">Aggiungi completate</button>
          <button id="unlockExamBtn" class="warning-btn small-btn" type="button">Sblocca Esamone</button>
        </div>
        <div class="manual-progress-grid objective-grid">
          <label>Titolo obiettivo<input id="objectiveTitleInput" type="text" placeholder="Es. Recupero lezione" /></label>
          <label>Nota obiettivo<input id="objectiveNoteInput" type="text" placeholder="Nota visibile nello storico admin" /></label>
          <button id="addObjectiveBtn" class="secondary-btn small-btn" type="button">Aggiungi obiettivo</button>
        </div>
      </div>
      <h4>Progressi per argomento · ${escapeHtml(courseLabelText)}</h4>
      <div class="table-wrap"><table class="admin-table"><thead><tr><th>Argomento</th><th>Fatte</th><th>Corrette</th><th>Errate</th><th>%</th></tr></thead><tbody>${topicRows || '<tr><td colspan="5">Nessun progresso.</td></tr>'}</tbody></table></div>
      <h4>Ultimi quiz · ${escapeHtml(courseLabelText)}</h4>
      <div class="admin-list small-list">${lastHistory.length ? lastHistory.map((h) => `<div class="history-item"><div><strong>${escapeHtml(h.mode || 'Quiz')}</strong><span>${formatDate(h.date)} · ${h.correct || 0}/${h.total || 0} · ${h.wrong || 0} errori</span></div><div class="status-pill">${formatVote(h.vote)}/10</div></div>`).join('') : '<p class="message">Nessuno storico.</p>'}</div>
    `;
    document.getElementById('approveUserBtn').addEventListener('click', () => approveUser(uid, true));
    document.getElementById('saveUserCoursesBtn').addEventListener('click', () => saveUserCourses(uid));
    document.getElementById('addCompletedBtn')?.addEventListener('click', () => addManualCompleted(uid, selectedStatsCourse));
    document.getElementById('unlockExamBtn')?.addEventListener('click', () => unlockExamForUser(uid, selectedStatsCourse));
    document.getElementById('addObjectiveBtn')?.addEventListener('click', () => addAdminObjective(uid, selectedStatsCourse));
    document.getElementById('removeApprovalBtn').addEventListener('click', () => approveUser(uid, false));
    document.getElementById('banUserBtn').addEventListener('click', () => banUser(uid));
    document.getElementById('unbanUserBtn').addEventListener('click', () => unbanUser(uid));
    document.getElementById('makeAdminBtn')?.addEventListener('click', () => makeAdmin(uid));
    document.getElementById('removeAdminBtn')?.addEventListener('click', () => removeAdmin(uid));
    document.getElementById('skipEmailVerificationBtn')?.addEventListener('click', async () => {
      try {
        await db().collection('users').doc(uid).set({ access: { requiresEmailVerification: false, emailVerificationSkippedBy: currentUser.uid, emailVerificationSkippedAt: firebase.firestore.FieldValue.serverTimestamp() } }, { merge: true });
        showToast('Verifica email tolta: ora può entrare.');
        await loadUsers();
        renderUserDetail(uid);
      } catch (error) { showToast(`Non riuscito: ${error.message}`); }
    });
  }


  function courseDocRef(uid, course) {
    const root = db().collection('users').doc(uid);
    return course === 'istruttore' ? root : root.collection('courseData').doc(course);
  }

  function getCourseItems(course) {
    return QUESTIONS_BY_COURSE[course] || [];
  }

  function itemId(item) { return Number(item?.id); }
  function itemTopic(item) { return String(item?.topic || item?.corrente || 'Generale'); }

  async function readCourseDoc(uid, course) {
    const snap = await courseDocRef(uid, course).get();
    return snap.exists ? (snap.data() || {}) : {};
  }

  async function writeManualLog(uid, course, entry) {
    const ref = courseDocRef(uid, course);
    const current = await readCourseDoc(uid, course);
    const log = Array.isArray(current.adminManualLog) ? current.adminManualLog.slice(0, 80) : [];
    log.unshift({ ...entry, course, adminUid: currentUser.uid, date: new Date().toISOString() });
    await ref.set({ adminManualLog: log.slice(0, 100) }, { merge: true });
  }

  async function addManualCompleted(uid, course) {
    const amount = Math.max(1, Math.min(999, Number(document.getElementById('manualCompletedAmount')?.value || 0)));
    const items = getCourseItems(course);
    if (!items.length) return showToast('Nessun dato corso disponibile.');
    const current = await readCourseDoc(uid, course);
    const progress = current.progress || {};
    let added = [];
    if (course === 'arte') {
      const done = new Set((progress.completedIds || []).map(Number));
      added = items.map(itemId).filter((id) => !done.has(id)).slice(0, amount);
      const completedIds = [...new Set([...(progress.completedIds || []).map(Number), ...added])];
      await courseDocRef(uid, course).set({ progress: { ...progress, completedIds }, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
    } else {
      const done = new Set((progress.mixedCompleted || []).map(Number));
      added = items.map(itemId).filter((id) => !done.has(id)).slice(0, amount);
      const mixedCompleted = [...new Set([...(progress.mixedCompleted || []).map(Number), ...added])];
      const allAnswered = [...new Set([...(progress.allAnswered || []).map(Number), ...added])];
      const topics = { ...(progress.topics || {}) };
      const byId = new Map(items.map((item) => [itemId(item), item]));
      added.forEach((id) => {
        const topic = itemTopic(byId.get(id));
        topics[topic] = [...new Set([...(topics[topic] || []).map(Number), id])];
      });
      await courseDocRef(uid, course).set({ progress: { ...progress, mixedCompleted, allAnswered, topics }, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
    }
    await writeManualLog(uid, course, { type: 'add_completed', amount: added.length, note: `Aggiunte ${added.length} completate manualmente.` });
    showToast(`Aggiunte ${added.length} completate.`);
    await loadUsers();
  }

  async function unlockExamForUser(uid, course) {
    const confirmed = await siteConfirm({ title: 'Sbloccare Esamone?', message: `Segnare come completato il percorso ${courseLabel(course)} per sbloccare l’Esamone?`, confirmText: 'Sblocca Esamone', tone: 'approve' });
    if (!confirmed) return;
    const items = getCourseItems(course);
    const ids = items.map(itemId).filter(Boolean);
    const current = await readCourseDoc(uid, course);
    const progress = current.progress || {};
    if (course === 'arte') {
      await courseDocRef(uid, course).set({ progress: { ...progress, completedIds: ids }, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
    } else {
      const topics = { ...(progress.topics || {}) };
      items.forEach((item) => {
        const topic = itemTopic(item);
        topics[topic] = [...new Set([...(topics[topic] || []).map(Number), itemId(item)])];
      });
      await courseDocRef(uid, course).set({ progress: { ...progress, mixedCompleted: ids, allAnswered: ids, topics }, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
    }
    await writeManualLog(uid, course, { type: 'unlock_exam', amount: ids.length, note: 'Esamone sbloccato manualmente.' });
    showToast('Esamone sbloccato per questo utente.');
    await loadUsers();
  }

  async function addAdminObjective(uid, course) {
    const title = document.getElementById('objectiveTitleInput')?.value.trim();
    const note = document.getElementById('objectiveNoteInput')?.value.trim();
    if (!title) return showToast('Inserisci il titolo obiettivo.');
    const current = await readCourseDoc(uid, course);
    const objectives = Array.isArray(current.adminObjectives) ? current.adminObjectives.slice(0, 80) : [];
    objectives.unshift({ title, note: note || '', course, createdBy: currentUser.uid, createdAt: new Date().toISOString() });
    await courseDocRef(uid, course).set({ adminObjectives: objectives.slice(0, 100), updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
    await writeManualLog(uid, course, { type: 'objective', title, note: note || '' });
    showToast('Obiettivo aggiunto.');
    await loadUsers();
  }

  async function makeAdmin(uid) {
    const u = users.find((item) => item.uid === uid);
    if (!u) return showToast('Utente non trovato.');
    const role = await sitePrompt({
      title: 'Nomina admin',
      message: 'Scrivi il ruolo da assegnare: admin oppure owner.',
      defaultValue: adminsByUid[uid]?.role || 'admin',
      confirmText: 'Salva ruolo',
      tone: 'approve'
    });
    if (role === null) return;
    const safeRole = role.trim() === 'owner' ? 'owner' : 'admin';
    await db().collection('admins').doc(uid).set({
      uid,
      email: u.profile?.email || '',
      role: safeRole,
      active: true,
      appointedBy: currentUser.uid,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      createdAt: adminsByUid[uid]?.createdAt || firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    showToast('Admin nominato/aggiornato.');
    await loadAdmins();
    renderUserDetail(uid);
  }

  async function removeAdmin(uid) {
    if (uid === OWNER_ADMIN_UID) return showToast('Non puoi rimuovere l’owner principale.');
    const confirmed = await siteConfirm({ title: 'Rimuovere admin?', message: 'Rimuovere i permessi admin da questo utente?', confirmText: 'Rimuovi admin', tone: 'danger' });
    if (!confirmed) return;
    await db().collection('admins').doc(uid).set({ active: false, removedBy: currentUser.uid, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
    showToast('Permessi admin rimossi.');
    await loadAdmins();
    renderUserDetail(uid);
  }

  async function saveUserCourses(uid) {
    const istruttore = Boolean(document.getElementById('userCourseIstruttore')?.checked);
    const bagnino = Boolean(document.getElementById('userCourseBagnino')?.checked);
    const arte = Boolean(document.getElementById('userCourseArte')?.checked);
    await db().collection('users').doc(uid).set({
      access: {
        appVerified: istruttore || bagnino || arte,
        accountStatus: (istruttore || bagnino || arte) ? 'approved' : 'pending',
        courseAccess: { istruttore, bagnino, arte },
        pendingCourses: firebase.firestore.FieldValue.delete(),
        courseAccessUpdatedBy: currentUser.uid,
        courseAccessUpdatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }
    }, { merge: true });
    showToast('Accessi corsi aggiornati.');
    await loadUsers();
  }

  async function approveUser(uid, value) {
    const del = firebase.firestore.FieldValue.delete();
    // Stato sempre coerente: approvato = può entrare nei corsi abilitati; tolta l'approvazione = in attesa
    await db().collection('users').doc(uid).set({
      access: value ? {
        appVerified: true,
        banned: false,
        accountStatus: 'approved',
        reviewPending: false,
        canRequestReview: del,
        verifiedBy: currentUser.uid,
        verifiedAt: firebase.firestore.FieldValue.serverTimestamp()
      } : {
        appVerified: false,
        accountStatus: 'pending',
        verifiedBy: del,
        verifiedAt: del
      }
    }, { merge: true });
    showToast(value ? 'Utente approvato.' : 'Approvazione rimossa.');
    await loadUsers();
  }

  async function banUser(uid) {
    const reason = await sitePrompt({ title: 'Motivo del blocco', message: 'Scrivi il motivo del blocco account.', defaultValue: 'Account bloccato da admin', multiline: true, confirmText: 'Blocca utente', tone: 'danger' });
    if (reason === null) return;
    await db().collection('users').doc(uid).set({
      access: {
        banned: true,
        banReason: reason,
        bannedBy: currentUser.uid,
        bannedAt: firebase.firestore.FieldValue.serverTimestamp()
      }
    }, { merge: true });
    showToast('Utente bloccato.');
    await loadUsers();
  }

  async function unbanUser(uid) {
    // Chi aveva già dei corsi abilitati torna a entrarci subito; gli altri devono fare una richiesta
    const u = users.find((item) => item.uid === uid);
    const hasCourses = Object.values(u?.access?.courseAccess || {}).some((v) => v === true);
    await db().collection('users').doc(uid).set({
      access: {
        banned: false,
        appVerified: hasCourses,
        accountStatus: hasCourses ? 'approved' : 'unblocked',
        rejectedCount: 0,
        canRequestReview: false,
        banReason: firebase.firestore.FieldValue.delete(),
        bannedBy: firebase.firestore.FieldValue.delete(),
        bannedAt: firebase.firestore.FieldValue.delete()
      }
    }, { merge: true });
    showToast('Utente sbloccato.');
    await loadUsers();
  }

  async function createAnnouncement() {
    const scope = els.announcementScope.value;
    const title = els.announcementTitle.value.trim();
    const message = els.announcementMessage.value.trim();
    if (!title || !message) return showToast('Titolo e messaggio sono obbligatori.');
    if (scope === 'user' && !selectedUid) return showToast('Seleziona prima un utente.');
    await db().collection('announcements').add({
      scope,
      targetUid: scope === 'user' ? selectedUid : null,
      targetCourse: (scope === 'istruttore' || scope === 'bagnino' || scope === 'arte') ? scope : null,
      title,
      message,
      active: true,
      createdBy: currentUser.uid,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    els.announcementTitle.value = '';
    els.announcementMessage.value = '';
    showToast('Annuncio pubblicato.');
    await loadAnnouncements();
  }

  // Annunci: composer ed elenco sono in announcements-admin.js
  async function loadAnnouncements() { return window.QuizAnnouncementsAdmin?.reload?.(); }


  async function deactivateAnnouncement(id) {
    await db().collection('announcements').doc(id).set({ active: false, updatedAt: firebase.firestore.FieldValue.serverTimestamp(), updatedBy: currentUser.uid }, { merge: true });
    showToast('Annuncio disattivato.');
    await loadAnnouncements();
  }

  const COURSE_ORDER = ['istruttore', 'bagnino', 'arte'];
  const FEATURE_CATALOG = {
    istruttore: [
      { key: 'mixed', label: 'Quiz misto' },
      { key: 'topic', label: 'Quiz per argomento' },
      { key: 'wrong', label: 'Quiz domande sbagliate' },
      { key: 'exam', label: 'Esame finale' },
      { key: 'marked', label: 'Domande salvate' },
      { key: 'flashcards', label: 'Flashcard' },
      { key: 'stats', label: 'Statistiche' },
      { key: 'fad', label: 'FAD (videolezioni)' }
    ],
    bagnino: [
      { key: 'mixed', label: 'Quiz misto' },
      { key: 'topic', label: 'Quiz per argomento' },
      { key: 'wrong', label: 'Quiz domande sbagliate' },
      { key: 'exam', label: 'Esame finale' },
      { key: 'marked', label: 'Domande salvate' },
      { key: 'flashcards', label: 'Flashcard' },
      { key: 'stats', label: 'Statistiche' }
    ],
    arte: [
      { key: 'mixed', label: 'Quiz misto' },
      { key: 'corrente', label: 'Quiz per corrente/argomento' },
      { key: 'wrong', label: 'Quiz domande sbagliate' },
      { key: 'exam', label: 'Esame finale' },
      { key: 'marked', label: 'Domande salvate' },
      { key: 'sudoku', label: 'Sudoku' },
      { key: 'stats', label: 'Statistiche' }
    ]
  };

  function parseScopeKey(key) {
    if (key === 'site') return { site: true };
    if (COURSE_ORDER.includes(key)) return { course: key };
    const idx = key.indexOf('.');
    if (idx > 0) {
      const course = key.slice(0, idx);
      const feature = key.slice(idx + 1);
      if (COURSE_ORDER.includes(course) && (FEATURE_CATALOG[course] || []).some((f) => f.key === feature)) {
        return { course, feature };
      }
    }
    return null;
  }

  function isValidScopeKey(key) { return parseScopeKey(key) !== null; }

  function scopeLabel(key) {
    const parsed = parseScopeKey(key);
    if (!parsed) return key;
    if (parsed.site) return 'Sito (tutti i corsi)';
    if (!parsed.feature) return courseLabel(parsed.course);
    const feat = (FEATURE_CATALOG[parsed.course] || []).find((f) => f.key === parsed.feature);
    return `${courseLabel(parsed.course)} — ${feat ? feat.label : parsed.feature}`;
  }

  async function loadCourseSettings() {
    // Mostra subito la struttura (sito + corsi) anche se la lettura Firestore dovesse fallire.
    // In questo modo l'Admin non rimane con la sola voce "Aggiorna" senza spiegazioni.
    courseSettings = {};
    renderCourseSettings();

    try {
      if (!window.FirebaseQuiz?.db) throw new Error('Firebase/Firestore non è disponibile.');
      const snap = await db().collection('courseSettings').get();
      const next = {};
      snap.forEach((doc) => { next[doc.id] = doc.data() || {}; });
      courseSettings = next;
      renderCourseSettings();
      return true;
    } catch (error) {
      renderCourseSettings();
      showToast(`Errore caricamento impostazioni corsi: ${error.message || error}`);
      console.error('loadCourseSettings:', error);
      return false;
    }
  }

  function renderCourseSettings() {
    if (!els.courseSettingsList) return;
    const siteBlock = `<div class="course-settings-block">${scopeSettingsCardHtml('site')}</div>`;
    const courseBlocks = COURSE_ORDER.map((course) => `
      <div class="course-settings-group">
        ${scopeSettingsCardHtml(course)}
        <div class="settings-group-title">Funzioni singole · ${escapeHtml(courseLabel(course))}</div>
        <div class="course-feature-list">
          ${FEATURE_CATALOG[course].map((f) => scopeSettingsCardHtml(`${course}.${f.key}`)).join('')}
        </div>
      </div>
    `).join('');
    els.courseSettingsList.innerHTML = siteBlock + courseBlocks;
  }

  function courseStateInfo(s) {
    if (s.blocked) return { tone: 'danger', short: 'Bloccato', detail: `Accesso bloccato per tutti gli utenti (staff admin escluso).${s.blockReason ? ' Motivo: ' + s.blockReason : ''}` };
    if (s.maintenance) return { tone: 'warning', short: 'Manutenzione', detail: `In manutenzione: ${s.maintenanceMessage || 'torna più tardi.'}` };
    if (s.hidden) return { tone: 'warning', short: 'Nascosto', detail: 'Nascosto/disabilitato per gli utenti. Anche l’accesso diretto è bloccato.' };
    return { tone: '', short: 'Attivo', detail: 'Attivo e visibile a tutti.' };
  }

  function scopeSettingsCardHtml(scopeKey) {
    const s = courseSettings[scopeKey] || {};
    const info = courseStateInfo(s);
    const isSite = scopeKey === 'site';
    const hideBtn = isSite ? '' : `<button class="${s.hidden ? 'danger-btn' : 'secondary-btn'} small-btn" type="button" data-scope-action="toggle-hidden" data-scope="${scopeKey}">${s.hidden ? 'Mostra' : 'Nascondi'}</button>`;
    return `
      <div class="request-card course-settings-card">
        <div class="user-headline">
          <strong>${escapeHtml(scopeLabel(scopeKey))}</strong>
          <span class="status-pill${info.tone ? ' ' + info.tone : ''}">${escapeHtml(info.short)}</span>
        </div>
        <p class="request-meta">${escapeHtml(info.detail)}</p>
        <div class="request-actions">
          ${hideBtn}
          <button class="${s.blocked ? 'danger-btn' : 'secondary-btn'} small-btn" type="button" data-scope-action="toggle-blocked" data-scope="${scopeKey}">${s.blocked ? 'Riattiva accesso' : 'Blocca accesso'}</button>
          <button class="secondary-btn small-btn" type="button" data-scope-action="block-reason" data-scope="${scopeKey}">Blocca con motivo</button>
          <button class="${s.maintenance ? 'danger-btn' : 'warning-btn'} small-btn" type="button" data-scope-action="toggle-maintenance" data-scope="${scopeKey}">${s.maintenance ? 'Disattiva manutenzione' : 'Manutenzione'}</button>
        </div>
      </div>
    `;
  }

  function handleCourseSettingsClick(event) {
    const btn = event.target.closest('[data-scope-action]');
    if (!btn) return;
    const scopeKey = btn.dataset.scope;
    const action = btn.dataset.scopeAction;
    const handlers = {
      'toggle-hidden': toggleScopeHidden,
      'toggle-blocked': toggleScopeBlocked,
      'block-reason': blockScopeWithReason,
      'toggle-maintenance': toggleScopeMaintenance
    };
    const handler = handlers[action];
    if (!handler) return;

    btn.disabled = true;
    Promise.resolve(handler(scopeKey))
      .catch((error) => {
        showToast(`Operazione non riuscita: ${error.message || error}`);
        console.error(`courseSettings ${action}:`, error);
      })
      .finally(() => { btn.disabled = false; });
  }

  async function saveCourseSettings(scopeKey, patch) {
    if (!currentUser?.uid) throw new Error("Sessione admin non disponibile. Effettua nuovamente l'accesso.");
    if (!window.FirebaseQuiz?.db) throw new Error('Firebase/Firestore non è disponibile.');
    if (!isValidScopeKey(scopeKey)) throw new Error('Ambito non valido.');

    try {
      await db().collection('courseSettings').doc(scopeKey).set({
        ...patch,
        updatedBy: currentUser.uid,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    } catch (error) {
      console.error('saveCourseSettings:', error);
      if (error?.code === 'permission-denied') {
        throw new Error('Firestore ha rifiutato la modifica. Verifica che questo account sia ancora ADMIN e che le regole Firestore aggiornate siano pubblicate.');
      }
      throw error;
    }

    courseSettings[scopeKey] = { ...(courseSettings[scopeKey] || {}), ...patch };
    renderCourseSettings();
  }

  async function toggleScopeHidden(scopeKey) {
    const next = !(courseSettings[scopeKey]?.hidden);
    await saveCourseSettings(scopeKey, { hidden: next });
    showToast(next ? `${scopeLabel(scopeKey)} nascosto/disabilitato.` : `${scopeLabel(scopeKey)} di nuovo visibile.`);
  }

  async function toggleScopeBlocked(scopeKey) {
    const current = courseSettings[scopeKey] || {};
    if (current.blocked) {
      await saveCourseSettings(scopeKey, { blocked: false, blockReason: '' });
      showToast(`Accesso a ${scopeLabel(scopeKey)} riattivato.`);
      return;
    }
    const confirmed = await siteConfirm({ title: 'Bloccare l’accesso?', message: `Nessuno (staff admin escluso) potrà più usare ${scopeLabel(scopeKey)} finché non riattivi l’accesso.`, confirmText: 'Blocca accesso', tone: 'danger' });
    if (!confirmed) return;
    await saveCourseSettings(scopeKey, { blocked: true });
    showToast(`Accesso a ${scopeLabel(scopeKey)} bloccato.`);
  }

  async function blockScopeWithReason(scopeKey) {
    const reason = await sitePrompt({ title: 'Motivo del blocco', message: `Scrivi il motivo per cui ${scopeLabel(scopeKey)} viene bloccato. Sarà mostrato agli utenti coinvolti.`, defaultValue: courseSettings[scopeKey]?.blockReason || '', multiline: true, confirmText: 'Blocca', tone: 'danger' });
    if (reason === null) return;
    await saveCourseSettings(scopeKey, { blocked: true, blockReason: reason });
    showToast(`${scopeLabel(scopeKey)} bloccato con motivo.`);
  }

  async function toggleScopeMaintenance(scopeKey) {
    const current = courseSettings[scopeKey] || {};
    if (current.maintenance) {
      await saveCourseSettings(scopeKey, { maintenance: false, maintenanceMessage: '' });
      showToast(`Manutenzione disattivata per ${scopeLabel(scopeKey)}.`);
      return;
    }
    const message = await sitePrompt({ title: 'Messaggio di manutenzione', message: `Testo mostrato agli utenti di ${scopeLabel(scopeKey)} durante la manutenzione.`, defaultValue: 'In manutenzione, torna più tardi.', multiline: true, confirmText: 'Attiva manutenzione', tone: 'danger' });
    if (message === null) return;
    await saveCourseSettings(scopeKey, { maintenance: true, maintenanceMessage: message });
    showToast(`${scopeLabel(scopeKey)} in manutenzione.`);
  }

  async function loadFadVideos() {
    if (!els.fadVideoList) return true;
    try {
      if (!window.FirebaseQuiz?.db) throw new Error('Firebase/Firestore non è disponibile.');
      const snap = await db().collection('fadVideos').orderBy('order', 'asc').get();
      const list = [];
      snap.forEach((doc) => list.push({ id: doc.id, ...doc.data() }));
      fadVideos = list;
      renderFadVideos();
      return true;
    } catch (error) {
      console.error('loadFadVideos:', error);
      showToast(`Errore caricamento catalogo FAD: ${error.message || error}`);
      renderFadVideos();
      return false;
    }
  }

  function renderFadVideos() {
    if (!els.fadVideoList) return;
    const totalMinutes = fadVideos.reduce((sum, v) => sum + (Number(v.minutes) || 0), 0);
    if (els.fadVideoTotal) els.fadVideoTotal.textContent = String(fadVideos.length);
    if (els.fadMinutesTotal) els.fadMinutesTotal.textContent = String(totalMinutes);
    if (!fadVideos.length) {
      els.fadVideoList.innerHTML = '<p class="message">Nessun video nel catalogo. Aggiungine uno dal modulo qui sopra.</p>';
      return;
    }
    els.fadVideoList.innerHTML = fadVideos.map((v, idx) => `
      <div class="history-item">
        <div>
          <strong>${escapeHtml(v.title || 'Video senza titolo')}</strong>
          <span>${Number(v.minutes) || 0} min</span>
        </div>
        <div class="request-actions">
          <button class="secondary-btn small-btn" type="button" data-fad-action="up" data-id="${escapeHtml(v.id)}" ${idx === 0 ? 'disabled' : ''}>↑</button>
          <button class="secondary-btn small-btn" type="button" data-fad-action="down" data-id="${escapeHtml(v.id)}" ${idx === fadVideos.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="danger-btn small-btn" type="button" data-fad-action="delete" data-id="${escapeHtml(v.id)}">Elimina</button>
        </div>
      </div>
    `).join('');
  }

  async function addFadVideo() {
    const title = els.fadVideoTitleInput?.value.trim() || '';
    const minutes = Number(els.fadVideoMinutesInput?.value);
    if (!title) return showToast('Scrivi il titolo del video.');
    if (!Number.isFinite(minutes) || minutes <= 0) return showToast('Inserisci una durata valida in minuti.');
    if (!currentUser?.uid) return showToast("Sessione admin non disponibile. Effettua nuovamente l'accesso.");
    try {
      const nextOrder = fadVideos.length ? Math.max(...fadVideos.map((v) => Number(v.order) || 0)) + 1 : 0;
      await db().collection('fadVideos').add({
        title,
        minutes,
        order: nextOrder,
        createdBy: currentUser.uid,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      els.fadVideoTitleInput.value = '';
      els.fadVideoMinutesInput.value = '';
      showToast('Video aggiunto al catalogo FAD.');
      await loadFadVideos();
    } catch (error) {
      console.error('addFadVideo:', error);
      showToast(`Aggiunta non riuscita: ${error.message || error}`);
    }
  }

  function handleFadVideoListClick(event) {
    const btn = event.target.closest('[data-fad-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    const action = btn.dataset.fadAction;
    btn.disabled = true;
    const run = action === 'delete' ? deleteFadVideo(id) : reorderFadVideo(id, action === 'up' ? -1 : 1);
    Promise.resolve(run)
      .catch((error) => {
        showToast(`Operazione non riuscita: ${error.message || error}`);
        console.error(`fadVideo ${action}:`, error);
      })
      .finally(() => { btn.disabled = false; });
  }

  async function deleteFadVideo(id) {
    const video = fadVideos.find((v) => v.id === id);
    const confirmed = await siteConfirm({ title: 'Eliminare il video?', message: `"${video?.title || 'Questo video'}" sarà rimosso dal catalogo FAD. Chi lo aveva già segnato come visto manterrà lo storico, ma non comparirà più nel calcolo dei minuti totali.`, confirmText: 'Elimina', tone: 'danger' });
    if (!confirmed) return;
    await db().collection('fadVideos').doc(id).delete();
    showToast('Video eliminato dal catalogo.');
    await loadFadVideos();
  }

  async function reorderFadVideo(id, direction) {
    const idx = fadVideos.findIndex((v) => v.id === id);
    const swapIdx = idx + direction;
    if (idx === -1 || swapIdx < 0 || swapIdx >= fadVideos.length) return;
    const a = fadVideos[idx];
    const b = fadVideos[swapIdx];
    const orderA = Number(a.order) || 0;
    const orderB = Number(b.order) || 0;
    const batch = db().batch();
    batch.set(db().collection('fadVideos').doc(a.id), { order: orderB, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
    batch.set(db().collection('fadVideos').doc(b.id), { order: orderA, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
    await batch.commit();
    await loadFadVideos();
  }

  function announcementScopeLabel(a) {
    if (a.scope === 'global') return 'Tutti gli utenti · portale iniziale';
    if (a.scope === 'istruttore') return 'Solo corso Istruttore di Nuoto';
    if (a.scope === 'bagnino') return 'Solo corso Assistenti Bagnanti Piscina';
    if (a.scope === 'arte') return 'Solo corso Arte · Quinto Liceo';
    if (a.scope === 'user') return `Utente: ${a.targetUid || ''}`;
    return a.scope || 'Annuncio';
  }

  function siteConfirm({ title = 'Conferma', message = '', confirmText = 'Conferma', cancelText = 'Annulla', tone = '' } = {}) {
    return new Promise((resolve) => {
      const modal = buildSiteDialog({ title, message, confirmText, cancelText, tone });
      const cleanup = (value) => { modal.remove(); resolve(value); };
      modal.querySelector('[data-site-cancel]').addEventListener('click', () => cleanup(false));
      modal.querySelector('[data-site-close]').addEventListener('click', () => cleanup(false));
      modal.querySelector('[data-site-confirm]').addEventListener('click', () => cleanup(true));
      document.body.appendChild(modal);
    });
  }

  function sitePrompt({ title = 'Scrivi un motivo', message = '', defaultValue = '', confirmText = 'Conferma', cancelText = 'Annulla', multiline = false, tone = '' } = {}) {
    return new Promise((resolve) => {
      const modal = buildSiteDialog({ title, message, confirmText, cancelText, tone, input: true, defaultValue, multiline });
      const input = modal.querySelector('[data-site-input]');
      const cleanup = (value) => { modal.remove(); resolve(value); };
      modal.querySelector('[data-site-cancel]').addEventListener('click', () => cleanup(null));
      modal.querySelector('[data-site-close]').addEventListener('click', () => cleanup(null));
      modal.querySelector('[data-site-confirm]').addEventListener('click', () => {
        const value = input.value.trim() || String(defaultValue || '').trim();
        cleanup(value || null);
      });
      document.body.appendChild(modal);
      setTimeout(() => input?.focus(), 20);
    });
  }

  function buildSiteDialog({ title, message, confirmText, cancelText, tone, input = false, defaultValue = '', multiline = false }) {
    const modal = document.createElement('div');
    modal.className = `modal site-dialog-modal ${tone ? 'site-dialog-' + tone : ''}`;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    const inputHtml = input
      ? (multiline
          ? `<textarea class="site-dialog-textarea" data-site-input rows="5">${escapeHtml(defaultValue)}</textarea>`
          : `<input class="site-dialog-input" data-site-input type="text" value="${escapeHtml(defaultValue)}" />`)
      : '';
    modal.innerHTML = `
      <div class="modal-card account-request-card site-dialog-card">
        <div class="modal-head">
          <div>
            <p class="eyebrow">Pannello admin</p>
            <h3>${escapeHtml(title)}</h3>
          </div>
          <button class="icon-btn" type="button" data-site-close aria-label="Chiudi">×</button>
        </div>
        <div class="site-dialog-message">${escapeHtml(message).replaceAll('\n', '<br>')}</div>
        ${inputHtml}
        <div class="site-dialog-actions">
          <button class="secondary-btn" type="button" data-site-cancel>${escapeHtml(cancelText)}</button>
          <button class="${tone === 'danger' ? 'danger-btn' : 'primary-btn'}" type="button" data-site-confirm>${escapeHtml(confirmText)}</button>
        </div>
      </div>`;
    return modal;
  }

  function db() { return window.FirebaseQuiz.db; }

  function setupTheme() {
    const saved = localStorage.getItem('quizNuotoTheme') || 'light';
    document.body.classList.toggle('dark', saved === 'dark');
    els.themeToggle.textContent = saved === 'dark' ? '☾' : '☀︎';
  }

  function toggleTheme() {
    const isDark = document.body.classList.toggle('dark');
    localStorage.setItem('quizNuotoTheme', isDark ? 'dark' : 'light');
    els.themeToggle.textContent = isDark ? '☾' : '☀︎';
  }

  function setGate(title, html, status, hideLogin) {
    els.gateTitle.textContent = title;
    els.gateText.innerHTML = html;
    els.gateStatus.textContent = status;
    els.loginControls.classList.toggle('hidden', Boolean(hideLogin));
  }

  function setMessage(text) { els.adminMessage.textContent = text || ''; }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.remove('hidden');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => els.toast.classList.add('hidden'), 2800);
  }

  function formatVote(value) {
    const num = Number(value || 0);
    return num.toFixed(1).replace('.0', '');
  }

  function formatDate(value) {
    try { return new Intl.DateTimeFormat('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)); }
    catch { return ''; }
  }

  function formatDateFromTs(ts) {
    if (!ts?.seconds) return '';
    return formatDate(new Date(ts.seconds * 1000).toISOString());
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }
})();
