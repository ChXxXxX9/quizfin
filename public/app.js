(() => {
  'use strict';
  const errText = (e) => (window.QuizErrors ? window.QuizErrors.text(e) : (e?.message || String(e)));

  const COURSE_ID = window.QUIZ_COURSE_ID || 'istruttore';
  const COURSE_LABEL = window.QUIZ_COURSE_LABEL || 'Istruttore di Nuoto';
  const STORAGE_KEY = COURSE_ID === 'istruttore' ? 'quizNuotoState.v2' : `quizNuotoState.${COURSE_ID}.v1`;
  const LEGACY_STORAGE_KEY = COURSE_ID === 'istruttore' ? 'quizNuotoState.v1' : `quizNuotoState.${COURSE_ID}.legacy`;
  const QUESTIONS = Array.isArray(window.QUIZ_QUESTIONS) ? window.QUIZ_QUESTIONS : [];
  const QUESTIONS_BY_ID = new Map(QUESTIONS.map((q) => [q.id, q]));
  // Le spiegazioni sono un file grande: arrivano dopo la prima schermata (loadExplanations)
  const EXPLANATIONS_GLOBAL = 'QUIZ_EXPLANATIONS';
  const EXPLANATIONS_SRC = 'explanations.js';
  let explanationsPromise = null;
  const explanationsReady = () => Boolean(window[EXPLANATIONS_GLOBAL]);
  const LETTERS = ['A', 'B', 'C', 'D'];
  const TOPICS = [...new Set(QUESTIONS.map((q) => q.topic))].sort((a, b) => a.localeCompare(b, 'it', { numeric: true }));
  const LEGACY_TOPIC_ALIASES = { 'La cultura': 'La Cultura dell’Acqua' };
  const TOTAL_QUESTIONS = QUESTIONS.length;
  // Quiz per video: sezioni della FAD con le loro domande (public/video-quiz.js)
  const VIDEO_DATA = window.QUIZ_VIDEO && Array.isArray(window.QUIZ_VIDEO.sezioni) ? window.QUIZ_VIDEO : { nota: '', sezioni: [] };
  const VIDEO_SECTIONS = VIDEO_DATA.sezioni
    .map((s) => ({ ...s, domande: (s.domande || []).filter((id) => QUESTIONS_BY_ID.has(id)) }))
    .filter((s) => s.domande.length && Array.isArray(s.video) && s.video.length);
  const VIDEO_SECTION_BY_ID = new Map(VIDEO_SECTIONS.map((s) => [s.id, s]));
  const VIDEO_SECTION_IDS = VIDEO_SECTIONS.map((s) => s.id);
  const VIDEO_QUIZ_SIZE = 20;
  // Quando nel giro restano meno di 30 domande si fanno tutte insieme: niente ultimo quiz da 1 o 5
  // domande (21 → un quiz da 21, 45 → 20 + 25). Le sezioni con meno di 30 domande hanno un quiz unico.
  const VIDEO_QUIZ_MERGE_BELOW = 30;
  const VIDEO_LEFTOVER_MIN = 10;
  const VIDEO_NOTE = VIDEO_DATA.nota || '';
  const MAX_HISTORY = 80;
  const MAX_RECENT_MIXED = 5;
  const OWNER_ADMIN_UID = 'uPsEYGwQwrXZEwt5KID6DnVt51p2';
  const APP_RELEASE = 'v19-multicorso';
  const RIPASSONE_DURATION_MS = 12 * 60 * 60 * 1000;
  const EXAMONE_TOTAL = 50;
  const EXAMONE_TIME_SECONDS = 20 * 60;
  const EXAMONE_PASS_THRESHOLD = 40;
  const CORRECTED_ANSWER_IDS_V11 = [15, 24, 122, 183, 208, 251, 255, 261, 264, 341, 388, 389, 432, 454, 456, 459, 679, 686, 783, 837, 853, 856];
  const PROGRESS_SCRUB_MIGRATION_ID = 'v14-force-remove-corrected-answer-questions';

  const els = {};
  let state = createDefaultState();
  let currentUser = null;
  let accessGranted = false;
  let currentIsAdmin = false;
  let saveTimer = null;
  // Il cloud si scrive solo dopo averlo letto in questa sessione: una pagina appena aperta
  // non può mai sovrascrivere i progressi salvati con uno stato vuoto o parziale.
  let cloudReady = false;
  let saveSeq = 0;
  let cloudRetryTimer = null;
  // Azzeramento voluto dall'utente: il database lo accetta solo con progressResetAt (vedi firestore.rules)
  let progressResetPending = 0;
  function markProgressReset() { progressResetPending = Date.now(); }
  let activeQuiz = null;
  let pendingQuiz = null;
  let lastWrongIds = [];
  let lastWrongContext = null;
  let activeFlashcard = null;
  let deferredInstallPrompt = null;
  let accountRequestGoogle = null;
  let FEATURE_SETTINGS = {};
  let fadCatalogCache = null;
  let fadProgressCache = null;

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    bindElements();
    setupTheme();
    populateTopics();
    bindEvents();
    state = loadLocalState();
    setupAuth();
    renderAll();
    // Le spiegazioni si caricano appena la pagina è libera
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1200));
    if (document.readyState === 'complete') idle(() => loadExplanations(), { timeout: 2500 });
    else window.addEventListener('load', () => idle(() => loadExplanations(), { timeout: 2500 }), { once: true });
  }

  function bindElements() {
    const ids = [
      'themeToggle', 'accountBtn', 'adminBtn', 'adminBellBtn', 'adminPendingBadge', 'installAppBtn', 'homeBtn', 'authCard', 'mainContent', 'authTitle', 'authSubtitle', 'authStatus', 'authControls', 'emailInput', 'passwordInput',
      'loginBtn', 'registerBtn', 'googleBtn', 'forgotPasswordBtn', 'resendVerificationBtn', 'logoutBtn', 'authMessage', 'homeView', 'quizView', 'flashcardView', 'markedView', 'resultsView', 'statsView', 'videoView', 'openVideoQuizBtn', 'backHomeFromVideoBtn', 'videoSectionList', 'videoQuizNote', 'videoQuizHomeText', 'quizNote',
      'heroStats', 'mixedMiniBar', 'mixedMiniText', 'topicSelect', 'topicMiniBar', 'topicMiniText', 'startMixedBtn',
      'startTopicBtn', 'startWrongMixedBtn', 'startWrongTopicBtn', 'startMarkedBtn', 'markedCountText', 'startFlashcardsBtn', 'ripassoneCard', 'startRipassoneBtn', 'ripassoneTimerText', 'examoneCard', 'startExamoneBtn', 'examoneLockText', 'examoneStatusText', 'flashStatsText', 'showStatsBtn', 'announcementsPanel',
      'exitFlashcardsBtn', 'flashcardProgressTitle', 'flashcardCounter', 'flashcardTopic', 'flashcardQuestion', 'flashcardOptions', 'flashcardFeedback', 'flashcardMarkBtn', 'flashcardExplainBtn', 'flashcardNextBtn', 'exitQuizBtn', 'quizModeLabel', 'quizProgressTitle', 'questionCounter', 'quizTimer', 'sessionProgressBar',
      'questionTopic', 'questionText', 'optionsList', 'explainBtn', 'hintBtn', 'markQuestionBtn', 'prevQuestionBtn', 'nextQuestionBtn',
      'resultTitle', 'scoreRing', 'resultSummary', 'mixedWeakPanel', 'retryMistakesBtn', 'backHomeFromResultsBtn', 'answersReview',
      'backHomeFromStatsBtn', 'backHomeFromMarkedBtn', 'markedList', 'statsGrid', 'topicProgressList', 'allQuestionsProgressList', 'scoreTrendList', 'recentErrorsList', 'badgeList', 'historyList',
      'resetMixedProgressBtn', 'resetTopicProgressBtn', 'resetAllDataBtn', 'timerModal', 'timerModeLabel', 'timerNoBtn',
      'timer10Btn', 'timer20Btn', 'timer30Btn', 'timerCustomInput', 'timerCustomBtn', 'timerCancelBtn', 'explanationModal', 'explanationTitle', 'explanationContent', 'explanationCloseBtn', 'installModal', 'installText', 'installPromptBtn', 'installCloseBtn', 'accountRequestModal', 'accountRequestCloseBtn', 'requestFirstName', 'requestLastName', 'requestEmail', 'requestPassword', 'requestPasswordConfirm', 'requestCourseIstruttore', 'requestCourseBagnino', 'requestPlanPicker', 'requestMessage', 'requestGoogleBtn', 'requestGoogleStatus', 'submitAccountRequestBtn', 'accountRequestMessage', 'termsModal', 'termsAcceptCheck', 'acceptTermsBtn', 'termsLogoutBtn', 'termsMessage', 'toast',
      'fadHomeSummary', 'openFadBtn', 'fadView', 'backHomeFromFadBtn', 'fadHeroTitle', 'fadHeroCopy', 'fadGoalBtn', 'fadStatWatched', 'fadStatTotal', 'fadStatMinutesLeft', 'fadStatPace', 'fadEmptyMessage', 'fadVideoListEl',
      'fadGoalModal', 'fadGoalModeDaily', 'fadGoalModeDeadline', 'fadGoalDailyInput', 'fadGoalDeadlineInput', 'fadGoalSaveBtn', 'fadGoalCancelBtn'
    ];
    ids.forEach((id) => { els[id] = document.getElementById(id); });
  }

  function bindEvents() {
    els.themeToggle.addEventListener('click', toggleTheme);
    els.homeBtn.addEventListener('click', () => { if (requireLogin()) showView('homeView'); });
    els.accountBtn.addEventListener('click', toggleAccountPanel);
    els.adminBtn?.addEventListener('click', () => { window.location.href = 'admin.html'; });
    els.adminBellBtn?.addEventListener('click', () => { window.location.href = 'admin.html'; });
    els.installAppBtn?.addEventListener('click', openInstallModal);
    els.startMixedBtn.addEventListener('click', () => { if (requireLogin()) startMixedQuiz(); });
    els.startTopicBtn.addEventListener('click', () => { if (requireLogin()) startTopicQuiz(els.topicSelect.value); });
    els.startWrongMixedBtn.addEventListener('click', () => { if (requireLogin()) startWrongMixedQuiz(); });
    els.startWrongTopicBtn.addEventListener('click', () => { if (requireLogin()) startWrongTopicQuiz(els.topicSelect.value); });
    els.startMarkedBtn.addEventListener('click', () => { if (requireLogin()) showMarkedQuestions(); });
    els.startFlashcardsBtn.addEventListener('click', () => { if (requireLogin()) startFlashcards(); });
    els.startRipassoneBtn?.addEventListener('click', () => { if (requireLogin()) startRipassone(); });
    els.startExamoneBtn?.addEventListener('click', () => { if (requireLogin()) startExamone(); });
    els.showStatsBtn.addEventListener('click', () => { if (!requireLogin()) return; if (blockedByFeature('stats')) return; renderStats(); showView('statsView'); });
    els.openFadBtn?.addEventListener('click', () => { if (!requireLogin()) return; if (blockedByFeature('fad')) return; openFad(); });
    els.backHomeFromFadBtn?.addEventListener('click', () => showView('homeView'));
    els.openVideoQuizBtn?.addEventListener('click', () => { if (!requireLogin()) return; if (blockedByFeature('video')) return; showView('videoView'); });
    els.backHomeFromVideoBtn?.addEventListener('click', () => showView('homeView'));
    els.videoSectionList?.addEventListener('click', (event) => {
      const start = event.target.closest('[data-video-start]');
      if (start) { if (requireLogin()) startVideoQuiz(start.dataset.videoStart); return; }
      const wrong = event.target.closest('[data-video-wrong]');
      if (wrong) { if (requireLogin()) startWrongVideoQuiz(wrong.dataset.videoWrong); }
    });
    els.fadGoalBtn?.addEventListener('click', openFadGoalModal);
    els.fadVideoListEl?.addEventListener('click', handleFadVideoToggle);
    els.fadGoalSaveBtn?.addEventListener('click', saveFadGoalFromModal);
    els.fadGoalCancelBtn?.addEventListener('click', closeFadGoalModal);
    els.exitFlashcardsBtn.addEventListener('click', exitFlashcards);
    els.flashcardNextBtn.addEventListener('click', nextFlashcard);
    els.flashcardMarkBtn.addEventListener('click', toggleMarkedCurrentFlashcard);
    els.flashcardExplainBtn?.addEventListener('click', showCurrentFlashcardExplanation);
    els.exitQuizBtn.addEventListener('click', exitQuiz);
    els.prevQuestionBtn.addEventListener('click', previousQuestion);
    els.nextQuestionBtn.addEventListener('click', nextQuestion);
    els.explainBtn.addEventListener('click', showCurrentExplanation);
    els.hintBtn.addEventListener('click', useHint);
    els.markQuestionBtn.addEventListener('click', toggleMarkedCurrentQuestion);
    els.backHomeFromResultsBtn.addEventListener('click', () => showView('homeView'));
    els.backHomeFromStatsBtn.addEventListener('click', () => showView('homeView'));
    els.backHomeFromMarkedBtn?.addEventListener('click', () => showView('homeView'));
    els.explanationCloseBtn?.addEventListener('click', closeExplanationModal);
    els.retryMistakesBtn.addEventListener('click', retryLastMistakes);
    els.topicSelect.addEventListener('change', renderHomeProgress);
    els.resetMixedProgressBtn.addEventListener('click', resetMixedProgress);
    els.resetTopicProgressBtn.addEventListener('click', () => resetTopicProgress(els.topicSelect.value));
    els.resetAllDataBtn.addEventListener('click', resetAllData);
    els.loginBtn.addEventListener('click', loginWithEmail);
    els.registerBtn.addEventListener('click', openAccountRequestModal);
    els.googleBtn.addEventListener('click', loginWithGoogle);
    els.forgotPasswordBtn.addEventListener('click', sendPasswordReset);
    els.resendVerificationBtn.addEventListener('click', resendVerificationEmail);
    els.logoutBtn.addEventListener('click', logout);
    els.accountRequestCloseBtn?.addEventListener('click', closeAccountRequestModal);
    els.submitAccountRequestBtn?.addEventListener('click', submitAccountRequest);
    els.requestGoogleBtn?.addEventListener('click', linkGoogleForAccountRequest);
    els.requestPlanPicker?.addEventListener('click', selectAccountRequestPlan);
    els.acceptTermsBtn?.addEventListener('click', acceptTerms);
    els.termsLogoutBtn?.addEventListener('click', logout);

    els.timerNoBtn.addEventListener('click', () => confirmTimer(null));
    els.timer10Btn.addEventListener('click', () => confirmTimer(10 * 60));
    els.timer20Btn.addEventListener('click', () => confirmTimer(20 * 60));
    els.timer30Btn.addEventListener('click', () => confirmTimer(30 * 60));
    els.timerCustomBtn.addEventListener('click', () => {
      const minutes = Number(els.timerCustomInput.value);
      if (!Number.isFinite(minutes) || minutes < 1) return showToast('Inserisci un numero di minuti valido.');
      confirmTimer(Math.min(240, Math.round(minutes)) * 60);
    });
    els.timerCancelBtn.addEventListener('click', closeTimerModal);
    els.installCloseBtn?.addEventListener('click', closeInstallModal);
    els.installPromptBtn?.addEventListener('click', runInstallPrompt);
    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      deferredInstallPrompt = event;
      els.installPromptBtn?.classList.remove('hidden');
    });

    els.recentErrorsList.addEventListener('click', (event) => {
      const button = event.target.closest('[data-retry-question]');
      if (!button) return;
      const id = Number(button.dataset.retryQuestion);
      const q = QUESTIONS_BY_ID.get(id);
      if (!q) return;
      startQuiz('singleReview', [q], `Ripasso domanda #${id}`, null, { timerSeconds: null, allowHints: true });
    });

    els.allQuestionsProgressList?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-remove-done]');
      if (!button) return;
      const id = Number(button.dataset.removeDone);
      removeQuestionFromDoneManually(id);
    });

    els.answersReview?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-mark-review]');
      if (!button) return;
      const id = Number(button.dataset.markReview);
      toggleMarkedQuestionById(id);
      const isMarked = state.markedQuestions.includes(id);
      button.textContent = isMarked ? '★ Segnata' : '☆ Segna';
      button.classList.toggle('is-marked', isMarked);
    });
  }

  function createDefaultState() {
    const progressTopics = {};
    const progressTopicsCycle = {};
    const wrongTopics = {};
    const byTopic = {};
    const mixedTopicErrors = {};
    TOPICS.forEach((topic) => {
      progressTopics[topic] = [];
      progressTopicsCycle[topic] = [];
      wrongTopics[topic] = [];
      byTopic[topic] = { answered: 0, correct: 0, wrong: 0 };
      mixedTopicErrors[topic] = 0;
    });

    return {
      version: 2,
      stats: {
        totalAnswered: 0,
        correct: 0,
        wrong: 0,
        quizCount: 0,
        totalScore: 0,
        averageScore: 0,
        history: []
      },
      progress: {
        mixedCompleted: [],
        topics: progressTopics,
        // "Giro" corrente di pescata senza ripetizioni: a differenza di mixedCompleted/topics
        // (il traguardo permanente che sblocca esamone e badge e non deve mai tornare indietro),
        // questi si svuotano quando finisci tutte le domande, cosi il quiz continua rimescolato
        // invece di bloccarsi chiedendo un reset manuale.
        mixedCycleSeen: [],
        topicsCycle: progressTopicsCycle,
        allAnswered: [],
        // Quiz per video: domande fatte e "giro" corrente per sezione della FAD
        videoSections: emptyVideoMap(),
        videoCycle: emptyVideoMap()
      },
      wrong: {
        mixed: [],
        topics: wrongTopics,
        videoSections: emptyVideoMap()
      },
      byTopic,
      mixedTopicErrors,
      recentMixedQuizErrors: [],
      markedQuestions: [],
      hintStats: {
        used: 0,
        correctAfterHint: 0
      },
      flashStats: {
        total: 0,
        correct: 0,
        wrong: 0
      },
      ripassone: {
        firstSeenAt: null,
        history: []
      },
      examone: {
        officialAttemptDone: false,
        officialStatus: null,
        officialCorrect: null,
        officialDate: null,
        bestCorrect: 0,
        attempts: []
      },
      system: {
        migrations: [],
        noticesSeen: []
      }
    };
  }

  function mergeState(base, incoming) {
    if (!incoming || typeof incoming !== 'object') return base;
    const merged = deepClone(base);

    merged.stats = { ...merged.stats, ...(incoming.stats || {}) };
    merged.stats.history = Array.isArray(incoming.stats?.history) ? incoming.stats.history.slice(0, MAX_HISTORY) : [];

    merged.progress.mixedCompleted = normalizeIdArray(incoming.progress?.mixedCompleted);
    merged.progress.allAnswered = normalizeIdArray(incoming.progress?.allAnswered);
    // Salvataggio gia esistente ma senza il nuovo campo "ciclo corrente": lo inizializziamo
    // uguale a mixedCompleted, cosi per chi ha gia domande fatte non cambia nulla finche
    // non arriva a fine giro (da quel momento in poi il ciclo si azzera e si ricomincia).
    merged.progress.mixedCycleSeen = incoming.progress?.mixedCycleSeen !== undefined
      ? normalizeIdArray(incoming.progress.mixedCycleSeen)
      : [...merged.progress.mixedCompleted];
    TOPICS.forEach((topic) => {
      const legacyKeys = [topic, ...Object.entries(LEGACY_TOPIC_ALIASES).filter(([, mapped]) => mapped === topic).map(([legacy]) => legacy)];
      merged.progress.topics[topic] = normalizeIdArray(flatten(legacyKeys.map((key) => incoming.progress?.topics?.[key])));
      merged.progress.topicsCycle[topic] = incoming.progress?.topicsCycle?.[topic] !== undefined
        ? normalizeIdArray(incoming.progress.topicsCycle[topic])
        : [...merged.progress.topics[topic]];
      merged.wrong.topics[topic] = normalizeIdArray(flatten(legacyKeys.map((key) => incoming.wrong?.topics?.[key])));
      merged.byTopic[topic] = legacyKeys.reduce((acc, key) => ({
        answered: acc.answered + Number(incoming.byTopic?.[key]?.answered || 0),
        correct: acc.correct + Number(incoming.byTopic?.[key]?.correct || 0),
        wrong: acc.wrong + Number(incoming.byTopic?.[key]?.wrong || 0)
      }), { answered: 0, correct: 0, wrong: 0 });
      merged.mixedTopicErrors[topic] = legacyKeys.reduce((sum, key) => sum + Number(incoming.mixedTopicErrors?.[key] || 0), 0);
    });

    merged.wrong.mixed = normalizeIdArray(incoming.wrong?.mixed);
    merged.progress.videoSections = normalizeVideoMap(incoming.progress?.videoSections);
    merged.progress.videoCycle = normalizeVideoMap(incoming.progress?.videoCycle);
    merged.wrong.videoSections = normalizeVideoMap(incoming.wrong?.videoSections);
    const inferredAnswered = [
      ...merged.progress.allAnswered,
      ...flatten(Object.values(merged.progress.videoSections)),
      ...merged.progress.mixedCompleted,
      ...flatten(TOPICS.map((topic) => merged.progress.topics[topic] || [])),
      ...normalizeIdArray(incoming.wrong?.mixed),
      ...flatten(TOPICS.map((topic) => merged.wrong.topics[topic] || []))
    ];
    merged.progress.allAnswered = normalizeIdArray(inferredAnswered);

    merged.markedQuestions = normalizeIdArray(incoming.markedQuestions);
    merged.recentMixedQuizErrors = normalizeRecentMixed(incoming.recentMixedQuizErrors);
    merged.hintStats = {
      used: Number(incoming.hintStats?.used || 0),
      correctAfterHint: Number(incoming.hintStats?.correctAfterHint || 0)
    };
    merged.flashStats = {
      total: Number(incoming.flashStats?.total || 0),
      correct: Number(incoming.flashStats?.correct || 0),
      wrong: Number(incoming.flashStats?.wrong || 0)
    };
    merged.ripassone = {
      firstSeenAt: incoming.ripassone?.firstSeenAt || null,
      history: Array.isArray(incoming.ripassone?.history) ? incoming.ripassone.history.slice(0, 20) : []
    };
    merged.examone = {
      officialAttemptDone: Boolean(incoming.examone?.officialAttemptDone),
      officialStatus: incoming.examone?.officialStatus || null,
      officialCorrect: Number.isFinite(Number(incoming.examone?.officialCorrect)) ? Number(incoming.examone.officialCorrect) : null,
      officialDate: incoming.examone?.officialDate || null,
      bestCorrect: Number(incoming.examone?.bestCorrect || 0),
      attempts: Array.isArray(incoming.examone?.attempts) ? incoming.examone.attempts.slice(0, 50) : []
    };

    merged.stats.totalAnswered = Number(merged.stats.totalAnswered || 0);
    merged.stats.correct = Number(merged.stats.correct || 0);
    merged.stats.wrong = Number(merged.stats.wrong || 0);
    merged.stats.quizCount = Number(merged.stats.quizCount || 0);
    merged.stats.totalScore = Number(merged.stats.totalScore || 0);
    merged.stats.averageScore = Number(merged.stats.averageScore || 0);
    merged.system = {
      migrations: Array.isArray(incoming.system?.migrations) ? incoming.system.migrations.map(String) : [],
      noticesSeen: Array.isArray(incoming.system?.noticesSeen) ? incoming.system.noticesSeen.map(String) : [],
      badgesAnnounced: Array.isArray(incoming.system?.badgesAnnounced) ? incoming.system.badgesAnnounced.map(String) : []
    };

    return merged;
  }

  function normalizeRecentMixed(value) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, MAX_RECENT_MIXED).map((item) => ({
      date: item.date || new Date().toISOString(),
      score: Number(item.score || 0),
      correct: Number(item.correct || 0),
      total: Number(item.total || 0),
      weakestTopic: item.weakestTopic || '',
      errors: Array.isArray(item.errors) ? item.errors.map((e) => ({
        questionId: Number(e.questionId),
        topic: String(e.topic || ''),
        selectedLetter: String(e.selectedLetter || '-'),
        correctLetter: String(e.correctLetter || '-')
      })).filter((e) => QUESTIONS_BY_ID.has(e.questionId)) : []
    }));
  }

  function flatten(value) {
    return value.flatMap((item) => Array.isArray(item) ? item : []);
  }

  // Una lista per ogni sezione video, sempre tutte presenti: con il salvataggio "merge" una lista
  // svuotata (errori corretti, azzeramento) deve arrivare vuota sul cloud, non sparire.
  function emptyVideoMap() {
    return Object.fromEntries(VIDEO_SECTION_IDS.map((id) => [id, []]));
  }
  function normalizeVideoMap(value) {
    const out = emptyVideoMap();
    if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
    VIDEO_SECTION_IDS.forEach((id) => { out[id] = normalizeIdArray(value[id]); });
    return out;
  }

  function normalizeIdArray(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map((id) => Number(id)).filter((id) => QUESTIONS_BY_ID.has(id)))];
  }

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function loadLocalState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
      return mergeState(createDefaultState(), raw ? JSON.parse(raw) : null);
    } catch (error) {
      console.warn('Stato locale non leggibile:', error);
      return createDefaultState();
    }
  }

  function persistState() {
    saveState();
  }

  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* memoria del browser piena o bloccata */ }
    if (!currentUser || !window.FirebaseQuiz?.configured) return;
    const uid = currentUser.uid;
    // Finché il cloud non è stato letto i cambi restano sul dispositivo, segnati "da sincronizzare"
    writeLocalMeta({ uid, pending: true, at: Date.now() });
    if (!cloudReady) return;
    const seq = ++saveSeq;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const resetMark = progressResetPending;
      try {
        const payload = resetMark ? { ...state, progressResetAt: firebase.firestore.FieldValue.serverTimestamp() } : state;
        await userDocRef().set(payload, { merge: true });
        if (resetMark && progressResetPending === resetMark) progressResetPending = 0;
        if (seq === saveSeq && currentUser?.uid === uid) writeLocalMeta({ uid, pending: false, at: Date.now() });
      } catch (error) {
        showAuthMessage(`Salvataggio cloud non riuscito: ${errText(error)}`);
      }
    }, 350);
  }

  /* ---- Copia sul dispositivo: di chi è e se ha cambi non ancora sul cloud ---- */
  const META_KEY = `${STORAGE_KEY}.meta`;
  function readLocalMeta() {
    try { return JSON.parse(localStorage.getItem(META_KEY) || 'null'); } catch { return null; }
  }
  function writeLocalMeta(meta) {
    try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch { /* niente */ }
  }
  // Salvataggi di versioni precedenti (senza proprietario): li consideriamo di questo account solo se
  // sul dispositivo non c'è traccia di altri account (le chiavi per utente contengono l'uid).
  function deviceOnlyUsedBy(uid) {
    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const parts = String(localStorage.key(i) || '').split(':');
        if (parts.some((part) => /^[A-Za-z0-9]{28}$/.test(part) && part !== uid)) return false;
      }
      return true;
    } catch { return false; }
  }
  function localBelongsTo(uid) {
    const meta = readLocalMeta();
    return meta ? meta.uid === uid : deviceOnlyUsedBy(uid);
  }
  function progressSize(s) {
    return (s?.progress?.allAnswered?.length || 0) + (s?.progress?.mixedCompleted?.length || 0) + (s?.markedQuestions?.length || 0) + Number(s?.stats?.quizCount || 0) + Number(s?.flashStats?.total || 0);
  }
  // Copia locale da unire al cloud: solo se è di questo account e ha cambi non arrivati sul cloud
  // (oppure è un salvataggio di una versione precedente, mai segnato come sincronizzato).
  function localStateToMerge(uid) {
    const meta = readLocalMeta();
    if (meta && (meta.uid !== uid || !meta.pending)) return null;
    if (!meta && !deviceOnlyUsedBy(uid)) return null;
    const local = loadLocalState();
    return progressSize(local) > 0 ? local : null;
  }

  function unionIds(a, b) {
    return normalizeIdArray([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]);
  }
  function unionStrings(a, b) {
    return [...new Set([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])].map(String))];
  }
  // Unisce due copie dei progressi senza perdere niente: domande fatte, sbagliate e segnate si sommano,
  // per i contatori vale la copia più avanti.
  function unionStates(cloud, local) {
    const out = deepClone(cloud);
    ['mixedCompleted', 'allAnswered', 'mixedCycleSeen'].forEach((key) => {
      out.progress[key] = unionIds(cloud.progress?.[key], local.progress?.[key]);
    });
    TOPICS.forEach((topic) => {
      out.progress.topics[topic] = unionIds(cloud.progress?.topics?.[topic], local.progress?.topics?.[topic]);
      out.progress.topicsCycle[topic] = unionIds(cloud.progress?.topicsCycle?.[topic], local.progress?.topicsCycle?.[topic]);
      out.wrong.topics[topic] = unionIds(cloud.wrong?.topics?.[topic], local.wrong?.topics?.[topic]);
      const bc = cloud.byTopic?.[topic] || { answered: 0, correct: 0, wrong: 0 };
      const bl = local.byTopic?.[topic] || { answered: 0, correct: 0, wrong: 0 };
      out.byTopic[topic] = Number(bl.answered || 0) > Number(bc.answered || 0) ? { ...bl } : { ...bc };
      out.mixedTopicErrors[topic] = Math.max(Number(cloud.mixedTopicErrors?.[topic] || 0), Number(local.mixedTopicErrors?.[topic] || 0));
    });
    out.wrong.mixed = unionIds(cloud.wrong?.mixed, local.wrong?.mixed);
    VIDEO_SECTION_IDS.forEach((id) => {
      out.progress.videoSections[id] = unionIds(cloud.progress?.videoSections?.[id], local.progress?.videoSections?.[id]);
      out.progress.videoCycle[id] = unionIds(cloud.progress?.videoCycle?.[id], local.progress?.videoCycle?.[id]);
      out.wrong.videoSections[id] = unionIds(cloud.wrong?.videoSections?.[id], local.wrong?.videoSections?.[id]);
    });
    out.markedQuestions = unionIds(cloud.markedQuestions, local.markedQuestions);

    const cs = cloud.stats || {};
    const ls = local.stats || {};
    const localAhead = Number(ls.quizCount || 0) > Number(cs.quizCount || 0)
      || (Number(ls.quizCount || 0) === Number(cs.quizCount || 0) && Number(ls.totalAnswered || 0) > Number(cs.totalAnswered || 0));
    out.stats = deepClone(localAhead ? ls : cs);
    const seen = new Set();
    out.stats.history = [...(cs.history || []), ...(ls.history || [])]
      .filter((item) => {
        const key = `${item?.date || ''}|${item?.mode || ''}|${item?.total || ''}|${item?.correct || ''}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => String(b?.date || '').localeCompare(String(a?.date || '')))
      .slice(0, MAX_HISTORY);

    if (!(out.recentMixedQuizErrors || []).length && (local.recentMixedQuizErrors || []).length) out.recentMixedQuizErrors = deepClone(local.recentMixedQuizErrors);
    if (Number(local.hintStats?.used || 0) > Number(cloud.hintStats?.used || 0)) out.hintStats = { ...local.hintStats };
    if (Number(local.flashStats?.total || 0) > Number(cloud.flashStats?.total || 0)) out.flashStats = { ...local.flashStats };
    if (local.examone && cloud.examone) {
      if (!cloud.examone.officialAttemptDone && local.examone.officialAttemptDone) out.examone = deepClone(local.examone);
      out.examone.bestCorrect = Math.max(Number(cloud.examone.bestCorrect || 0), Number(local.examone.bestCorrect || 0));
      if ((local.examone.attempts || []).length > (out.examone.attempts || []).length) out.examone.attempts = deepClone(local.examone.attempts);
    }
    if (local.ripassone && cloud.ripassone) {
      const firsts = [cloud.ripassone.firstSeenAt, local.ripassone.firstSeenAt].filter(Boolean).sort();
      out.ripassone.firstSeenAt = firsts[0] || null;
      if ((local.ripassone.history || []).length > (out.ripassone.history || []).length) out.ripassone.history = deepClone(local.ripassone.history);
    }
    if (out.system) {
      out.system.migrations = unionStrings(cloud.system?.migrations, local.system?.migrations);
      out.system.noticesSeen = unionStrings(cloud.system?.noticesSeen, local.system?.noticesSeen);
      out.system.badgesAnnounced = unionStrings(cloud.system?.badgesAnnounced, local.system?.badgesAnnounced);
    }
    return out;
  }

  function accountDocRef() {
    return window.FirebaseQuiz.db.collection('users').doc(currentUser.uid);
  }

  function userDocRef() {
    const accountRef = accountDocRef();
    return COURSE_ID === 'istruttore' ? accountRef : accountRef.collection('courseData').doc(COURSE_ID);
  }

  function setupAuth() {
    const fb = window.FirebaseQuiz;
    if (!fb?.configured) {
      lockApp('Accesso obbligatorio', 'Firebase non è configurato. Configura <strong>firebase-config.js</strong> per usare account e salvataggi cloud.', 'Bloccato');
      setAuthControls('login');
      els.loginBtn.disabled = true;
      els.registerBtn.disabled = true;
      els.googleBtn.disabled = true;
      return;
    }

    fb.auth.getRedirectResult?.().catch((error) => showAuthMessage(errText(error)));

    fb.auth.onAuthStateChanged(async (user) => {
      currentUser = user;
      cloudReady = false;
      clearTimeout(saveTimer);
      accessGranted = false;
      currentIsAdmin = false;
      els.adminBtn?.classList.add('hidden');

      if (!user) {
        document.body.classList.add('app-locked');
        els.authCard.classList.remove('hidden');
        els.accountBtn.textContent = '🔒';
        els.authTitle.textContent = 'Accesso obbligatorio';
        els.authSubtitle.textContent = 'Accedi se il tuo account è stato approvato. Per entrare devi prima inviare una richiesta account.';
        els.authStatus.textContent = 'Accesso richiesto';
        setAuthControls('login');
        state = loadLocalState();
        renderAll();
        return;
      }

      try {
        // Letture in parallelo: si entra prima nel corso
        const [adminFlag, accountSnap, courseSettingsFirst] = await Promise.all([
          ensureBootstrapAdmin(user).catch(() => {}).then(() => checkIsAdmin(user.uid)),
          accountDocRef().get(),
          fetchCourseSettings()
        ]);
        if (currentUser !== user) return;
        currentIsAdmin = adminFlag;
        if (currentIsAdmin) { els.adminBtn?.classList.remove('hidden'); els.adminBellBtn?.classList.remove('hidden'); loadAdminPendingCount(); }

        const cloudData = accountSnap.exists ? accountSnap.data() : null;
        // Il profilo (ultimo accesso, email…) si aggiorna in sottofondo: non serve aspettarlo
        ensureUserProfile(user, cloudData).catch(() => {});
        const accountData = cloudData;
        const access = accountData?.access || {};

        if (currentIsAdmin) {
          accessGranted = true;
          document.body.classList.remove('app-locked');
          els.authCard.classList.add('hidden');
          els.accountBtn.textContent = '👤';
          els.authTitle.textContent = user.email || 'Admin';
          els.authSubtitle.textContent = 'Accesso admin attivo. Nessuna verifica email richiesta.';
          els.authStatus.textContent = 'Admin';
          setAuthControls('signedIn');
          applyFeatureGatingUI();
          await loadCloudState(COURSE_ID === 'istruttore' ? accountSnap : null);
          await loadAnnouncements();
          return;
        }

        const courseSettingsSnap = courseSettingsFirst;
        const siteSnap = FEATURE_SETTINGS.site || {};
        // Manutenzione e blocchi dell'admin: schermata dedicata (gate.js), separata dallo stato dell'account
        const systemGate = (kind, scope, title, reason) => {
          lockApp(title, escapeHtml(reason || ''), kind === 'maintenance' ? 'Manutenzione' : 'Bloccato');
          setAuthControls('blocked');
          window.QuizGate?.show({ kind, scope, reason, courseLabel: COURSE_LABEL });
        };
        if (siteSnap.maintenance) { systemGate('maintenance', 'site', 'Sito in manutenzione', siteSnap.maintenanceMessage); return; }
        if (siteSnap.blocked) { systemGate('blocked', 'site', 'Sito non disponibile', siteSnap.blockReason); return; }
        if (courseSettingsSnap.maintenance) { systemGate('maintenance', 'course', 'Corso in manutenzione', courseSettingsSnap.maintenanceMessage); return; }
        if (courseSettingsSnap.blocked || courseSettingsSnap.hidden) { systemGate('blocked', 'course', 'Corso non disponibile', courseSettingsSnap.blockReason); return; }

        if (access.banned) {
          lockApp('Account bloccato', `Questo account è stato bloccato.${access.banReason ? `<br><strong>Motivo:</strong> ${escapeHtml(access.banReason)}` : ''}`, 'Bloccato');
          setAuthControls('blocked');
          return;
        }

        const emailVerified = Boolean(user.emailVerified);
        const appVerified = Boolean(access.appVerified);
        if (!appVerified) {
          const status = access.accountStatus || 'pending';
          if (status === 'rejected') {
            lockApp('Utente rifiutato', `La richiesta è stata rifiutata.${access.lastRejectNote ? `<br><strong>Motivo:</strong> ${escapeHtml(access.lastRejectNote)}` : ''}<br>Torna alla schermata corsi per richiedere il ricontrollo.`, 'Rifiutato');
          } else {
            const pending = Array.isArray(access.pendingCourses) && access.pendingCourses.length ? access.pendingCourses.join(', ') : 'corso richiesto';
            lockApp('In attesa dell’approvazione', `Account in attesa di approvazione per: <strong>${escapeHtml(pending)}</strong>.`, 'In attesa');
          }
          setAuthControls('blocked');
          return;
        }

        const mustVerifyEmail = access.requiresEmailVerification === true && access.verificationRequiredVersion === 'v24' && !emailVerified;
        if (mustVerifyEmail) {
          lockApp('Verifica la tua email', 'Account approvato dall’admin. Prima di entrare devi verificare la tua email. Premi “Reinvia verifica email” se non l’hai ricevuta, poi ricarica dopo averla verificata.', 'Email da verificare');
          setAuthControls('verify');
          return;
        }
        if (access.requiresEmailVerification === true && emailVerified) {
          // Non scriviamo qui su Firestore: il portale completa la verifica quando l’utente preme “Entra nel sito”.
          // Questo evita errori di permessi e impedisce il salto automatico della pagina stato.
        }

        if (!hasCourseAccess(access)) {
          lockApp('Area non autorizzata', `Non hai l’autorizzazione per entrare in <strong>${escapeHtml(COURSE_LABEL)}</strong>.<br>Torna alla schermata corsi e richiedi l’accesso all’admin.`, 'Bloccato');
          setAuthControls('blocked');
          return;
        }

        if (!access.termsAcceptedAt) {
          lockApp('Accettazione richiesta', 'Prima di usare il sito devi accettare termini, privacy e disclaimer.', 'Primo accesso');
          setAuthControls('blocked');
          openTermsModal();
          return;
        }

        accessGranted = true;
        document.body.classList.remove('app-locked');
        els.authCard.classList.add('hidden');
        els.accountBtn.textContent = '👤';
        els.authTitle.textContent = user.email || 'Account Google';
        els.authSubtitle.textContent = 'Account approvato. Sincronizzazione Firebase attiva.';
        els.authStatus.textContent = currentIsAdmin ? 'Admin' : 'Cloud';
        setAuthControls('signedIn');
        applyFeatureGatingUI();
        await loadCloudState(COURSE_ID === 'istruttore' ? accountSnap : null);
        await loadAnnouncements();
        updateFadHomeSummary();
      } catch (error) {
        lockApp('Errore account', escapeHtml(errText(error)), 'Errore');
        setAuthControls('blocked');
      }
    });
  }

  function hasCourseAccess(access) {
    if (currentIsAdmin) return true;
    if (access?.banned) return false;
    const courseAccess = access?.courseAccess || {};
    if (COURSE_ID === 'istruttore') return Boolean(courseAccess.istruttore === true || (access?.appVerified && Object.keys(courseAccess).length === 0));
    return Boolean(courseAccess[COURSE_ID]);
  }

  async function fetchCourseSettings() {
    try {
      const snap = await window.FirebaseQuiz.db.collection('courseSettings').get();
      const next = {};
      snap.forEach((doc) => { next[doc.id] = doc.data() || {}; });
      FEATURE_SETTINGS = next;
      return next[COURSE_ID] || {};
    } catch { FEATURE_SETTINGS = {}; return {}; }
  }

  function getFeatureState(feature) {
    return FEATURE_SETTINGS[`${COURSE_ID}.${feature}`] || {};
  }

  function blockedByFeature(feature) {
    if (currentIsAdmin) return false;
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
      topic: [els.startTopicBtn],
      wrong: [els.startWrongMixedBtn, els.startWrongTopicBtn],
      exam: [els.startExamoneBtn],
      marked: [els.startMarkedBtn],
      flashcards: [els.startFlashcardsBtn],
      stats: [els.showStatsBtn],
      fad: [els.openFadBtn],
      video: [els.openVideoQuizBtn]
    };
    Object.entries(targets).forEach(([feature, buttons]) => {
      // "Novità": lo vedono tutti, admin compreso
      buttons.forEach((btn) => window.QuizNovita?.mark(btn, getFeatureState(feature).novita === true));
      if (currentIsAdmin) return;
      const blocked = Boolean(getFeatureState(feature).blocked || getFeatureState(feature).maintenance || getFeatureState(feature).hidden);
      buttons.forEach((btn) => { if (btn && blocked) btn.disabled = true; });
    });
  }

  function lockApp(title, subtitleHtml, status) {
    accessGranted = false;
    document.body.classList.add('app-locked');
    els.authCard.classList.remove('hidden');
    els.accountBtn.textContent = '🔒';
    els.authTitle.textContent = title;
    els.authSubtitle.innerHTML = subtitleHtml;
    els.authStatus.textContent = status;
  }

  function setAuthControls(mode) {
    const show = (el, visible) => el?.classList.toggle('hidden', !visible);
    show(els.emailInput, mode === 'login');
    show(els.passwordInput, mode === 'login');
    show(els.loginBtn, mode === 'login');
    show(els.registerBtn, mode === 'login');
    show(els.googleBtn, mode === 'login');
    show(els.forgotPasswordBtn, mode === 'login');
    show(els.resendVerificationBtn, mode === 'verify');
    show(els.logoutBtn, mode === 'signedIn' || mode === 'verify' || mode === 'blocked');
    els.loginBtn.disabled = false;
    els.registerBtn.disabled = false;
    els.googleBtn.disabled = false;
    showAuthMessage('');
  }

  async function ensureBootstrapAdmin(user) {
    if (!window.FirebaseQuiz?.configured || user.uid !== OWNER_ADMIN_UID) return;
    const ref = window.FirebaseQuiz.db.collection('admins').doc(user.uid);
    await ref.set({
      uid: user.uid,
      email: user.email || 'christiancaputi09@gmail.com',
      role: 'owner',
      active: true,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  }

  async function checkIsAdmin(uid) {
    if (!window.FirebaseQuiz?.configured || !uid) return false;
    const snap = await window.FirebaseQuiz.db.collection('admins').doc(uid).get();
    return Boolean(snap.exists && snap.data()?.active);
  }

  async function ensureUserProfile(user, cloudData = null) {
    if (!window.FirebaseQuiz?.configured || !user) return;
    const profile = {
      uid: user.uid,
      email: user.email || '',
      displayName: user.displayName || '',
      photoURL: user.photoURL || '',
      providerIds: (user.providerData || []).map((p) => p.providerId).filter(Boolean),
      emailVerified: Boolean(user.emailVerified),
      lastLoginAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    const payload = { profile };
    if (!cloudData?.profile?.createdAt) payload.profile.createdAt = firebase.firestore.FieldValue.serverTimestamp();
    await accountDocRef().set(payload, { merge: true });
  }

  // Legge i progressi dal cloud. `prefetched` è la lettura del documento già fatta all'accesso (Istruttore):
  // si usa quella perché è stata presa prima di qualsiasi scrittura della pagina.
  async function loadCloudState(prefetched = null) {
    const user = currentUser;
    if (!user) return;
    cloudReady = false;
    clearTimeout(saveTimer);
    clearTimeout(cloudRetryTimer);
    try {
      let snap = prefetched && !prefetched.metadata?.hasPendingWrites ? prefetched : null;
      if (!snap) {
        snap = await userDocRef().get();
        // Con una scrittura in sospeso sullo stesso documento il database può restituire una copia
        // parziale (solo i campi appena scritti): in quel caso si rilegge dal server.
        if (snap.metadata?.hasPendingWrites) snap = await userDocRef().get({ source: 'server' });
      }
      if (currentUser !== user) return;
      const cloudState = snap.exists ? mergeState(createDefaultState(), snap.data()) : createDefaultState();
      const local = localStateToMerge(user.uid);
      const merged = local ? unionStates(cloudState, local) : cloudState;
      const recovered = Boolean(local) && progressSize(merged) > progressSize(cloudState);
      state = merged;
      cloudReady = true;
      saveState();
      renderAll();
      checkBadgeUnlocks(false);
      if (recovered) showToast('Abbiamo recuperato i progressi salvati su questo dispositivo.');
    } catch (error) {
      if (currentUser !== user) return;
      // Niente scritture sul cloud finché non si riesce a leggerlo: si studia sul dispositivo e si riprova
      showAuthMessage(`Caricamento cloud non riuscito: ${errText(error)} I progressi restano su questo dispositivo e si sincronizzano appena possibile.`);
      state = localBelongsTo(user.uid) ? loadLocalState() : createDefaultState();
      renderAll();
      const retry = () => {
        clearTimeout(cloudRetryTimer);
        window.removeEventListener('online', retry);
        if (currentUser === user && !cloudReady) loadCloudState();
      };
      window.addEventListener('online', retry);
      cloudRetryTimer = setTimeout(retry, 20000);
    }
  }


  function scrubQuestionIdsFromProgress(ids) {
    const targetSet = new Set(ids.map(Number));
    const details = {
      removedOccurrences: 0,
      removedIds: new Set(),
      buckets: []
    };

    const scrubArray = (arr, bucketLabel) => {
      if (!Array.isArray(arr)) return [];
      const before = arr.map(Number).filter((id) => QUESTIONS_BY_ID.has(id));
      const kept = [];
      before.forEach((id) => {
        if (targetSet.has(id)) {
          details.removedOccurrences += 1;
          details.removedIds.add(id);
          details.buckets.push({ id, bucket: bucketLabel });
        } else if (!kept.includes(id)) {
          kept.push(id);
        }
      });
      return kept;
    };

    state.progress = state.progress || { mixedCompleted: [], topics: {}, mixedCycleSeen: [], topicsCycle: {}, allAnswered: [] };
    state.progress.topics = state.progress.topics || {};
    state.progress.topicsCycle = state.progress.topicsCycle || {};
    state.wrong = state.wrong || { mixed: [], topics: {} };
    state.wrong.topics = state.wrong.topics || {};

    state.progress.mixedCompleted = scrubArray(state.progress.mixedCompleted, 'Quiz misto completate');
    state.progress.mixedCycleSeen = scrubArray(state.progress.mixedCycleSeen, 'Quiz misto (giro corrente)');
    state.progress.allAnswered = scrubArray(state.progress.allAnswered, 'Tutte le domande fatte');
    state.wrong.mixed = scrubArray(state.wrong.mixed, 'Errori quiz misto');

    TOPICS.forEach((topic) => {
      state.progress.topics[topic] = scrubArray(state.progress.topics?.[topic], `Quiz per argomento: ${topic}`);
      state.progress.topicsCycle[topic] = scrubArray(state.progress.topicsCycle?.[topic], `Quiz per argomento (giro corrente): ${topic}`);
      state.wrong.topics[topic] = scrubArray(state.wrong.topics?.[topic], `Errori argomento: ${topic}`);
    });

    state.progress.videoSections = normalizeVideoMap(state.progress.videoSections);
    state.progress.videoCycle = normalizeVideoMap(state.progress.videoCycle);
    state.wrong.videoSections = normalizeVideoMap(state.wrong.videoSections);
    VIDEO_SECTIONS.forEach((sec) => {
      state.progress.videoSections[sec.id] = scrubArray(state.progress.videoSections[sec.id], `Quiz per video: ${sec.titolo}`);
      state.progress.videoCycle[sec.id] = scrubArray(state.progress.videoCycle[sec.id], `Quiz per video (giro corrente): ${sec.titolo}`);
      state.wrong.videoSections[sec.id] = scrubArray(state.wrong.videoSections[sec.id], `Errori video: ${sec.titolo}`);
    });

    if (Array.isArray(state.recentMixedQuizErrors)) {
      state.recentMixedQuizErrors = state.recentMixedQuizErrors.map((quiz) => {
        const before = Array.isArray(quiz.errors) ? quiz.errors.length : 0;
        const errors = Array.isArray(quiz.errors) ? quiz.errors.filter((error) => !targetSet.has(Number(error.questionId))) : [];
        const removedHere = before - errors.length;
        if (removedHere > 0) {
          details.removedOccurrences += removedHere;
          if (Array.isArray(quiz.errors)) {
            quiz.errors.forEach((error) => {
              const qid = Number(error.questionId);
              if (targetSet.has(qid)) details.removedIds.add(qid);
            });
          }
        }
        return { ...quiz, errors };
      });
    }

    return {
      removedOccurrences: details.removedOccurrences,
      removedIds: [...details.removedIds].sort((a, b) => a - b),
      buckets: details.buckets
    };
  }

  function applyCorrectedAnswerProgressMigration() {
    state.system = state.system || { migrations: [], noticesSeen: [] };
    state.system.migrations = Array.isArray(state.system.migrations) ? state.system.migrations : [];
    state.system.noticesSeen = Array.isArray(state.system.noticesSeen) ? state.system.noticesSeen : [];

    if (state.system.migrations.includes(PROGRESS_SCRUB_MIGRATION_ID)) {
      return state.system.lastCorrectedAnswerRemoval || { alreadyDone: true, removedOccurrences: 0, removedIds: [] };
    }

    const result = scrubQuestionIdsFromProgress(CORRECTED_ANSWER_IDS_V11);
    state.system.migrations.push(PROGRESS_SCRUB_MIGRATION_ID);
    state.system.lastCorrectedAnswerRemoval = {
      migrationId: PROGRESS_SCRUB_MIGRATION_ID,
      date: new Date().toISOString(),
      removedOccurrences: result.removedOccurrences,
      removedIds: result.removedIds,
      targetIds: CORRECTED_ANSWER_IDS_V11
    };
    return { alreadyDone: false, ...result };
  }

  function maybeShowCorrectedAnswerNotice() { return; }

  function openSystemNoticeModal(title, html) {
    if (!els.explanationModal || !els.explanationTitle || !els.explanationContent) return alert(stripHtml(`${title}

${html}`));
    els.explanationTitle.textContent = title;
    els.explanationContent.innerHTML = `<div class="system-notice">${html}</div>`;
    els.explanationModal.classList.remove('hidden');
  }

  function stripHtml(value) {
    return String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  async function loginWithEmail() {
    if (!window.FirebaseQuiz?.configured) return;
    const email = els.emailInput.value.trim();
    const password = els.passwordInput.value;
    if (!email || !password) return showAuthMessage('Inserisci email e password.');
    try {
      await window.FirebaseQuiz.auth.signInWithEmailAndPassword(email, password);
      showAuthMessage('Accesso eseguito.');
    } catch (error) {
      showAuthMessage(errText(error));
    }
  }

  function openAccountRequestModal() {
    if (!window.FirebaseQuiz?.configured) return showAuthMessage('Firebase non configurato.');
    els.accountRequestMessage.textContent = '';
    if (els.requestPassword) els.requestPassword.value = '';
    if (els.requestPasswordConfirm) els.requestPasswordConfirm.value = '';
    if (els.requestCourseIstruttore) els.requestCourseIstruttore.checked = COURSE_ID === 'istruttore';
    if (els.requestCourseBagnino) els.requestCourseBagnino.checked = COURSE_ID === 'bagnino';
    els.accountRequestModal?.classList.remove('hidden');
  }

  function closeAccountRequestModal() {
    els.accountRequestModal?.classList.add('hidden');
  }

  function selectAccountRequestPlan(event) {
    return;
  }

  async function linkGoogleForAccountRequest() {
    if (!window.FirebaseQuiz?.configured) return;
    try {
      const credential = await window.FirebaseQuiz.auth.signInWithPopup(window.FirebaseQuiz.googleProvider);
      const user = credential.user;
      accountRequestGoogle = {
        uid: user.uid,
        email: user.email || '',
        displayName: user.displayName || '',
        photoURL: user.photoURL || ''
      };
      if (user.email && !els.requestEmail.value.trim()) els.requestEmail.value = user.email;
      if (user.displayName) {
        const parts = user.displayName.trim().split(/\s+/);
        if (!els.requestFirstName.value.trim()) els.requestFirstName.value = parts[0] || '';
        if (!els.requestLastName.value.trim()) els.requestLastName.value = parts.slice(1).join(' ');
      }
      els.requestGoogleStatus.textContent = `Google collegato: ${user.email || user.uid}`;
      await window.FirebaseQuiz.auth.signOut();
    } catch (error) {
      els.requestGoogleStatus.textContent = errText(error);
    }
  }

  async function submitAccountRequest() {
    const firstName = els.requestFirstName.value.trim();
    const lastName = els.requestLastName.value.trim();
    const email = els.requestEmail.value.trim().toLowerCase();
    const password = els.requestPassword?.value || '';
    const confirmPassword = els.requestPasswordConfirm?.value || '';
    const message = els.requestMessage.value.trim();
    const requestedCourses = [];
    if (els.requestCourseIstruttore?.checked) requestedCourses.push('istruttore');
    if (els.requestCourseBagnino?.checked) requestedCourses.push('bagnino');
    if (!firstName || !lastName || !email || !password) {
      els.accountRequestMessage.textContent = 'Nome, cognome, email e password sono obbligatori.';
      return;
    }
    if (password.length < 6) {
      els.accountRequestMessage.textContent = 'La password deve avere almeno 6 caratteri.';
      return;
    }
    if (password !== confirmPassword) {
      els.accountRequestMessage.textContent = 'Le password non coincidono.';
      return;
    }
    if (!requestedCourses.length) {
      els.accountRequestMessage.textContent = 'Seleziona almeno un corso.';
      return;
    }
    if (els.submitAccountRequestBtn) els.submitAccountRequestBtn.disabled = true;
    try {
      await window.QuizAccount.call('create-account-request', { firstName, lastName, email, password, requestedCourses, message });
      els.accountRequestMessage.textContent = 'Richiesta inviata. Ora attendi l’approvazione dell’admin.';
      showAuthMessage('Richiesta account inviata.');
      try { await window.FirebaseQuiz.auth.signInWithEmailAndPassword(email, password); } catch {}
      setTimeout(closeAccountRequestModal, 1200);
    } catch (error) {
      els.accountRequestMessage.textContent = errText(error);
    } finally {
      if (els.submitAccountRequestBtn) els.submitAccountRequestBtn.disabled = false;
    }
  }

  function openTermsModal() {
    els.termsMessage.textContent = '';
    els.termsAcceptCheck.checked = false;
    els.termsModal?.classList.remove('hidden');
  }

  async function acceptTerms() {
    if (!currentUser || !els.termsAcceptCheck.checked) {
      els.termsMessage.textContent = 'Devi selezionare la casella di accettazione.';
      return;
    }
    if (els.acceptTermsBtn) els.acceptTermsBtn.disabled = true;
    try {
      let accepted = false;
      try {
        await window.QuizAccount.call('accept-terms', {});
        accepted = true;
      } catch (fnError) {
        await accountDocRef().set({ access: { termsAcceptedAt: firebase.firestore.FieldValue.serverTimestamp(), termsVersion: 'v23-legal-placeholder' } }, { merge: true });
        accepted = true;
      }
      if (!accepted) throw new Error('Errore durante l’accettazione.');
      els.termsModal?.classList.add('hidden');
      await window.FirebaseQuiz.auth.currentUser?.reload?.();
      location.reload();
    } catch (error) {
      els.termsMessage.textContent = errText(error);
    } finally {
      if (els.acceptTermsBtn) els.acceptTermsBtn.disabled = false;
    }
  }

  async function sendPasswordReset() {
    if (!window.FirebaseQuiz?.configured) return;
    const email = els.emailInput.value.trim();
    if (!email) return showAuthMessage('Inserisci la tua email, poi premi “Password dimenticata”.');
    try {
      await window.FirebaseQuiz.auth.sendPasswordResetEmail(email);
      showAuthMessage('Email di reimpostazione password inviata.');
    } catch (error) {
      showAuthMessage(errText(error));
    }
  }

  async function resendVerificationEmail() {
    const user = window.FirebaseQuiz?.auth?.currentUser;
    if (!user) return showAuthMessage('Devi essere collegato per reinviare la verifica.');
    try {
      await user.sendEmailVerification({ url: `${location.origin}${location.pathname.replace(/[^/]*$/, '')}index.html?emailVerified=1`, handleCodeInApp: false });
      showAuthMessage('Email di verifica reinviata. Controlla anche spam/promozioni.');
    } catch (error) {
      showAuthMessage(errText(error));
    }
  }

  async function loginWithGoogle() {
    if (!window.FirebaseQuiz?.configured) return;
    try {
      await window.FirebaseQuiz.auth.signInWithPopup(window.FirebaseQuiz.googleProvider);
    } catch (error) {
      const fallbackCodes = ['auth/popup-blocked', 'auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'auth/operation-not-supported-in-this-environment'];
      if (fallbackCodes.includes(error.code)) {
        await window.FirebaseQuiz.auth.signInWithRedirect(window.FirebaseQuiz.googleProvider);
        return;
      }
      showAuthMessage(errText(error));
    }
  }

  async function logout() {
    if (!window.FirebaseQuiz?.configured) return;
    accessGranted = false;
    currentIsAdmin = false;
    await window.FirebaseQuiz.auth.signOut();
  }

  function showAuthMessage(text) {
    els.authMessage.textContent = text || '';
  }

  function toggleAccountPanel() {
    if (!currentUser) {
      els.authCard.classList.remove('hidden');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    els.authCard.classList.toggle('hidden');
  }

  function requireLogin() {
    if (currentUser && accessGranted) return true;
    els.authCard.classList.remove('hidden');
    document.body.classList.add('app-locked');
    showAuthMessage(currentUser ? 'Prima devi completare verifica/approvazione account.' : 'Devi accedere prima di iniziare.');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return false;
  }


  async function loadAdminPendingCount() {
    if (!currentIsAdmin || !els.adminBellBtn || !els.adminPendingBadge) return;
    try {
      const snap = await window.FirebaseQuiz.db.collection('accountRequests').limit(200).get();
      let count = 0;
      snap.forEach((doc) => {
        const status = (doc.data() || {}).status || 'pending';
        if (status === 'pending' || status === 'review') count += 1;
      });
      els.adminPendingBadge.textContent = String(count);
      els.adminBellBtn.classList.toggle('has-pending', count > 0);
      els.adminBellBtn.title = count ? `${count} richieste in attesa` : 'Nessuna richiesta in attesa';
    } catch (error) {
      console.warn('Conteggio richieste admin non disponibile:', error);
    }
  }

  // Annunci: li carica e li mostra announcements.js (popup, banner, schermo intero, conferme)
  async function loadAnnouncements() { /* gestiti da announcements.js */ }


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

  function populateTopics() {
    els.topicSelect.innerHTML = TOPICS.map((topic) => `<option value="${escapeHtml(topic)}">${escapeHtml(topic)}</option>`).join('');
  }

  // Le statistiche (con l'elenco di tutte le domande) si disegnano solo quando sono a schermo:
  // aprendo la scheda Statistiche showView() le aggiorna comunque.
  function renderAll() {
    renderHomeProgress();
    if (els.statsView?.classList.contains('active')) renderStats();
  }


  function ensureRipassoneWindow() {
    state.ripassone = state.ripassone || { firstSeenAt: null, history: [] };
    if (!state.ripassone.firstSeenAt) {
      state.ripassone.firstSeenAt = new Date().toISOString();
      saveState();
    }
    const start = new Date(state.ripassone.firstSeenAt).getTime();
    const remaining = Math.max(0, RIPASSONE_DURATION_MS - (Date.now() - start));
    return { remaining, active: remaining > 0, expiresAt: start + RIPASSONE_DURATION_MS };
  }

  function formatLongCountdown(ms) {
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function isExamoneUnlocked() {
    return (state.progress?.mixedCompleted?.length || 0) >= TOTAL_QUESTIONS;
  }

  function getExamoneStatusLabel() {
    if (!state.examone?.officialAttemptDone) return 'Non ancora svolto';
    return state.examone.officialStatus === 'passed' ? 'AMMESSO' : 'NON AMMESSO';
  }

  function renderHomeProgress() {
    if (window.QuizStudyTracker?.syncCourseProgress) {
      window.QuizStudyTracker.syncCourseProgress(COURSE_ID, getAnsweredQuestionIdSet().size);
    }
    const completedMixed = state.progress.mixedCompleted.length;
    setBar(els.mixedMiniBar, percent(completedMixed, TOTAL_QUESTIONS));
    els.mixedMiniText.textContent = `${completedMixed} / ${TOTAL_QUESTIONS}`;

    const selectedTopic = els.topicSelect.value || TOPICS[0];
    const topicTotal = countTopicQuestions(selectedTopic);
    const topicDone = state.progress.topics[selectedTopic]?.length || 0;
    setBar(els.topicMiniBar, percent(topicDone, topicTotal));
    els.topicMiniText.textContent = `${topicDone} / ${topicTotal}`;

    els.markedCountText.textContent = `${state.markedQuestions.length} domande segnate`;
    els.flashStatsText.textContent = `${state.flashStats.total} flash card fatte`;
    if (els.videoQuizHomeText) {
      const started = VIDEO_SECTIONS.filter((sec) => (state.progress.videoSections?.[sec.id] || []).length).length;
      els.videoQuizHomeText.textContent = started
        ? `${started} di ${VIDEO_SECTIONS.length} sezioni iniziate`
        : `${VIDEO_SECTIONS.length} sezioni`;
    }

    const accuracy = state.stats.totalAnswered ? Math.round((state.stats.correct / state.stats.totalAnswered) * 100) : 0;
    const mixedWeak = getWeakestMixedTopicTotal();
    els.heroStats.innerHTML = `
      <div class="hero-stat"><strong>${state.stats.totalAnswered}</strong><span>Domande fatte</span></div>
      <div class="hero-stat"><strong>${state.stats.wrong}</strong><span>Errate</span></div>
      <div class="hero-stat"><strong>${formatVote(state.stats.averageScore)}</strong><span>Voto medio</span></div>
      <div class="hero-stat"><strong>${accuracy}%</strong><span>Precisione</span></div>
      <div class="hero-stat"><strong>${escapeHtml(mixedWeak.label)}</strong><span>Più errori misto</span></div>
      <div class="hero-stat examone-hero"><strong>${escapeHtml(getExamoneStatusLabel())}</strong><span>Esamone finale</span></div>
    `;

    const examUnlocked = isExamoneUnlocked();
    if (els.examoneCard) {
      els.examoneCard.classList.toggle('locked', !examUnlocked);
      els.examoneCard.classList.toggle('unlocked', examUnlocked);
      els.startExamoneBtn.disabled = !examUnlocked;
      els.examoneLockText.textContent = examUnlocked
        ? 'Sbloccato: hai completato tutte le 1000 domande nel quiz misto.'
        : `🔒 Bloccato: completa il quiz misto (${completedMixed}/${TOTAL_QUESTIONS}) per sbloccarlo.`;
      els.examoneStatusText.textContent = state.examone?.officialAttemptDone
        ? `Primo tentativo ufficiale: ${getExamoneStatusLabel()} · ${state.examone.officialCorrect}/${EXAMONE_TOTAL}`
        : 'Primo tentativo ufficiale non ancora svolto.';
    }
  }

  function countTopicQuestions(topic) {
    return QUESTIONS.filter((q) => q.topic === topic).length;
  }


  function startRipassone() { return; }

  function startExamone() {
    if (blockedByFeature('exam')) return;
    if (!isExamoneUnlocked()) return showToast('Esamone bloccato: completa prima tutte le 1000 domande nel quiz misto.');
    const firstAttempt = !state.examone?.officialAttemptDone;
    const warning = `ATTENZIONE\n\nL’Esamone è una simulazione interna del sito: 50 domande in 20 minuti, soglia 40/50.\n\nSe risulta NON AMMESSO, non significa che all’esame ufficiale non sarai ammesso. È solo un termine generale per indicare l’esito della simulazione. I criteri ufficiali di ammissione non sono questi: non prenderla con ansia.\n\n${firstAttempt ? 'Questo sarà il tuo primo tentativo ufficiale salvato in alto nel sito. I tentativi successivi saranno liberi ma non cambieranno il risultato ufficiale.' : 'Hai già svolto il primo tentativo ufficiale. Puoi rifarlo liberamente, ma il risultato ufficiale non cambierà.'}\n\nVuoi iniziare ora?`;
    if (!confirm(warning)) return;
    const selected = buildExamoneQuestions();
    startQuiz('examone', selected, 'Esamone finale', null, { allowHints: false, timerSeconds: EXAMONE_TIME_SECONDS, examoneOfficial: firstAttempt });
  }

  function buildExamoneQuestions() {
    const selected = [];
    const addQuestions = (items, max) => {
      shuffle(items).forEach((q) => {
        if (selected.length >= max) return;
        if (q && !selected.some((x) => x.id === q.id)) selected.push(q);
      });
    };
    const topicWeakness = TOPICS.map((topic) => {
      const s = state.byTopic?.[topic] || { answered: 0, wrong: 0 };
      const rate = s.answered ? s.wrong / s.answered : 0;
      const mixedErrors = Number(state.mixedTopicErrors?.[topic] || 0);
      return { topic, score: rate * 100 + mixedErrors };
    }).sort((a, b) => b.score - a.score);

    const weakTopics = topicWeakness.slice(0, Math.max(3, Math.min(4, TOPICS.length))).map((x) => x.topic);
    const weakPool = QUESTIONS.filter((q) => weakTopics.includes(q.topic));
    addQuestions(weakPool, 30);

    const errorIds = normalizeIdArray([
      ...(state.wrong?.mixed || []),
      ...flatten(TOPICS.map((topic) => state.wrong?.topics?.[topic] || [])),
      ...flatten((state.stats?.history || []).slice(0, 12).map((h) => (h.errors || []).map((e) => e.questionId)))
    ]);
    addQuestions(errorIds.map((id) => QUESTIONS_BY_ID.get(id)).filter(Boolean), 42);

    addQuestions(QUESTIONS, EXAMONE_TOTAL);
    return shuffle(selected).slice(0, EXAMONE_TOTAL);
  }

  function startMixedQuiz() {
    if (blockedByFeature('mixed')) return;
    const seen = new Set(state.progress.mixedCycleSeen || []);
    let remaining = QUESTIONS.filter((q) => !seen.has(q.id));
    let freshLap = false;
    if (!remaining.length) {
      // Hai risposto a tutte le domande del quiz misto: il traguardo permanente (mixedCompleted,
      // che sblocca l'esamone e il badge) resta intatto, si azzera solo il "giro" di pescata.
      state.progress.mixedCycleSeen = [];
      remaining = QUESTIONS;
      freshLap = true;
    }
    const selected = sample(remaining, 20);
    if (!selected.length) return showToast('Nessuna domanda disponibile per il quiz misto.');
    if (freshLap) { saveState(); showToast('Hai risposto a tutte le domande! Si ricomincia un nuovo giro, rimescolate.'); }
    requestTimerAndStart('mixed', shuffle(selected), 'Quiz misto', null, { allowHints: true });
  }

  function startTopicQuiz(topic) {
    if (blockedByFeature('topic')) return;
    state.progress.topicsCycle = state.progress.topicsCycle || {};
    const seen = new Set(state.progress.topicsCycle[topic] || []);
    let remaining = QUESTIONS.filter((q) => q.topic === topic && !seen.has(q.id));
    let freshLap = false;
    if (!remaining.length) {
      state.progress.topicsCycle[topic] = [];
      remaining = QUESTIONS.filter((q) => q.topic === topic);
      freshLap = true;
    }
    const selected = sample(remaining, 7);
    if (!selected.length) return showToast(`Nessuna domanda disponibile per ${topic}.`);
    if (freshLap) { saveState(); showToast(`Hai risposto a tutte le domande di "${topic}"! Si ricomincia un nuovo giro, rimescolate.`); }
    requestTimerAndStart('topic', selected, `Quiz: ${topic}`, topic, { allowHints: true });
  }

  // ---- Quiz per video ----
  // Un quiz per ogni sezione delle videolezioni FAD (non per singolo video: le parti I e II di una
  // sezione sono un solo quiz). 20 domande, senza ripetizioni finché non le hai fatte tutte;
  // se la sezione ne ha meno, tutte quelle che ci sono.
  // Domande della sezione già uscite nel giro corrente e quelle ancora da fare
  function videoLap(section) {
    const pool = section.domande.filter((id) => QUESTIONS_BY_ID.has(id));
    const cycle = new Set(state.progress.videoCycle?.[section.id] || []);
    const unseen = pool.filter((id) => !cycle.has(id));
    const seen = pool.length - unseen.length;
    // giro finito, oppure ne resta un pezzetto da un giro di prima: si riparte da capo (con quelle rimaste dentro)
    const restart = !unseen.length || (unseen.length < VIDEO_LEFTOVER_MIN && seen > 0 && pool.length >= VIDEO_LEFTOVER_MIN);
    const remaining = restart ? pool.length : unseen.length;
    const size = remaining < VIDEO_QUIZ_MERGE_BELOW ? remaining : VIDEO_QUIZ_SIZE;
    return { pool, unseen, seen, restart, size };
  }

  function startVideoQuiz(sectionId) {
    if (blockedByFeature('video')) return;
    const section = VIDEO_SECTION_BY_ID.get(sectionId);
    if (!section) return showToast('Video non trovato.');
    const lap = videoLap(section);
    if (!lap.size) return showToast('Nessuna domanda per questo video.');
    state.progress.videoCycle = state.progress.videoCycle || emptyVideoMap();
    let ids;
    if (lap.restart) {
      // prima quelle rimaste del giro vecchio, poi le altre a caso
      const left = new Set(lap.unseen);
      ids = [...shuffle(lap.unseen), ...shuffle(lap.pool.filter((id) => !left.has(id)))].slice(0, lap.size);
      state.progress.videoCycle[sectionId] = [];
      if (!lap.unseen.length && lap.seen) { saveState(); showToast(`Hai fatto tutte le domande di "${section.titolo}": si ricomincia un nuovo giro, rimescolate.`); }
    } else {
      ids = sample(lap.unseen, lap.size);
    }
    const selected = ids.map((id) => QUESTIONS_BY_ID.get(id)).filter(Boolean);
    requestTimerAndStart('video', shuffle(selected), `Quiz per video · ${section.titolo}`, null, { allowHints: true, videoSection: sectionId });
  }

  function startWrongVideoQuiz(sectionId) {
    if (blockedByFeature('video')) return;
    const section = VIDEO_SECTION_BY_ID.get(sectionId);
    if (!section) return showToast('Video non trovato.');
    const wrongIds = normalizeIdArray(state.wrong.videoSections?.[sectionId]);
    const selected = shuffle(wrongIds.map((id) => QUESTIONS_BY_ID.get(id)).filter(Boolean));
    if (!selected.length) return showToast(`Non hai errori da rifare in "${section.titolo}".`);
    requestTimerAndStart('wrongVideo', selected, `Errori · ${section.titolo}`, null, { allowHints: true, videoSection: sectionId });
  }

  function renderVideoSections() {
    if (!els.videoSectionList) return;
    if (els.videoQuizNote) els.videoQuizNote.textContent = VIDEO_NOTE;
    if (!VIDEO_SECTIONS.length) {
      els.videoSectionList.innerHTML = '<div class="empty-state">Elenco delle sezioni non disponibile.</div>';
      return;
    }
    const go = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>';
    els.videoSectionList.innerHTML = VIDEO_SECTIONS.map((sec, index) => {
      const total = sec.domande.length;
      const ids = new Set(sec.domande);
      const done = normalizeIdArray(state.progress.videoSections?.[sec.id]).filter((id) => ids.has(id)).length;
      const wrong = normalizeIdArray(state.wrong.videoSections?.[sec.id]).filter((id) => ids.has(id)).length;
      const next = videoLap(sec).size;
      const meta = total < VIDEO_QUIZ_MERGE_BELOW ? `${total} domande · quiz unico` : `${total} domande · prossimo quiz: ${next}`;
      return `
        <article class="vq-section">
          <header class="vq-head">
            <span class="vq-num">${index + 1}</span>
            <div>
              <h3>${escapeHtml(sec.titolo)}</h3>
              <p class="vq-meta">${meta}</p>
            </div>
          </header>
          <div class="tile-progress"><div class="mini-progress"><span style="width:${percent(done, total)}%"></span></div><span class="progress-label">${done} / ${total}</span></div>
          <div class="vq-actions">
            <button class="primary-btn vq-start" type="button" data-video-start="${escapeHtml(sec.id)}">Inizia il quiz ${go}</button>
            <button class="secondary-btn vq-wrong" type="button" data-video-wrong="${escapeHtml(sec.id)}" ${wrong ? '' : 'disabled'}>${wrong ? `Rifai gli errori (${wrong})` : 'Nessun errore'}</button>
          </div>
        </article>`;
    }).join('');
  }

  function startWrongMixedQuiz() {
    if (blockedByFeature('wrong')) return;
    const wrongIds = normalizeIdArray(state.wrong.mixed);
    const selected = shuffle(wrongIds.map((id) => QUESTIONS_BY_ID.get(id)).filter(Boolean));
    if (!selected.length) return showToast('Non hai domande sbagliate nel quiz misto.');
    requestTimerAndStart('wrongMixed', selected, 'Sbagliate: quiz misto', null, { allowHints: true });
  }

  function startWrongTopicQuiz(topic) {
    if (blockedByFeature('wrong')) return;
    const wrongIds = normalizeIdArray(state.wrong.topics[topic]);
    const selected = shuffle(wrongIds.map((id) => QUESTIONS_BY_ID.get(id)).filter(Boolean));
    if (!selected.length) return showToast(`Non hai domande sbagliate in ${topic}.`);
    requestTimerAndStart('wrongTopic', selected, `Sbagliate: ${topic}`, topic, { allowHints: true });
  }

  function showMarkedQuestions() {
    if (blockedByFeature('marked')) return;
    const selected = normalizeIdArray(state.markedQuestions).map((id) => QUESTIONS_BY_ID.get(id)).filter(Boolean);
    if (!selected.length) {
      els.markedList.innerHTML = '<div class="empty-state">Non hai ancora domande segnate.</div>';
    } else {
      els.markedList.innerHTML = selected.map((q) => renderMarkedQuestion(q)).join('');
      els.markedList.querySelectorAll('[data-unmark]').forEach((button) => {
        button.addEventListener('click', () => {
          const id = Number(button.dataset.unmark);
          removeId(state.markedQuestions, id);
          persistState();
          renderAll();
          showMarkedQuestions();
          showToast('Domanda rimossa dalle segnate.');
        });
      });
    }
    showView('markedView');
  }

  function toggleMarkedQuestionById(id) {
    const q = QUESTIONS_BY_ID.get(Number(id));
    if (!q) return showToast('Domanda non trovata.');
    if (state.markedQuestions.includes(q.id)) {
      removeId(state.markedQuestions, q.id);
      showToast(`Domanda #${q.id} rimossa dalle segnate.`);
    } else {
      addUnique(state.markedQuestions, q.id);
      showToast(`Domanda #${q.id} segnata.`);
    }
    saveState();
    renderHomeProgress();
  }

  function getExplanation(question) {
    const correctIndex = question.correctIndex;
    const correctLabel = question.labels?.[correctIndex] || LETTERS[correctIndex] || '';
    const correctAnswer = question.options?.[correctIndex] || '';
    return (window[EXPLANATIONS_GLOBAL] || {})[String(question.id)] || {
      id: question.id,
      topic: question.topic,
      correctLabel,
      correctAnswer,
      summary: `La risposta corretta è ${correctLabel}: ${correctAnswer}. Questa opzione è quella coerente con l’argomento ${question.topic}.`,
      correctExplanation: `La risposta ${correctLabel} è corretta perché risponde direttamente alla richiesta della domanda secondo il contenuto teorico di ${question.topic}.`,
      wrongExplanations: {},
      manualReference: `Manuale — sezione ${question.topic}`
    };
  }

  function cleanConceptExplanation(text) {
    let value = String(text || '').trim();
    value = value.replace(/^Corretta:\s*/i, '');
    value = value.replace(/^Non corretta:\s*/i, '');
    value = value.replace(/^(La\s+)?risposta\s+[A-D]\s+è\s+corretta\s+perché\s*/i, '');
    value = value.replace(/^(La\s+)?risposta\s+corretta\s+è\s+[A-D][^\.]*\.\s*/i, '');
    value = value.replace(/\s+Quindi\s+la\s+risposta\s+corretta[\s\S]*$/i, '');
    value = value.replace(/\s+La\s+risposta\s+corretta[\s\S]*$/i, '');
    value = value.replace(/;?\s*il\s+punto\s+verificato\s+porta\s+a\s+[A-D]:[\s\S]*$/i, '.');
    value = value.replace(/\s+/g, ' ').trim();
    if (!/^Il manuale riporta/i.test(value) && !/^Manuale/i.test(value)) {
      value = `Il manuale riporta/descrive: ${value}`;
    }
    return value;
  }

  function getConceptExplanation(question) {
    const exp = getExplanation(question);
    const source = exp.summary || exp.correctExplanation || '';
    return cleanConceptExplanation(source);
  }

  function loadExplanations() {
    if (explanationsReady()) return Promise.resolve();
    if (explanationsPromise) return explanationsPromise;
    explanationsPromise = new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = EXPLANATIONS_SRC;
      script.async = true;
      script.onload = () => { fillPendingExplanations(); resolve(); };
      script.onerror = () => { explanationsPromise = null; script.remove(); resolve(); };
      document.head.appendChild(script);
    });
    return explanationsPromise;
  }
  // Se una spiegazione serve prima che il file sia arrivato, si mostra un segnaposto che si riempie da solo
  function fillPendingExplanations() {
    document.querySelectorAll('[data-expl-q]').forEach((el) => {
      const question = QUESTIONS_BY_ID.get(Number(el.dataset.explQ));
      if (question) el.outerHTML = renderExplanationBlock(question, { showAnswer: el.dataset.explShow === '1' });
    });
  }

  function renderExplanationBlock(question, options = {}) {
    const config = typeof options === 'object' && options !== null ? options : {};
    const showAnswer = Boolean(config.showAnswer);
    if (!explanationsReady()) {
      loadExplanations();
      return `<div class="explanation-pending" data-expl-q="${question.id}" data-expl-show="${showAnswer ? 1 : 0}"><p class="message">Carico la spiegazione…</p></div>`;
    }
    const exp = getExplanation(question);
    const correctIndex = question.correctIndex;
    const correctLabel = question.labels?.[correctIndex] || LETTERS[correctIndex] || '';
    const correctAnswer = question.options?.[correctIndex] || exp.correctAnswer || '';
    const mainExplanation = getConceptExplanation(question);
    return `
      ${showAnswer ? `<div class="explanation-correct"><strong>Risposta corretta:</strong> ${escapeHtml(correctLabel)}. ${escapeHtml(correctAnswer)}</div>` : ''}
      <div class="explanation-main"><p>${escapeHtml(mainExplanation)}</p></div>
      <p class="manual-ref"><strong>Riferimento:</strong> ${escapeHtml(exp.manualReference || `Manuale — sezione ${question.topic}`)}</p>
    `;
  }

  function showCurrentExplanation() {
    if (!activeQuiz) return;
    const q = activeQuiz.questions[activeQuiz.index];
    openExplanationModal(q, { showAnswer: false, titlePrefix: 'Spiegazione senza risposta' });
  }

  function showCurrentFlashcardExplanation() {
    if (!activeFlashcard?.question) return;
    openExplanationModal(activeFlashcard.question, { showAnswer: activeFlashcard.answered });
  }

  function openExplanationModal(question, options = {}) {
    els.explanationTitle.textContent = `${options.titlePrefix || 'Domanda'} #${question.id} · ${question.topic}`;
    els.explanationContent.innerHTML = renderExplanationBlock(question, { showAnswer: Boolean(options.showAnswer) });
    els.explanationModal.classList.remove('hidden');
  }

  function closeExplanationModal() {
    els.explanationModal.classList.add('hidden');
  }

  function renderMarkedQuestion(q) {
    const correctLabel = q.labels?.[q.correctIndex] || LETTERS[q.correctIndex] || '';
    const correctAnswer = q.options?.[q.correctIndex] || '';
    return `
      <article class="marked-item">
        <div class="review-top">
          <strong>${escapeHtml(q.topic)} · #${q.id}</strong>
          <button class="secondary-btn small-btn" type="button" data-unmark="${q.id}">Rimuovi</button>
        </div>
        <h3>${escapeHtml(displayQuestionText(q))}</h3>
        <div class="marked-answer"><strong>Risposta:</strong> ${escapeHtml(correctLabel)}. ${escapeHtml(correctAnswer)}</div>
        <div class="marked-explanation">${renderExplanationBlock(q, { showAnswer: false })}</div>
      </article>
    `;
  }

  function startFlashcards() {
    if (blockedByFeature('flashcards')) return;
    activeFlashcard = {
      count: 0,
      answered: false,
      question: null,
      correctIndexInOptions: 0,
      options: []
    };
    showView('flashcardView');
    nextFlashcard();
  }

  function nextFlashcard() {
    if (!activeFlashcard) return;
    const card = document.querySelector('.flashcard-card');
    if (card) {
      card.classList.remove('answered');
      card.classList.add('dealing');
      setTimeout(() => card.classList.remove('dealing'), 260);
    }
    const q = sample(QUESTIONS, 1)[0];
    const wrongIndexes = q.options.map((_, index) => index).filter((index) => index !== q.correctIndex);
    const wrongIndex = sample(wrongIndexes, 1)[0];
    const twoOptions = shuffle([
      { text: q.options[q.correctIndex], originalIndex: q.correctIndex, correct: true },
      { text: q.options[wrongIndex], originalIndex: wrongIndex, correct: false }
    ]);
    activeFlashcard.question = q;
    activeFlashcard.options = twoOptions;
    activeFlashcard.correctIndexInOptions = twoOptions.findIndex((o) => o.correct);
    activeFlashcard.answered = false;
    renderFlashcard();
  }

  function renderFlashcard() {
    if (!activeFlashcard?.question) return;
    const q = activeFlashcard.question;
    const isMarked = state.markedQuestions.includes(q.id);
    els.flashcardProgressTitle.textContent = 'Allenamento infinito';
    els.flashcardCounter.textContent = `${activeFlashcard.count} fatte`;
    els.flashcardTopic.textContent = `${q.topic} · #${q.id}`;
    els.flashcardQuestion.textContent = displayQuestionText(q);
    els.flashcardMarkBtn.textContent = isMarked ? '★ Segnata' : '☆ Segna';
    if (els.flashcardExplainBtn) els.flashcardExplainBtn.classList.add('hidden');
    els.flashcardFeedback.classList.add('hidden');
    els.flashcardFeedback.innerHTML = '';
    els.flashcardNextBtn.classList.add('hidden');

    els.flashcardOptions.innerHTML = activeFlashcard.options.map((option, index) => `
      <button class="option-btn" type="button" data-flash-index="${index}">
        <span class="option-letter">${index + 1}</span>
        <span>${escapeHtml(option.text)}</span>
      </button>
    `).join('');

    els.flashcardOptions.querySelectorAll('[data-flash-index]').forEach((button) => {
      button.addEventListener('click', () => answerFlashcard(Number(button.dataset.flashIndex)));
    });
  }

  function answerFlashcard(chosenIndex) {
    if (!activeFlashcard || activeFlashcard.answered) return;
    const q = activeFlashcard.question;
    const chosen = activeFlashcard.options[chosenIndex];
    const correct = Boolean(chosen?.correct);
    activeFlashcard.answered = true;
    activeFlashcard.count += 1;
    state.flashStats.total += 1;
    state.flashStats[correct ? 'correct' : 'wrong'] += 1;
    addUnique(state.progress.allAnswered, q.id);
    saveState();
    const card = document.querySelector('.flashcard-card');
    if (card) card.classList.add('answered');

    els.flashcardOptions.querySelectorAll('[data-flash-index]').forEach((button) => {
      const idx = Number(button.dataset.flashIndex);
      const opt = activeFlashcard.options[idx];
      button.disabled = true;
      button.classList.toggle('selected', idx === chosenIndex);
      button.classList.toggle('flash-correct', opt.correct);
      button.classList.toggle('flash-wrong', idx === chosenIndex && !correct);
    });

    els.flashcardFeedback.classList.remove('hidden');
    els.flashcardFeedback.innerHTML = `
      <strong>${correct ? 'Corretto.' : 'Errato.'}</strong>
      <div class="flashcard-explanation">${renderExplanationBlock(q, { showAnswer: true })}</div>
    `;
    if (els.flashcardExplainBtn) els.flashcardExplainBtn.classList.remove('hidden');
    els.flashcardNextBtn.classList.remove('hidden');
    els.flashcardCounter.textContent = `${activeFlashcard.count} fatte`;
    renderHomeProgress();
    checkBadgeUnlocks(true);
  }

  function toggleMarkedCurrentFlashcard() {
    if (!activeFlashcard?.question) return;
    const q = activeFlashcard.question;
    if (state.markedQuestions.includes(q.id)) {
      removeId(state.markedQuestions, q.id);
      showToast('Domanda rimossa dalle segnate.');
    } else {
      addUnique(state.markedQuestions, q.id);
      showToast('Domanda segnata.');
    }
    saveState();
    const isMarkedNow = state.markedQuestions.includes(q.id);
    els.flashcardMarkBtn.textContent = isMarkedNow ? '★ Segnata' : '☆ Segna';
    renderHomeProgress();
  }

  function exitFlashcards() {
    activeFlashcard = null;
    showView('homeView');
  }

  function requestTimerAndStart(mode, selectedQuestions, label, topic = null, options = {}) {
    pendingQuiz = { mode, selectedQuestions, label, topic, options };
    els.timerModeLabel.textContent = label;
    els.timerCustomInput.value = '';
    els.timerModal.classList.remove('hidden');
  }

  function confirmTimer(timerSeconds) {
    if (!pendingQuiz) return closeTimerModal();
    const config = pendingQuiz;
    pendingQuiz = null;
    closeTimerModal();
    startQuiz(config.mode, config.selectedQuestions, config.label, config.topic, {
      ...config.options,
      timerSeconds
    });
  }

  function closeTimerModal() {
    pendingQuiz = null;
    els.timerModal.classList.add('hidden');
  }

  function startQuiz(mode, selectedQuestions, label, topic = null, options = {}) {
    stopTimer();
    activeQuiz = {
      mode,
      topic,
      label,
      questions: selectedQuestions,
      index: 0,
      allowHints: options.allowHints !== false,
      timerSeconds: options.timerSeconds || null,
      remainingSeconds: options.timerSeconds || null,
      startedAt: Date.now(),
      timerInterval: null,
      finishedByTimeout: false,
      timerWarnings: { five: false, one: false },
      examoneOfficial: Boolean(options.examoneOfficial),
      videoSection: options.videoSection || null,
      answers: selectedQuestions.map((q) => ({ id: q.id, selectedIndex: null, hintUsed: false, eliminatedIndex: null }))
    };
    lastWrongIds = [];
    showView('quizView');
    renderCurrentQuestion();
    startTimerIfNeeded();
  }

  function startTimerIfNeeded() {
    if (!activeQuiz?.timerSeconds) {
      els.quizTimer.classList.add('hidden');
      return;
    }
    els.quizTimer.classList.remove('hidden');
    renderTimer();
    activeQuiz.timerInterval = setInterval(() => {
      activeQuiz.remainingSeconds -= 1;
      renderTimer();
      if (activeQuiz.mode === 'examone') {
        if (!activeQuiz.timerWarnings.five && activeQuiz.remainingSeconds <= 5 * 60) { activeQuiz.timerWarnings.five = true; showToast('Esamone: mancano 5 minuti.'); }
        if (!activeQuiz.timerWarnings.one && activeQuiz.remainingSeconds <= 60) { activeQuiz.timerWarnings.one = true; showToast('Esamone: manca 1 minuto.'); }
      }
      if (activeQuiz.remainingSeconds <= 0) {
        activeQuiz.finishedByTimeout = true;
        showToast('Tempo scaduto. Quiz terminato automaticamente.');
        finishQuiz();
      }
    }, 1000);
  }

  function stopTimer() {
    if (activeQuiz?.timerInterval) clearInterval(activeQuiz.timerInterval);
  }

  function renderTimer() {
    if (!activeQuiz?.timerSeconds) return;
    els.quizTimer.textContent = `⏱ ${formatDuration(Math.max(0, activeQuiz.remainingSeconds))}`;
  }

  function renderCurrentQuestion() {
    if (!activeQuiz) return;
    const q = activeQuiz.questions[activeQuiz.index];
    const answer = activeQuiz.answers[activeQuiz.index];
    const current = activeQuiz.index + 1;
    const total = activeQuiz.questions.length;
    const isMarked = state.markedQuestions.includes(q.id);

    els.quizModeLabel.textContent = activeQuiz.label;
    if (els.quizNote) {
      const showNote = Boolean(activeQuiz.videoSection && VIDEO_NOTE);
      els.quizNote.textContent = showNote ? VIDEO_NOTE : '';
      els.quizNote.classList.toggle('hidden', !showNote);
    }
    els.quizProgressTitle.textContent = `Domanda ${current}`;
    els.questionCounter.textContent = `${current} / ${total}`;
    setBar(els.sessionProgressBar, percent(activeQuiz.index, total));
    els.questionTopic.textContent = `${q.topic} · #${q.id}`;
    els.questionText.textContent = displayQuestionText(q);

    els.explainBtn.classList.toggle('hidden', activeQuiz.mode === 'examone');
    els.hintBtn.disabled = !activeQuiz.allowHints || answer.hintUsed || answer.selectedIndex !== null;
    els.hintBtn.textContent = activeQuiz.allowHints ? (answer.hintUsed ? '💡 Suggerimento usato' : '💡 Suggerimento') : 'Suggerimento disattivato';
    els.markQuestionBtn.textContent = isMarked ? '★ Segnata' : '☆ Segna';

    els.optionsList.innerHTML = q.options.map((option, index) => {
      const eliminated = answer.eliminatedIndex === index;
      const selected = answer.selectedIndex === index;
      return `
        <button class="option-btn ${selected ? 'selected' : ''} ${eliminated ? 'eliminated' : ''}" type="button" data-index="${index}" ${eliminated ? 'disabled' : ''}>
          <span class="option-letter">${LETTERS[index]}</span>
          <span>${escapeHtml(option)}${eliminated ? '<em>Eliminata dal suggerimento</em>' : ''}</span>
        </button>
      `;
    }).join('');

    els.optionsList.querySelectorAll('.option-btn').forEach((button) => {
      button.addEventListener('click', () => {
        const idx = Number(button.dataset.index);
        if (activeQuiz.answers[activeQuiz.index].eliminatedIndex === idx) return;
        activeQuiz.answers[activeQuiz.index].selectedIndex = idx;
        renderCurrentQuestion();
      });
    });

    els.prevQuestionBtn.disabled = activeQuiz.index === 0;
    els.nextQuestionBtn.disabled = answer.selectedIndex === null;
    els.nextQuestionBtn.textContent = current === total ? 'Termina quiz' : 'Avanti';
  }

  function useHint() {
    if (!activeQuiz) return;
    const q = activeQuiz.questions[activeQuiz.index];
    const answer = activeQuiz.answers[activeQuiz.index];
    if (!activeQuiz.allowHints) return showToast('Suggerimento disattivato in questa modalità.');
    if (answer.selectedIndex !== null) return showToast('Il suggerimento si usa prima di rispondere.');
    if (answer.hintUsed) return;
    const wrongIndexes = q.options.map((_, index) => index).filter((index) => index !== q.correctIndex);
    answer.eliminatedIndex = sample(wrongIndexes, 1)[0];
    answer.hintUsed = true;
    state.hintStats.used += 1;
    saveState();
    showToast('Suggerimento: una risposta sbagliata è stata eliminata.');
    renderCurrentQuestion();
  }

  function toggleMarkedCurrentQuestion() {
    if (!activeQuiz) return;
    const q = activeQuiz.questions[activeQuiz.index];
    if (state.markedQuestions.includes(q.id)) {
      removeId(state.markedQuestions, q.id);
      showToast('Domanda rimossa dalle segnate.');
    } else {
      addUnique(state.markedQuestions, q.id);
      showToast('Domanda segnata.');
    }
    saveState();
    renderCurrentQuestion();
    renderHomeProgress();
  }

  function previousQuestion() {
    if (!activeQuiz || activeQuiz.index === 0) return;
    activeQuiz.index -= 1;
    renderCurrentQuestion();
  }

  function nextQuestion() {
    if (!activeQuiz) return;
    const answer = activeQuiz.answers[activeQuiz.index];
    if (answer.selectedIndex === null) return;
    if (activeQuiz.index === activeQuiz.questions.length - 1) {
      finishQuiz();
    } else {
      activeQuiz.index += 1;
      renderCurrentQuestion();
    }
  }

  function finishQuiz() {
    if (!activeQuiz) return;
    stopTimer();
    const finishedQuiz = activeQuiz;
    const durationSeconds = Math.max(0, Math.round((Date.now() - finishedQuiz.startedAt) / 1000));
    const results = finishedQuiz.questions.map((question, index) => {
      const answer = finishedQuiz.answers[index];
      const selectedIndex = answer.selectedIndex;
      const isCorrect = selectedIndex === question.correctIndex;
      const points = isCorrect ? (answer.hintUsed ? 0.5 : 1) : 0;
      return { question, selectedIndex, isCorrect, hintUsed: answer.hintUsed, points };
    });

    const correct = results.filter((r) => r.isCorrect).length;
    const total = results.length;
    const points = results.reduce((sum, r) => sum + r.points, 0);
    const vote = total ? (points / total) * 10 : 0;
    const wrongIds = results.filter((r) => !r.isCorrect).map((r) => r.question.id);
    const weakestSession = getWeakestTopicFromResults(results);
    lastWrongIds = wrongIds;
    lastWrongContext = { mode: finishedQuiz.mode, topic: finishedQuiz.topic, label: finishedQuiz.label, videoSection: finishedQuiz.videoSection || null };

    updateStateAfterQuiz(finishedQuiz, results, vote, points, durationSeconds, weakestSession);
    saveState();
    // La streak (obiettivo giornaliero/fuoco) conta solo il quiz misto, su richiesta esplicita:
    // le altre modalita (argomento, sbagliate, esamone...) restano fuori dal conteggio.
    if (finishedQuiz.mode === 'mixed' && window.QuizStudyTracker?.recordActivity) {
      window.QuizStudyTracker.recordActivity(COURSE_ID, results.length);
      window.QuizStudyTracker.recordCorrectAnswers?.(COURSE_ID, correct);
    }
    window.QuizStudyTracker?.syncCourseProgress?.(COURSE_ID, getAnsweredQuestionIdSet().size);
    renderResults(finishedQuiz, results, correct, total, vote, points, durationSeconds, weakestSession);
    renderAll();
    checkBadgeUnlocks(true);
    showView('resultsView');
    activeQuiz = null;
  }

  function updateStateAfterQuiz(quiz, results, vote, points, durationSeconds, weakestSession) {
    const mode = quiz.mode;
    const topic = quiz.topic;
    const isRipassone = mode === 'ripassone';
    const isExamone = mode === 'examone';

    if (!isRipassone) {
      state.stats.totalAnswered += results.length;
      state.stats.correct += results.filter((r) => r.isCorrect).length;
      state.stats.wrong += results.filter((r) => !r.isCorrect).length;
      state.stats.quizCount += 1;
      state.stats.totalScore += vote;
      state.stats.averageScore = state.stats.totalScore / state.stats.quizCount;
    }

    results.forEach(({ question, isCorrect, hintUsed }) => {
      const qTopic = question.topic;
      if (!isRipassone) {
        if (!state.byTopic[qTopic]) state.byTopic[qTopic] = { answered: 0, correct: 0, wrong: 0 };
        state.byTopic[qTopic].answered += 1;
        state.byTopic[qTopic][isCorrect ? 'correct' : 'wrong'] += 1;
        if (hintUsed && isCorrect) state.hintStats.correctAfterHint += 1;
      }

      if (!isRipassone && !isExamone) addUnique(state.progress.allAnswered, question.id);
      if (mode === 'mixed') {
        addUnique(state.progress.mixedCompleted, question.id);
        addUnique(state.progress.mixedCycleSeen, question.id);
      }
      if (mode === 'topic' && topic) {
        addUnique(state.progress.topics[topic], question.id);
        state.progress.topicsCycle[topic] = state.progress.topicsCycle[topic] || [];
        addUnique(state.progress.topicsCycle[topic], question.id);
      }

      if (mode === 'mixed') {
        if (isCorrect) removeId(state.wrong.mixed, question.id);
        else {
          addUnique(state.wrong.mixed, question.id);
          state.mixedTopicErrors[qTopic] = Number(state.mixedTopicErrors[qTopic] || 0) + 1;
        }
      }

      if (mode === 'topic' && topic) {
        if (isCorrect) removeId(state.wrong.topics[topic], question.id);
        else addUnique(state.wrong.topics[topic], question.id);
      }

      if (mode === 'wrongMixed') {
        if (isCorrect) removeId(state.wrong.mixed, question.id);
        else addUnique(state.wrong.mixed, question.id);
      }

      if (mode === 'wrongTopic' && topic) {
        if (isCorrect) removeId(state.wrong.topics[topic], question.id);
        else addUnique(state.wrong.topics[topic], question.id);
      }

      const vs = quiz.videoSection;
      if (vs && VIDEO_SECTION_BY_ID.has(vs) && (mode === 'video' || mode === 'wrongVideo')) {
        state.progress.videoSections = state.progress.videoSections || emptyVideoMap();
        state.progress.videoCycle = state.progress.videoCycle || emptyVideoMap();
        state.wrong.videoSections = state.wrong.videoSections || emptyVideoMap();
        if (mode === 'video') {
          state.progress.videoSections[vs] = state.progress.videoSections[vs] || [];
          state.progress.videoCycle[vs] = state.progress.videoCycle[vs] || [];
          addUnique(state.progress.videoSections[vs], question.id);
          addUnique(state.progress.videoCycle[vs], question.id);
        }
        state.wrong.videoSections[vs] = state.wrong.videoSections[vs] || [];
        if (isCorrect) removeId(state.wrong.videoSections[vs], question.id);
        else addUnique(state.wrong.videoSections[vs], question.id);
      }
    });

    if (mode === 'mixed') {
      state.recentMixedQuizErrors.unshift({
        date: new Date().toISOString(),
        score: Number(vote.toFixed(2)),
        correct: results.filter((r) => r.isCorrect).length,
        total: results.length,
        weakestTopic: weakestSession.label,
        errors: results.filter((r) => !r.isCorrect).map((r) => ({
          questionId: r.question.id,
          topic: r.question.topic,
          selectedLetter: r.selectedIndex === null ? '-' : LETTERS[r.selectedIndex],
          correctLetter: r.question.correctLetter
        }))
      });
      state.recentMixedQuizErrors = state.recentMixedQuizErrors.slice(0, MAX_RECENT_MIXED);
    }


    if (mode === 'ripassone') {
      state.ripassone = state.ripassone || { firstSeenAt: null, history: [] };
      state.ripassone.history.unshift({
        date: new Date().toISOString(),
        correct: results.filter((r) => r.isCorrect).length,
        total: results.length,
        wrong: results.filter((r) => !r.isCorrect).length
      });
      state.ripassone.history = state.ripassone.history.slice(0, 20);
    }

    if (mode === 'examone') {
      const correctCount = results.filter((r) => r.isCorrect).length;
      const status = correctCount >= EXAMONE_PASS_THRESHOLD ? 'passed' : 'failed';
      state.examone = state.examone || { officialAttemptDone: false, officialStatus: null, officialCorrect: null, officialDate: null, bestCorrect: 0, attempts: [] };
      const attempt = {
        date: new Date().toISOString(),
        status,
        correct: correctCount,
        total: results.length,
        durationSeconds,
        timeout: Boolean(quiz.finishedByTimeout),
        weakestTopic: weakestSession.label,
        official: Boolean(quiz.examoneOfficial)
      };
      if (!state.examone.officialAttemptDone) {
        state.examone.officialAttemptDone = true;
        state.examone.officialStatus = status;
        state.examone.officialCorrect = correctCount;
        state.examone.officialDate = attempt.date;
      }
      state.examone.bestCorrect = Math.max(Number(state.examone.bestCorrect || 0), correctCount);
      state.examone.attempts.unshift(attempt);
      state.examone.attempts = state.examone.attempts.slice(0, 50);
    }

    state.stats.history.unshift({
      mode: quiz.label,
      topic: quiz.topic,
      total: results.length,
      correct: results.filter((r) => r.isCorrect).length,
      wrong: results.filter((r) => !r.isCorrect).length,
      points: Number(points.toFixed(1)),
      vote: Number(vote.toFixed(2)),
      hints: results.filter((r) => r.hintUsed).length,
      durationSeconds,
      timeout: Boolean(quiz.finishedByTimeout),
      weakestTopic: weakestSession.label,
      errors: results.filter((r) => !r.isCorrect).map((r) => ({
        questionId: r.question.id,
        topic: r.question.topic,
        selectedLetter: r.selectedIndex === null ? '-' : LETTERS[r.selectedIndex],
        correctLetter: r.question.correctLetter
      })),
      date: new Date().toISOString()
    });
    state.stats.history = state.stats.history.slice(0, MAX_HISTORY);
  }

  function renderResults(quiz, results, correct, total, vote, points, durationSeconds, weakestSession) {
    const scorePercent = Math.round((vote / 10) * 100);
    const exam = quiz.mode === 'examone';
    const passed = exam && correct >= EXAMONE_PASS_THRESHOLD;
    els.scoreRing.style.setProperty('--score', `${exam ? Math.round((correct / Math.max(1, total)) * 100) : scorePercent}%`);
    if (exam) {
      els.scoreRing.textContent = passed ? 'OK' : 'NO';
      els.resultTitle.textContent = passed ? 'AMMESSO' : 'NON AMMESSO';
    } else {
      els.scoreRing.textContent = formatVote(vote);
      els.resultTitle.textContent = correct === total ? 'Perfetto.' : (quiz.finishedByTimeout ? 'Tempo scaduto' : 'Quiz completato');
    }
    els.scoreRing.setAttribute('aria-label', exam ? (passed ? 'Ammesso' : 'Non ammesso') : `Voto ${formatVote(vote)} su 10`);
    els.retryMistakesBtn.disabled = lastWrongIds.length === 0;
    const statsCounted = quiz.mode !== 'ripassone';
    window.QuizResults?.render({
      mode: quiz.mode,
      label: quiz.label,
      results, correct, total, points, vote, durationSeconds,
      timeout: Boolean(quiz.finishedByTimeout),
      passed, threshold: EXAMONE_PASS_THRESHOLD,
      average: statsCounted ? Number(state.stats.averageScore) : NaN,
      totalScore: Number(state.stats.totalScore),
      quizCount: statsCounted ? Number(state.stats.quizCount) : 0,
      fmtVote: formatVote, fmtDecimal: formatDecimal, fmtDuration: formatDuration
    });

    els.answersReview.innerHTML = results.map(({ question, selectedIndex, isCorrect, hintUsed, points }) => {
      const selectedLetter = selectedIndex === null ? '-' : LETTERS[selectedIndex];
      const selectedText = selectedIndex === null ? 'Nessuna risposta' : question.options[selectedIndex];
      const correctText = question.options[question.correctIndex];
      const explanationHtml = renderExplanationBlock(question, { showAnswer: false });
      return `
        <article class="review-item ${isCorrect ? 'correct' : 'wrong'}">
          <div class="review-top">
            <h4>#${question.id} · ${escapeHtml(displayQuestionText(question))}</h4>
            <span class="review-badge ${isCorrect ? 'ok' : 'no'}">${isCorrect ? 'Corretta' : 'Errata'}</span>
          </div>
          <p><strong>Argomento:</strong> ${escapeHtml(question.topic)}</p>
          <p><strong>Risposta data:</strong> ${selectedLetter}) ${escapeHtml(selectedText)}</p>
          <p><strong>Risposta corretta:</strong> ${question.correctLetter}) ${escapeHtml(correctText)}</p>
          <p><strong>Punti:</strong> ${formatDecimal(points)}${hintUsed ? ' · suggerimento usato' : ''}</p>
          <button class="secondary-btn small-btn mark-review-btn ${state.markedQuestions.includes(question.id) ? 'is-marked' : ''}" type="button" data-mark-review="${question.id}">${state.markedQuestions.includes(question.id) ? '★ Segnata' : '☆ Segna'}</button>
          ${isCorrect ? `<details class="review-explanation"><summary>Mostra spiegazione</summary>${explanationHtml}</details>` : `<div class="review-explanation"><h4>Spiegazione errore</h4>${explanationHtml}</div>`}
        </article>
      `;
    }).join('');
  }

  function retryLastMistakes() {
    const selected = lastWrongIds.map((id) => QUESTIONS_BY_ID.get(id)).filter(Boolean);
    if (!selected.length) return showToast('Nessun errore da ripetere.');
    if (lastWrongContext?.videoSection) {
      requestTimerAndStart('wrongVideo', shuffle(selected), 'Ripeti errori ultimo quiz', null, { allowHints: true, videoSection: lastWrongContext.videoSection });
      return;
    }
    const retryMode = lastWrongContext?.topic ? 'wrongTopic' : 'wrongMixed';
    requestTimerAndStart(retryMode, shuffle(selected), 'Ripeti errori ultimo quiz', lastWrongContext?.topic || null, { allowHints: true });
  }

  function exitQuiz() {
    if (!activeQuiz) return showView('homeView');
    const ok = confirm('Vuoi uscire? Le risposte di questa sessione non saranno salvate.');
    if (!ok) return;
    stopTimer();
    activeQuiz = null;
    showView('homeView');
  }

  function renderStats() {
    const s = state.stats;
    const accuracy = s.totalAnswered ? (s.correct / s.totalAnswered) * 100 : 0;
    const mixedWeak = getWeakestMixedTopicTotal();
    const lastMixed = state.recentMixedQuizErrors[0];
    els.statsGrid.innerHTML = `
      <div class="stat-card"><strong>${s.totalAnswered}</strong><span>Domande fatte</span></div>
      <div class="stat-card"><strong>${s.correct}</strong><span>Corrette</span></div>
      <div class="stat-card"><strong>${s.wrong}</strong><span>Errate</span></div>
      <div class="stat-card"><strong>${formatVote(s.averageScore)}</strong><span>Voto medio</span></div>
      <div class="stat-card"><strong>${Math.round(accuracy)}%</strong><span>Precisione globale</span></div>
      <div class="stat-card"><strong>${state.wrong.mixed.length}</strong><span>Sbagliate misto</span></div>
      <div class="stat-card"><strong>${state.markedQuestions.length}</strong><span>Domande segnate</span></div>
      <div class="stat-card"><strong>${s.quizCount}</strong><span>Quiz completati</span></div>
      <div class="stat-card wide-stat"><strong>${escapeHtml(mixedWeak.label)}</strong><span>Più errori nella totalità dei quiz misti${mixedWeak.count ? ` · ${mixedWeak.count}` : ''}</span></div>
      <div class="stat-card wide-stat"><strong>${escapeHtml(lastMixed?.weakestTopic || 'Nessun dato')}</strong><span>Più errori nell'ultimo quiz misto</span></div>
      <div class="stat-card wide-stat"><strong>${state.hintStats.used}</strong><span>Suggerimenti usati · corrette dopo suggerimento: ${state.hintStats.correctAfterHint}</span></div>
      <div class="stat-card wide-stat"><strong>${state.flashStats.total}</strong><span>Flash card fatte · corrette: ${state.flashStats.correct} · errate: ${state.flashStats.wrong}</span></div>
      <div class="stat-card wide-stat examone-stat"><strong>${escapeHtml(getExamoneStatusLabel())}</strong><span>Esamone ufficiale${state.examone?.officialAttemptDone ? ` · ${state.examone.officialCorrect}/${EXAMONE_TOTAL} · migliore: ${state.examone.bestCorrect}/${EXAMONE_TOTAL}` : ' · bloccato fino al completamento del misto'}</span></div>
    `;

    const mixedDoneSet = new Set(state.progress.mixedCompleted);
    els.topicProgressList.innerHTML = TOPICS.map((topic) => {
      const total = countTopicQuestions(topic);
      const topicDone = state.progress.topics[topic]?.length || 0;
      const mixedDone = QUESTIONS.filter((q) => q.topic === topic && mixedDoneSet.has(q.id)).length;
      const topicStats = state.byTopic[topic] || { answered: 0, correct: 0, wrong: 0 };
      const topicAccuracy = topicStats.answered ? Math.round((topicStats.correct / topicStats.answered) * 100) : 0;
      return `
        <div class="topic-row dual-topic-row">
          <div class="topic-name">${escapeHtml(topic)}</div>
          <div class="dual-progress">
            <div>
              <span class="progress-caption">Misto</span>
              <div class="mini-progress"><span style="width:${percent(mixedDone, total)}%"></span></div>
            </div>
            <div>
              <span class="progress-caption">Singolo</span>
              <div class="mini-progress"><span style="width:${percent(topicDone, total)}%"></span></div>
            </div>
          </div>
          <div class="topic-values">Misto ${mixedDone}/${total} · Singolo ${topicDone}/${total} · ${topicAccuracy}% · errori: ${topicStats.wrong}</div>
        </div>
      `;
    }).join('');

    renderAllQuestionsProgress();
    renderScoreTrend();
    renderRecentMixedErrors();
    renderBadges();
    renderHistory();
  }


  function getAnsweredQuestionIdSet() {
    const ids = [
      ...(state.progress?.allAnswered || []),
      ...(state.progress?.mixedCompleted || []),
      ...flatten(TOPICS.map((topic) => state.progress?.topics?.[topic] || [])),
      ...(state.wrong?.mixed || []),
      ...flatten(TOPICS.map((topic) => state.wrong?.topics?.[topic] || []))
    ];
    return new Set(normalizeIdArray(ids));
  }

  let allQuestionsKey = '';
  let allQuestionsToken = 0;
  function renderAllQuestionsProgress() {
    if (!els.allQuestionsProgressList) return;
    const answered = getAnsweredQuestionIdSet();
    const done = answered.size;
    let idSum = 0;
    answered.forEach((id) => { idSum += Number(id) || 0; });
    const key = `${done}:${idSum}`;
    if (key === allQuestionsKey && els.allQuestionsProgressList.firstElementChild) return;
    allQuestionsKey = key;
    // Prima le prime domande, il resto a pezzi quando il telefono è libero: la scheda si apre subito
    const itemHtml = (q) => {
          const isDone = answered.has(q.id);
          return `
            <div class="question-check ${isDone ? 'done' : ''}">
              <span class="check-dot">${isDone ? '✓' : ''}</span>
              <div>
                <strong>#${q.id} · ${escapeHtml(q.topic)}</strong>
                <p>${escapeHtml(displayQuestionText(q))}</p>
                ${isDone ? `<button class="secondary-btn small-btn remove-done-btn" type="button" data-remove-done="${q.id}">Rimuovi da fatte</button>` : ''}
              </div>
            </div>
          `;
    };
    const FIRST = 40;
    els.allQuestionsProgressList.innerHTML = `
      <div class="all-questions-summary">
        <div><strong>${done}</strong><span>Domande fatte almeno una volta</span></div>
        <div class="mini-progress"><span style="width:${percent(done, TOTAL_QUESTIONS)}%"></span></div>
        <div class="topic-values">${done} / ${TOTAL_QUESTIONS}</div>
      </div>
      <p class="message small-note">Puoi rimuovere manualmente una domanda dalle “fatte”: tornerà disponibile nei quiz. Prima della rimozione viene sempre richiesta conferma.</p>
      <div class="all-questions-grid">${QUESTIONS.slice(0, FIRST).map(itemHtml).join('')}</div>
    `;
    const grid = els.allQuestionsProgressList.querySelector('.all-questions-grid');
    const token = ++allQuestionsToken;
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 16));
    let next = FIRST;
    const step = () => {
      if (token !== allQuestionsToken || !grid.isConnected) return;
      const end = Math.min(QUESTIONS.length, next + 120);
      grid.insertAdjacentHTML('beforeend', QUESTIONS.slice(next, end).map(itemHtml).join(''));
      next = end;
      if (next < QUESTIONS.length) idle(step, { timeout: 300 });
    };
    if (next < QUESTIONS.length) idle(step, { timeout: 300 });
  }


  function renderScoreTrend() {
    const items = state.stats.history.slice(0, 10).reverse();
    if (!items.length) {
      els.scoreTrendList.innerHTML = '<p class="message">Nessun dato da mostrare.</p>';
      return;
    }
    els.scoreTrendList.innerHTML = items.map((item, index) => `
      <div class="trend-item">
        <span>#${index + 1}</span>
        <div class="mini-progress"><span style="width:${Math.round((item.vote / 10) * 100)}%"></span></div>
        <strong>${formatVote(item.vote)}</strong>
      </div>
    `).join('');
  }

  function renderRecentMixedErrors() {
    const list = (state.stats.history || []).filter((quiz) => Array.isArray(quiz.errors)).slice(0, 5);
    if (!list.length) {
      els.recentErrorsList.innerHTML = '<p class="message">Nessun quiz recente con errori salvati.</p>';
      return;
    }

    els.recentErrorsList.innerHTML = list.map((quiz, index) => {
      const weakestTopic = quiz.weakestTopic && quiz.weakestTopic !== 'Nessun errore' ? quiz.weakestTopic : '';
      const errors = Array.isArray(quiz.errors) ? quiz.errors : [];
      const filteredErrors = weakestTopic ? errors.filter((err) => err.topic === weakestTopic) : errors;
      const errorsHtml = filteredErrors.length ? filteredErrors.map((err) => {
        const q = QUESTIONS_BY_ID.get(Number(err.questionId));
        if (!q) return '';
        return `
          <div class="recent-error-card">
            <div><strong>#${q.id}</strong> · ${escapeHtml(q.topic)}</div>
            <p>${escapeHtml(displayQuestionText(q))}</p>
            <p>Data: <strong>${escapeHtml(err.selectedLetter)}</strong> · Corretta: <strong>${escapeHtml(err.correctLetter)}</strong></p>
            <button class="secondary-btn small-btn" type="button" data-retry-question="${q.id}">Ripeti questa domanda</button>
          </div>
        `;
      }).join('') : '<p class="message">Nessun errore in questo quiz.</p>';

      return `
        <details class="recent-quiz" ${index === 0 ? 'open' : ''}>
          <summary>${escapeHtml(quiz.mode || 'Quiz')} ${quiz.topic ? `· ${escapeHtml(quiz.topic)}` : ''} · ${formatDate(quiz.date)} · voto ${formatVote(quiz.vote)}/10 · ${quiz.correct}/${quiz.total} corrette · argomento più sbagliato: ${escapeHtml(weakestTopic || 'nessuno')}</summary>
          <div class="recent-errors-inner">${errorsHtml}</div>
        </details>
      `;
    }).join('');
  }

  function getBadgeDefinitions() {
    const accuracy = state.stats.totalAnswered ? (state.stats.correct / state.stats.totalAnswered) * 100 : 0;
    return [
      { id: 'first_quiz', icon: '🏊', name: 'Primo tuffo', desc: 'Completa il primo quiz.', unlocked: state.stats.quizCount >= 1 },
      { id: 'hundred_questions', icon: '📘', name: '100 domande', desc: 'Raggiungi 100 domande fatte.', unlocked: state.stats.totalAnswered >= 100 },
      { id: 'fivehundred_questions', icon: '📚', name: '500 domande', desc: 'Raggiungi 500 domande fatte.', unlocked: state.stats.totalAnswered >= 500 },
      { id: 'thousand_questions', icon: '👑', name: 'Dominio totale', desc: 'Incontra tutte le 1000 domande almeno una volta.', unlocked: getAnsweredQuestionIdSet().size >= TOTAL_QUESTIONS },
      { id: 'avg_eight', icon: '🎯', name: 'Media sopra 8', desc: 'Porta il voto medio almeno a 8/10.', unlocked: state.stats.averageScore >= 8 },
      { id: 'perfect_last', icon: '💎', name: 'Zero errori', desc: 'Completa un quiz senza errori.', unlocked: Boolean(state.stats.history?.[0]?.wrong === 0 && state.stats.history?.[0]?.total) },
      { id: 'mixed_complete', icon: '🌊', name: 'Misto completato', desc: 'Completa tutto il percorso del quiz misto.', unlocked: state.progress.mixedCompleted.length >= TOTAL_QUESTIONS },
      { id: 'all_topics', icon: '🧭', name: 'Tutti gli argomenti', desc: 'Rispondi ad almeno una domanda per ogni argomento.', unlocked: TOPICS.every((topic) => (state.byTopic[topic]?.answered || 0) > 0) },
      { id: 'ten_marked', icon: '⭐', name: 'Archivista', desc: 'Salva almeno 10 domande segnate.', unlocked: state.markedQuestions.length >= 10 },
      { id: 'flash_50', icon: '⚡', name: 'Riflessi rapidi', desc: 'Completa 50 flash card.', unlocked: state.flashStats.total >= 50 },
      { id: 'accuracy_90', icon: '🛡️', name: 'Precisione alta', desc: 'Raggiungi almeno il 90% di precisione globale.', unlocked: state.stats.totalAnswered >= 50 && accuracy >= 90 },
      { id: 'examone_unlock', icon: '🔓', name: 'Esamone sbloccato', desc: 'Completa le 1000 domande del percorso misto.', unlocked: isExamoneUnlocked() },
      { id: 'examone_passed', icon: '🏅', name: 'Ammesso', desc: 'Supera l’Esamone con almeno 40/50.', unlocked: state.examone?.officialStatus === 'passed' }
    ];
  }

  function renderBadges() {
    const badges = getBadgeDefinitions();
    els.badgeList.innerHTML = badges.map((badge) => `
      <div class="badge ${badge.unlocked ? 'unlocked' : 'locked'}">
        <span class="badge-icon">${badge.icon}</span>
        <strong>${escapeHtml(badge.name)}</strong>
        <small>${escapeHtml(badge.desc)}</small>
      </div>
    `).join('');
  }

  function checkBadgeUnlocks(showPopup = true) {
    state.system = state.system || { migrations: [], noticesSeen: [] };
    state.system.badgesAnnounced = Array.isArray(state.system.badgesAnnounced) ? state.system.badgesAnnounced : [];
    const unlocked = getBadgeDefinitions().filter((badge) => badge.unlocked);
    const newBadges = unlocked.filter((badge) => !state.system.badgesAnnounced.includes(badge.id));
    if (!newBadges.length) return;
    newBadges.forEach((badge) => state.system.badgesAnnounced.push(badge.id));
    saveState();
    renderBadges();
    if (showPopup) showBadgePopup(newBadges[0]);
  }

  function showBadgePopup(badge) {
    if (!els.explanationModal || !badge) return;
    els.explanationTitle.textContent = 'Badge sbloccato';
    els.explanationContent.innerHTML = `
      <div class="badge-popup">
        <div class="badge-popup-icon">${badge.icon}</div>
        <h3>${escapeHtml(badge.name)}</h3>
        <p>${escapeHtml(badge.desc)}</p>
      </div>
    `;
    els.explanationModal.classList.remove('hidden');
  }

  function renderHistory() {
    const s = state.stats;
    if (!s.history.length) {
      els.historyList.innerHTML = '<p class="message">Nessun quiz completato.</p>';
      return;
    }

    els.historyList.innerHTML = s.history.slice(0, 15).map((item) => `
      <div class="history-item">
        <div>
          <strong>${escapeHtml(item.mode)}</strong>
          <span>${formatDate(item.date)} · ${item.correct}/${item.total} corrette · ${item.wrong} errate · ${item.hints || 0} suggerimenti · ${formatDuration(item.durationSeconds || 0)}</span>
        </div>
        <div class="status-pill">${formatVote(item.vote)}/10</div>
      </div>
    `).join('');
  }

  function getWeakestTopicFromResults(results) {
    const counts = {};
    results.forEach((r) => {
      if (!r.isCorrect) counts[r.question.topic] = (counts[r.question.topic] || 0) + 1;
    });
    const entries = Object.entries(counts).sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0], 'it'));
    if (!entries.length) return { label: 'Nessun errore', count: 0, topics: [] };
    return { label: entries[0][0], count: entries[0][1], topics: [entries[0][0]] };
  }

  function getWeakestMixedTopicTotal() {
    const entries = TOPICS.map((topic) => [topic, Number(state.mixedTopicErrors?.[topic] || 0)])
      .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0], 'it'));
    if (!entries.length || !entries[0][1]) return { label: 'Nessun dato', count: 0 };
    return { label: entries[0][0], count: entries[0][1] };
  }

  function removeQuestionFromDoneManually(id) {
    const q = QUESTIONS_BY_ID.get(Number(id));
    if (!q) return showToast('Domanda non trovata.');
    const ok = confirm(`Sei sicuro di voler rimuovere la domanda #${q.id} dalle domande fatte?\n\nPotrà ricapitarti nei quiz. Le statistiche storiche non vengono cancellate.`);
    if (!ok) return;
    const result = scrubQuestionIdsFromProgress([q.id]);
    markProgressReset();
    saveState();
    renderAll();
    showToast(result.removedOccurrences > 0 ? `Domanda #${q.id} rimossa dalle domande fatte.` : `Domanda #${q.id} non era nei progressi.`);
  }

  function resetMixedProgress() {
    if (!confirm('Resetti solo i progressi del quiz misto? Le statistiche restano.')) return;
    state.progress.mixedCompleted = [];
    state.progress.mixedCycleSeen = [];
    markProgressReset();
    saveState();
    renderAll();
    showToast('Progressi misto resettati.');
  }

  function resetTopicProgress(topic) {
    if (!topic) return;
    if (!confirm(`Resetti i progressi di ${topic}? Le statistiche restano.`)) return;
    state.progress.topics[topic] = [];
    state.progress.topicsCycle = state.progress.topicsCycle || {};
    state.progress.topicsCycle[topic] = [];
    markProgressReset();
    saveState();
    renderAll();
    showToast(`Progressi ${topic} resettati.`);
  }

  function resetAllData() {
    if (!confirm('Azzera TUTTI i tuoi dati: progressi, errori e statistiche?')) return;
    state = createDefaultState();
    markProgressReset();
    saveState();
    renderAll();
    showToast('Dati azzerati.');
  }

  function openFad() {
    showView('fadView');
  }

  async function renderFad() {
    if (!els.fadView) return;
    if (els.fadHeroCopy) els.fadHeroCopy.textContent = 'Caricamento...';
    let catalog = [];
    let progress = window.QuizFAD?.defaultProgress?.() || {};
    try {
      catalog = (await window.QuizFAD?.loadCatalog?.()) || [];
      progress = (await window.QuizFAD?.loadProgress?.()) || progress;
    } catch (error) {
      console.error('renderFad:', error);
    }
    fadCatalogCache = catalog;
    fadProgressCache = progress;
    const stats = window.QuizFAD.computeStats(catalog, progress);

    if (els.fadStatWatched) els.fadStatWatched.textContent = String(stats.watchedCount);
    if (els.fadStatTotal) els.fadStatTotal.textContent = String(stats.totalCount);
    if (els.fadStatMinutesLeft) els.fadStatMinutesLeft.textContent = `${stats.remainingMinutes} min`;
    if (els.fadStatPace) {
      els.fadStatPace.textContent = stats.goalMode === 'deadline'
        ? (stats.daysLeft > 0 ? `${stats.dailyPaceNeeded} min/giorno per ${stats.daysLeft}g` : 'Scadenza raggiunta')
        : `${stats.dailyPaceNeeded} min/giorno`;
    }
    if (els.fadHeroTitle) els.fadHeroTitle.textContent = catalog.length ? 'Il tuo percorso FAD' : 'Catalogo FAD non ancora disponibile';
    if (els.fadHeroCopy) {
      els.fadHeroCopy.textContent = catalog.length
        ? (stats.remainingMinutes > 0
            ? `Ti restano ${stats.remainingMinutes} minuti di video. Obiettivo: ${stats.goalMode === 'deadline' ? `finire entro il ${progress.examDate || '—'}` : `${stats.dailyPaceNeeded} min al giorno`}.`
            : 'Hai visto tutti i video del catalogo. Ottimo lavoro!')
        : 'L’admin non ha ancora caricato i video della FAD con le relative durate. Torna più tardi.';
    }

    if (!catalog.length) {
      if (els.fadEmptyMessage) { els.fadEmptyMessage.textContent = 'Nessun video disponibile al momento: l’admin deve ancora aggiungere i video della FAD.'; els.fadEmptyMessage.classList.remove('hidden'); }
      if (els.fadVideoListEl) els.fadVideoListEl.innerHTML = '';
    } else {
      if (els.fadEmptyMessage) els.fadEmptyMessage.classList.add('hidden');
      const watchedIds = new Set(progress.watchedIds || []);
      if (els.fadVideoListEl) {
        els.fadVideoListEl.innerHTML = catalog.map((v) => `
          <div class="history-item fad-video-item${watchedIds.has(v.id) ? ' watched' : ''}" data-fad-video="${escapeHtml(v.id)}">
            <div class="fad-video-main">
              <span class="fad-video-check">${watchedIds.has(v.id) ? '✓' : ''}</span>
              <span class="fad-video-title">${escapeHtml(v.title || 'Video')}</span>
            </div>
            <span>${Number(v.minutes) || 0} min</span>
          </div>
        `).join('');
      }
    }
    updateFadHomeSummary();
  }

  async function handleFadVideoToggle(event) {
    const row = event.target.closest('[data-fad-video]');
    if (!row || !window.QuizFAD) return;
    const id = row.dataset.fadVideo;
    const nowWatched = !row.classList.contains('watched');
    row.classList.toggle('watched', nowWatched);
    const checkEl = row.querySelector('.fad-video-check');
    if (checkEl) checkEl.textContent = nowWatched ? '✓' : '';
    try {
      const watchedIds = await window.QuizFAD.toggleWatched(id, nowWatched);
      fadProgressCache = { ...(fadProgressCache || window.QuizFAD.defaultProgress()), watchedIds };
      renderFad();
    } catch (error) {
      row.classList.toggle('watched', !nowWatched);
      if (checkEl) checkEl.textContent = !nowWatched ? '✓' : '';
      showToast(`Errore salvataggio: ${errText(error)}`);
    }
  }

  function openFadGoalModal() {
    if (!els.fadGoalModal || !window.QuizFAD) return;
    const p = fadProgressCache || window.QuizFAD.defaultProgress();
    if (els.fadGoalModeDaily) els.fadGoalModeDaily.checked = p.goalMode !== 'deadline';
    if (els.fadGoalModeDeadline) els.fadGoalModeDeadline.checked = p.goalMode === 'deadline';
    if (els.fadGoalDailyInput) els.fadGoalDailyInput.value = p.dailyTarget || 15;
    if (els.fadGoalDeadlineInput) els.fadGoalDeadlineInput.value = p.examDate || '';
    els.fadGoalModal.classList.remove('hidden');
  }

  function closeFadGoalModal() {
    els.fadGoalModal?.classList.add('hidden');
  }

  async function saveFadGoalFromModal() {
    const goalMode = els.fadGoalModeDeadline?.checked ? 'deadline' : 'daily';
    const dailyTarget = Number(els.fadGoalDailyInput?.value) || 15;
    const examDate = els.fadGoalDeadlineInput?.value || '';
    if (goalMode === 'deadline' && !examDate) return showToast('Scegli una data per l’obiettivo con scadenza.');
    try {
      await window.QuizFAD.saveGoal({ goalMode, dailyTarget, examDate });
      showToast('Obiettivo FAD salvato.');
      closeFadGoalModal();
      renderFad();
    } catch (error) {
      showToast(`Errore salvataggio obiettivo: ${errText(error)}`);
    }
  }

  async function updateFadHomeSummary() {
    if (!els.fadHomeSummary || !window.QuizFAD) return;
    if (!currentIsAdmin && getFeatureState('fad').hidden) { els.fadHomeSummary.textContent = 'Non disponibile al momento.'; return; }
    try {
      if (!fadCatalogCache) fadCatalogCache = await window.QuizFAD.loadCatalog();
      if (!fadProgressCache) fadProgressCache = (await window.QuizFAD.loadProgress()) || window.QuizFAD.defaultProgress();
      const stats = window.QuizFAD.computeStats(fadCatalogCache, fadProgressCache);
      els.fadHomeSummary.textContent = stats.totalCount
        ? `${stats.watchedCount}/${stats.totalCount} video visti · ${stats.remainingMinutes} min restanti`
        : 'Catalogo video non ancora disponibile.';
    } catch (error) {
      els.fadHomeSummary.textContent = 'Apri per impostare il tuo obiettivo di studio.';
    }
  }

  function showView(viewId) {
    if ((!currentUser || !accessGranted) && viewId !== 'homeView') {
      requireLogin();
      return;
    }
    ['homeView', 'quizView', 'flashcardView', 'markedView', 'resultsView', 'statsView', 'fadView', 'videoView'].forEach((id) => {
      els[id]?.classList.toggle('active', id === viewId);
    });
    if (viewId === 'homeView') renderHomeProgress();
    if (viewId === 'statsView') renderStats();
    if (viewId === 'fadView') renderFad();
    if (viewId === 'videoView') renderVideoSections();
    // in cima subito: lo scorrimento animato faceva sembrare lento ogni cambio di schermata
    window.scrollTo(0, 0);
  }

  function setBar(el, value) {
    el.style.width = `${Math.max(0, Math.min(100, value))}%`;
  }

  function percent(part, total) {
    return total ? Math.round((part / total) * 100) : 0;
  }

  function sample(items, count) {
    return shuffle(items).slice(0, count);
  }

  function shuffle(items) {
    const arr = [...items];
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function addUnique(arr, id) {
    if (!arr.includes(id)) arr.push(id);
  }

  function removeId(arr, id) {
    const index = arr.indexOf(id);
    if (index !== -1) arr.splice(index, 1);
  }

  function formatVote(value) {
    const num = Number(value || 0);
    return num.toFixed(1).replace('.0', '');
  }

  function formatDecimal(value) {
    const num = Number(value || 0);
    return num.toFixed(1).replace('.0', '');
  }

  function formatDuration(seconds) {
    const total = Math.max(0, Number(seconds || 0));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function formatDate(value) {
    try {
      return new Intl.DateTimeFormat('it-IT', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
      }).format(new Date(value));
    } catch {
      return '';
    }
  }

  function displayQuestionText(question) {
    const topic = String(question?.topic || '').trim();
    let text = String(question?.question || '').trim();
    if (topic === 'La Cultura dell’Acqua') {
      text = text.replace(/^(la\s+cultura\s+dell[’']acqua|dell[’']acqua|dell\s+acqua)\s*[·:\-–—]?\s*/i, '').trim();
    }
    return text;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function openInstallModal() {
    els.installPromptBtn?.classList.toggle('hidden', !deferredInstallPrompt);
    els.installModal?.classList.remove('hidden');
  }

  function closeInstallModal() {
    els.installModal?.classList.add('hidden');
  }

  async function runInstallPrompt() {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice.catch(() => null);
    deferredInstallPrompt = null;
    els.installPromptBtn?.classList.add('hidden');
    closeInstallModal();
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.remove('hidden');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => els.toast.classList.add('hidden'), 2800);
  }
})();
