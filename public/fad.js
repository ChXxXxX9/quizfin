(() => {
  'use strict';
  // Modulo FAD (videolezioni) — esclusivo del corso Istruttore.
  // Solo dati/logica: nessun accesso al DOM qui dentro, lo fa app.js.
  let currentUser = null;

  document.addEventListener('DOMContentLoaded', () => {
    const fb = window.FirebaseQuiz;
    if (!fb?.configured || !fb.auth) return;
    fb.auth.onAuthStateChanged((user) => { currentUser = user || null; });
  });

  function db() { return window.FirebaseQuiz?.db || null; }

  async function loadCatalog() {
    try {
      if (!db()) return [];
      const snap = await db().collection('fadVideos').orderBy('order', 'asc').get();
      const list = [];
      snap.forEach((doc) => list.push({ id: doc.id, ...doc.data() }));
      return list;
    } catch (error) {
      console.error('QuizFAD.loadCatalog:', error);
      return [];
    }
  }

  function defaultProgress() {
    return {
      watchedIds: [],
      goalMode: 'daily', // 'daily' | 'deadline'
      dailyTarget: 15, // minuti al giorno
      examDate: '', // usato se goalMode === 'deadline'
      createdAt: null,
      updatedAt: null
    };
  }

  function progressRef() {
    if (!currentUser?.uid || !db()) return null;
    return db().collection('users').doc(currentUser.uid).collection('fadProgress').doc('istruttore');
  }

  async function loadProgressStrict() {
    const ref = progressRef();
    if (!ref) throw new Error('Utente non autenticato o Firestore non disponibile.');
    const snap = await ref.get();
    if (!snap.exists) return null;
    return { ...defaultProgress(), ...(snap.data() || {}) };
  }

  async function loadProgress() {
    try { return await loadProgressStrict(); }
    catch (error) { console.error('QuizFAD.loadProgress:', error); return null; }
  }

  async function saveGoal(values) {
    const ref = progressRef();
    if (!ref) throw new Error('Utente non autenticato o Firestore non disponibile.');
    const existing = await ref.get().catch(() => null);
    const patch = {
      goalMode: values.goalMode === 'deadline' ? 'deadline' : 'daily',
      dailyTarget: Math.max(1, Number(values.dailyTarget) || 15),
      examDate: typeof values.examDate === 'string' ? values.examDate : '',
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (!existing || !existing.exists) {
      patch.watchedIds = [];
      patch.createdAt = firebase.firestore.FieldValue.serverTimestamp();
    }
    await ref.set(patch, { merge: true });
    return true;
  }

  async function toggleWatched(videoId, watched) {
    const ref = progressRef();
    if (!ref) throw new Error('Utente non autenticato o Firestore non disponibile.');
    const snap = await ref.get();
    const current = snap.exists ? (snap.data() || {}) : defaultProgress();
    const set = new Set(Array.isArray(current.watchedIds) ? current.watchedIds : []);
    if (watched) set.add(videoId); else set.delete(videoId);
    const patch = { watchedIds: [...set], updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
    if (!snap.exists) {
      patch.goalMode = 'daily';
      patch.dailyTarget = 15;
      patch.examDate = '';
      patch.createdAt = firebase.firestore.FieldValue.serverTimestamp();
    }
    await ref.set(patch, { merge: true });
    return [...set];
  }

  function computeStats(catalog, progress) {
    const list = Array.isArray(catalog) ? catalog : [];
    const watchedIds = new Set(Array.isArray(progress?.watchedIds) ? progress.watchedIds : []);
    const totalMinutes = list.reduce((sum, v) => sum + (Number(v.minutes) || 0), 0);
    const watchedMinutes = list.reduce((sum, v) => sum + (watchedIds.has(v.id) ? (Number(v.minutes) || 0) : 0), 0);
    const remainingMinutes = Math.max(0, totalMinutes - watchedMinutes);
    const watchedCount = list.filter((v) => watchedIds.has(v.id)).length;
    const totalCount = list.length;

    const goalMode = progress?.goalMode === 'deadline' ? 'deadline' : 'daily';
    let daysLeft = null;
    let dailyPaceNeeded = null;

    if (goalMode === 'deadline' && progress?.examDate) {
      const target = new Date(`${progress.examDate}T23:59:59`);
      const now = new Date();
      const msLeft = target - now;
      daysLeft = Math.max(0, Math.ceil(msLeft / 86400000));
      dailyPaceNeeded = daysLeft > 0 ? Math.ceil(remainingMinutes / daysLeft) : remainingMinutes;
    } else {
      const dailyTarget = Math.max(1, Number(progress?.dailyTarget) || 15);
      daysLeft = remainingMinutes > 0 ? Math.ceil(remainingMinutes / dailyTarget) : 0;
      dailyPaceNeeded = dailyTarget;
    }

    return {
      totalMinutes, watchedMinutes, remainingMinutes,
      watchedCount, totalCount,
      goalMode, daysLeft, dailyPaceNeeded
    };
  }

  window.QuizFAD = { loadCatalog, loadProgress, loadProgressStrict, saveGoal, toggleWatched, computeStats, defaultProgress };
})();
