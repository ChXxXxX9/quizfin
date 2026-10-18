/* ==========================================================================
   Quiz Nuoto — azioni account senza server (account-actions.js)
   --------------------------------------------------------------------------
   Prima queste operazioni giravano come funzioni su Netlify (con Firebase
   Admin). Ora girano nel browser con l'SDK Firebase normale; la sicurezza
   è affidata alle regole di Firestore (firestore.rules):
   - un utente può scrivere solo la "contabilità" delle proprie richieste
     (corsi in attesa, stato richiesta) e mai i propri permessi
     (appVerified, courseAccess, banned, corsi bloccati…);
   - approvare e rifiutare richieste resta riservato agli admin.

   Uso: QuizAccount.call(nome, dati) → Promise con la stessa risposta delle
   vecchie funzioni; in caso di errore lancia Error con un messaggio leggibile.
     'create-account-request'  nuovo account o richiesta di un corso/ricontrollo
     'accept-terms'            accettazione termini
     'complete-verification'   conferma email verificata
     'approve-account-request' (admin) approva una richiesta
     'reject-account-request'  (admin) rifiuta una richiesta
   ========================================================================== */
(() => {
  'use strict';

  const COURSE_LABELS = {
    istruttore: 'Istruttore di Nuoto',
    bagnino: 'Assistenti Bagnanti Piscina',
    arte: 'Arte · Quinto Liceo'
  };
  const COURSES = Object.keys(COURSE_LABELS);
  const VERSION = 'v48';

  /* ---------------- Accesso a Firebase ---------------- */
  const fq = () => window.FirebaseQuiz || {};
  function db() {
    const d = fq().db;
    if (!d) throw new Error('Firebase non è disponibile: ricarica la pagina.');
    return d;
  }
  function auth() {
    const a = fq().auth;
    if (!a) throw new Error('Firebase non è disponibile: ricarica la pagina.');
    return a;
  }
  const FV = () => window.firebase.firestore.FieldValue;
  const now = () => FV().serverTimestamp();
  const remove = () => FV().delete();
  function requireUser() {
    const user = auth().currentUser;
    if (!user) throw new Error('Accesso richiesto: entra con il tuo account e riprova.');
    return user;
  }

  /* ---------------- Utilità (stessa logica delle vecchie funzioni) ---------------- */
  function normalizeCourses(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map(String).filter((course) => COURSE_LABELS[course]))];
  }
  function overlaps(a, b) {
    const set = new Set((a || []).map(String));
    return (b || []).some((x) => set.has(String(x)));
  }
  function hasAnyApprovedCourse(access = {}) {
    const ca = access.courseAccess || {};
    return Boolean(access.appVerified === true && (ca.istruttore === true || ca.bagnino === true || ca.arte === true || Object.keys(ca).length === 0));
  }
  function unionWithoutAllowed(existing, requested, access = {}) {
    const ca = access.courseAccess || {};
    const set = new Set(Array.isArray(existing) ? existing : []);
    requested.forEach((course) => {
      if (!(ca[course] === true || (course === 'istruttore' && access.appVerified === true && Object.keys(ca).length === 0))) set.add(course);
    });
    return [...set];
  }
  function removeCourses(list, courses) {
    const drop = new Set(courses);
    return (Array.isArray(list) ? list : []).filter((course) => !drop.has(course));
  }
  /** Nuovo stato delle mappe per corso dopo un rifiuto (prima/seconda volta). */
  function markRejectedCourses(access, courses, reason, isDefinitive) {
    const status = { ...(access.courseRequestStatus || {}) };
    const notes = { ...(access.courseRejectNotes || {}) };
    const counts = { ...(access.courseRejectedCount || {}) };
    const canReview = { ...(access.courseCanRequestReview || {}) };
    const reviewPending = { ...(access.courseReviewPending || {}) };
    const blocked = { ...(access.courseBlocked || {}) };
    courses.forEach((course) => {
      const nextCount = Number(counts[course] || 0) + 1;
      counts[course] = nextCount;
      notes[course] = reason;
      delete reviewPending[course];
      if (isDefinitive || nextCount >= 2) {
        status[course] = 'blocked';
        blocked[course] = true;
        canReview[course] = false;
      } else {
        status[course] = 'rejected';
        blocked[course] = false;
        canReview[course] = true;
      }
    });
    return { courseRequestStatus: status, courseRejectNotes: notes, courseRejectedCount: counts, courseCanRequestReview: canReview, courseReviewPending: reviewPending, courseBlocked: blocked };
  }
  /**
   * Con set(..., {merge:true}) le mappe annidate si uniscono: per togliere una chiave
   * serve FieldValue.delete(). Questa funzione trasforma "mappa prima → mappa dopo"
   * nei soli cambiamenti da scrivere. Restituisce null se non cambia nulla
   * (una mappa vuota scritta con merge cancellerebbe tutta la mappa).
   */
  function mapChanges(before = {}, after = {}) {
    const out = {};
    Object.keys(after).forEach((key) => { if (before[key] !== after[key]) out[key] = after[key]; });
    Object.keys(before).forEach((key) => { if (!(key in after)) out[key] = remove(); });
    return Object.keys(out).length ? out : null;
  }
  function putMapChanges(target, access, finalMaps) {
    Object.entries(finalMaps).forEach(([name, after]) => {
      const changes = mapChanges(access[name] || {}, after);
      if (changes) target[name] = changes;
    });
    return target;
  }

  function friendlyError(error) {
    const code = error?.code || '';
    const messages = {
      'auth/email-already-in-use': 'Email già registrata. Accedi e richiedi l’accesso al corso dalla schermata principale.',
      'auth/invalid-email': 'Email non valida.',
      'auth/weak-password': 'La password deve avere almeno 6 caratteri.',
      'auth/operation-not-allowed': 'La registrazione con email e password non è attiva nel progetto Firebase.',
      'auth/network-request-failed': 'Connessione assente: controlla internet e riprova.',
      'auth/too-many-requests': 'Troppi tentativi: riprova tra qualche minuto.',
      'permission-denied': 'Operazione non consentita. Se il problema continua, contatta lo staff.',
      unavailable: 'Connessione assente: controlla internet e riprova.'
    };
    const out = new Error(messages[code] || error?.message || 'Operazione non riuscita.');
    out.code = code;
    return out;
  }

  /* ---------------- Nuovo account / richiesta corso / ricontrollo ---------------- */
  async function createAccountRequest(body = {}) {
    const requestedCourses = normalizeCourses(body.requestedCourses);
    const reviewRequest = Boolean(body.reviewRequest);
    if (!requestedCourses.length) throw new Error('Seleziona almeno un corso.');

    let firstName = String(body.firstName || '').trim();
    let lastName = String(body.lastName || '').trim();
    const message = String(body.message || '').trim().slice(0, 1000);
    let user = auth().currentUser;
    let email = '';
    let existingAccess = {};
    let existingProfile = {};
    const isExistingSignedInUser = Boolean(user);

    if (user) {
      email = String(user.email || '').toLowerCase().trim();
      const snap = await db().collection('users').doc(user.uid).get();
      const userData = snap.exists ? (snap.data() || {}) : {};
      existingProfile = userData.profile || {};
      existingAccess = userData.access || {};
      if (existingAccess.banned) throw new Error('Account bloccato. Solo l’admin può sbloccarlo.');
      const blockedMap = existingAccess.courseBlocked || {};
      const blockedCourse = requestedCourses.find((course) => blockedMap[course] === true);
      if (blockedCourse) throw new Error(`Accesso non richiedibile: il corso ${COURSE_LABELS[blockedCourse]} è stato bloccato dall’admin.`);
      firstName = firstName || String(existingProfile.firstName || '').trim();
      lastName = lastName || String(existingProfile.lastName || '').trim();
      email = email || String(existingProfile.email || '').toLowerCase().trim();
      const courseAccess = existingAccess.courseAccess || {};
      const hasLegacyIstruttoreAccess = existingAccess.appVerified === true && Object.keys(courseAccess).length === 0;
      const alreadyAllowed = requestedCourses.every((course) => courseAccess[course] === true || (course === 'istruttore' && hasLegacyIstruttoreAccess));
      if (alreadyAllowed) throw new Error('Hai già accesso a questo corso.');
    } else {
      email = String(body.email || '').toLowerCase().trim();
      const password = String(body.password || '');
      if (!firstName || !lastName || !email || !password) throw new Error('Nome, cognome, email e password sono obbligatori.');
      if (password.length < 6) throw new Error('La password deve avere almeno 6 caratteri.');
      // Crea l'utente e lo fa entrare subito: le scritture qui sotto sono "sue"
      const credential = await auth().createUserWithEmailAndPassword(email, password);
      user = credential.user;
      try { await user.updateProfile({ displayName: `${firstName} ${lastName}`.trim() }); } catch { /* non indispensabile */ }
    }

    const uid = user.uid;
    if (!uid || !email) throw new Error('Impossibile identificare l’utente.');

    // Richiesta già in corso per lo stesso corso?
    const existingReqSnap = await db().collection('accountRequests').where('uid', '==', uid).limit(50).get();
    let duplicate = false;
    existingReqSnap.forEach((doc) => {
      const r = doc.data() || {};
      if (['pending', 'review'].includes(r.status || 'pending') && overlaps(r.requestedCourses || [], requestedCourses)) duplicate = true;
    });
    if (duplicate) throw new Error('Richiesta già inviata: attendi l’approvazione.');

    const existingHasCourse = hasAnyApprovedCourse(existingAccess);
    const status = reviewRequest ? 'review' : 'pending';
    const source = reviewRequest ? `course-review-${VERSION}` : (isExistingSignedInUser ? `course-access-request-${VERSION}` : `account-request-${VERSION}`);
    const pendingCourses = unionWithoutAllowed(existingAccess.pendingCourses, requestedCourses, existingAccess);

    // Solo le chiavi che l'utente può scrivere da sé (vedi regole): mai permessi.
    const accessPatch = {
      pendingCourses,
      pendingAt: now(),
      courseRequestStatus: Object.fromEntries(requestedCourses.map((c) => [c, status])),
      courseCanRequestReview: Object.fromEntries(requestedCourses.map((c) => [c, remove()]))
    };
    accessPatch.courseReviewPending = Object.fromEntries(requestedCourses.map((c) => [c, reviewRequest ? true : remove()]));
    if (!existingHasCourse) {
      accessPatch.accountStatus = status;
      accessPatch.reviewPending = reviewRequest;
      accessPatch.reviewRequestedAt = reviewRequest ? now() : remove();
    }

    const fullFirst = firstName || existingProfile.firstName || '';
    const fullLast = lastName || existingProfile.lastName || '';
    const profilePatch = {
      uid,
      email,
      firstName: fullFirst,
      lastName: fullLast,
      displayName: `${fullFirst} ${fullLast}`.trim(),
      updatedAt: now()
    };
    if (!isExistingSignedInUser) profilePatch.createdAt = now();

    const requestRef = db().collection('accountRequests').doc();
    const batch = db().batch();
    batch.set(db().collection('users').doc(uid), { profile: profilePatch, access: accessPatch }, { merge: true });
    batch.set(requestRef, {
      uid,
      firstName: fullFirst,
      lastName: fullLast,
      email,
      requestedCourses,
      message,
      status,
      source,
      reviewRequest,
      isCourseAccessRequest: existingHasCourse,
      previousRejectNote: String(existingAccess.lastRejectNote || ''),
      previousCourseRejectNotes: existingAccess.courseRejectNotes || {},
      previousRejectedAt: existingAccess.lastRejectedAt || null,
      rejectedCount: Number(existingAccess.rejectedCount || 0),
      createdAt: now(),
      updatedAt: now()
    });
    await batch.commit();
    return { ok: true, uid, requestId: requestRef.id, status };
  }

  /* ---------------- Termini ---------------- */
  async function acceptTerms() {
    const user = requireUser();
    await db().collection('users').doc(user.uid).set({
      access: { termsAcceptedAt: now(), termsVersion: `${VERSION}-legal-placeholder` }
    }, { merge: true });
    return { ok: true };
  }

  /* ---------------- Email verificata ---------------- */
  async function completeVerification() {
    const user = requireUser();
    await user.reload();
    // Token aggiornato: le regole controllano che l'email risulti verificata
    await user.getIdToken(true);
    const fresh = auth().currentUser || user;
    if (!fresh.emailVerified) throw new Error('Email non ancora verificata. Dopo aver cliccato il link, torna sul sito e riprova.');
    const ref = db().collection('users').doc(fresh.uid);
    const snap = await ref.get();
    const access = snap.exists ? (snap.data()?.access || {}) : {};
    if (access.banned) throw new Error('Account bloccato.');
    if (access.appVerified !== true) throw new Error('Account non ancora approvato dall’admin.');
    await ref.set({
      profile: { emailVerified: true, updatedAt: now() },
      access: { requiresEmailVerification: false, verificationRequiredVersion: remove(), emailVerifiedAt: now() }
    }, { merge: true });
    const updated = await ref.get();
    return { ok: true, user: updated.exists ? updated.data() : null };
  }

  /* ---------------- Admin: approva ---------------- */
  async function findUserUid(request) {
    if (request.uid) return String(request.uid);
    const email = String(request.email || '').toLowerCase().trim();
    if (!email) return '';
    const snap = await db().collection('users').where('profile.email', '==', email).limit(1).get();
    let uid = '';
    snap.forEach((doc) => { uid = uid || doc.id; });
    return uid;
  }

  async function approveAccountRequest(body = {}) {
    const admin = requireUser();
    const requestId = String(body.requestId || '');
    if (!requestId) throw new Error('requestId mancante');
    const approvedCourses = normalizeCourses(body.approvedCourses);
    if (!approvedCourses.length) throw new Error('Seleziona almeno un corso da abilitare.');

    const reqRef = db().collection('accountRequests').doc(requestId);
    const reqSnap = await reqRef.get();
    if (!reqSnap.exists) throw new Error('Richiesta non trovata');
    const r = reqSnap.data() || {};
    const email = String(r.email || '').toLowerCase().trim();
    if (!email) throw new Error('Email richiesta mancante');
    const uid = await findUserUid(r);
    if (!uid) throw new Error('Utente non trovato: chiedi all’utente di rifare la richiesta dal sito.');

    const userRef = db().collection('users').doc(uid);
    const userSnap = await userRef.get();
    const userData = userSnap.exists ? (userSnap.data() || {}) : {};
    const access = userData.access || {};
    const profile = userData.profile || {};
    const hadApprovedCourse = hasAnyApprovedCourse(access);

    const courseAccess = {};
    // Utenti vecchi: appVerified + courseAccess vuoto significava accesso Istruttore
    if (access.appVerified === true && Object.keys(access.courseAccess || {}).length === 0) courseAccess.istruttore = true;
    approvedCourses.forEach((course) => { courseAccess[course] = true; });

    const requestedCourses = normalizeCourses(r.requestedCourses);
    const rejectedCourses = requestedCourses.filter((course) => !approvedCourses.includes(course));
    const pendingCourses = removeCourses(access.pendingCourses, requestedCourses);

    // Mappe per corso: tolgo i corsi approvati, segno quelli non approvati
    const MAPS = ['courseRequestStatus', 'courseReviewPending', 'courseCanRequestReview', 'courseRejectNotes', 'courseBlocked'];
    let finalMaps = {};
    MAPS.forEach((name) => {
      const map = { ...(access[name] || {}) };
      approvedCourses.forEach((course) => { delete map[course]; });
      finalMaps[name] = map;
    });
    if (rejectedCourses.length) {
      finalMaps = markRejectedCourses({ ...access, ...finalMaps }, rejectedCourses, 'Accesso non approvato dall’admin in questa richiesta.', Boolean(r.reviewRequest || r.status === 'review'));
    }

    const nowHasApprovedCourse = approvedCourses.length > 0 || hadApprovedCourse;
    const mustVerifyEmail = !hadApprovedCourse && profile.emailVerified !== true;
    const accessPatch = {
      appVerified: nowHasApprovedCourse,
      banned: false,
      accountStatus: nowHasApprovedCourse ? 'approved' : 'pending',
      courseAccess,
      approvedCourses: [...new Set([...(access.approvedCourses || []), ...approvedCourses])],
      approvedBy: admin.uid,
      approvedAt: now(),
      pendingCourses: pendingCourses.length ? pendingCourses : remove(),
      pendingAt: pendingCourses.length ? (access.pendingAt || now()) : remove(),
      reviewPending: false,
      reviewRequestedAt: remove(),
      canRequestReview: remove(),
      requiresEmailVerification: mustVerifyEmail,
      verificationRequiredVersion: mustVerifyEmail ? 'v24' : remove()
    };
    putMapChanges(accessPatch, access, finalMaps);

    const batch = db().batch();
    batch.set(userRef, {
      profile: {
        uid,
        email,
        firstName: r.firstName || profile.firstName || '',
        lastName: r.lastName || profile.lastName || '',
        displayName: profile.displayName || `${r.firstName || ''} ${r.lastName || ''}`.trim(),
        updatedAt: now()
      },
      access: accessPatch
    }, { merge: true });
    batch.delete(reqRef);
    await batch.commit();
    return { ok: true, uid, approvedCourses, rejectedCourses, requestRemoved: true, emailVerificationRequired: mustVerifyEmail };
  }

  /* ---------------- Admin: rifiuta ---------------- */
  async function rejectAccountRequest(body = {}) {
    const admin = requireUser();
    const requestId = String(body.requestId || '');
    if (!requestId) throw new Error('requestId mancante');
    const reqRef = db().collection('accountRequests').doc(requestId);
    const reqSnap = await reqRef.get();
    if (!reqSnap.exists) throw new Error('Richiesta non trovata');
    const data = reqSnap.data() || {};
    const reason = String(body.note || '').trim() || 'Richiesta non approvata';
    const requestedCourses = normalizeCourses(data.requestedCourses);

    let finalBan = Boolean(data.reviewRequest || data.status === 'review');
    let courseOnly = false;
    let courseBlocked = false;
    const batch = db().batch();
    const uid = await findUserUid(data);

    if (uid) {
      const userRef = db().collection('users').doc(uid);
      const userSnap = await userRef.get();
      const access = userSnap.exists ? (userSnap.data()?.access || {}) : {};
      const hasApproved = hasAnyApprovedCourse(access);

      if (hasApproved) {
        // Utente già dentro almeno un corso: si rifiuta solo il corso richiesto
        courseOnly = true;
        const definitive = Boolean(data.reviewRequest || data.status === 'review');
        const finalMaps = markRejectedCourses(access, requestedCourses, reason, definitive);
        courseBlocked = requestedCourses.some((course) => finalMaps.courseBlocked?.[course] === true);
        const pendingCourses = removeCourses(access.pendingCourses, requestedCourses);
        const accessPatch = {
          appVerified: true,
          banned: false,
          accountStatus: 'approved',
          pendingCourses: pendingCourses.length ? pendingCourses : remove(),
          pendingAt: pendingCourses.length ? (access.pendingAt || now()) : remove(),
          reviewPending: false,
          reviewRequestedAt: remove(),
          lastCourseRejectedAt: now(),
          lastCourseRejectedBy: admin.uid,
          lastCourseRejectNote: reason,
          lastRejectedCourses: requestedCourses
        };
        putMapChanges(accessPatch, access, finalMaps);
        batch.set(userRef, { access: accessPatch }, { merge: true });
      } else {
        // Il numero di rifiuti vero lo legge l'admin dal profilo, non dalla richiesta
        if (Number(access.rejectedCount || 0) >= 1) finalBan = true;
        if (finalBan) {
          batch.set(userRef, {
            access: {
              appVerified: false,
              banned: true,
              accountStatus: 'banned',
              banReason: reason,
              bannedBy: admin.uid,
              bannedAt: now(),
              secondRejectedAt: now(),
              secondRejectNote: reason,
              reviewPending: false,
              pendingCourses: remove(),
              pendingAt: remove()
            }
          }, { merge: true });
        } else {
          batch.set(userRef, {
            access: {
              appVerified: false,
              accountStatus: 'rejected',
              pendingCourses: remove(),
              pendingAt: remove(),
              reviewPending: false,
              canRequestReview: true,
              rejectedCount: Number(access.rejectedCount || 0) + 1,
              lastRejectedAt: now(),
              lastRejectedBy: admin.uid,
              lastRejectNote: reason,
              lastRejectedCourses: requestedCourses
            }
          }, { merge: true });
        }
      }
    }
    batch.delete(reqRef);
    await batch.commit();
    return { ok: true, requestRemoved: true, banned: finalBan && !courseOnly, courseOnly, courseBlocked };
  }

  /* ---------------- Punto di ingresso ---------------- */
  const ACTIONS = {
    'create-account-request': createAccountRequest,
    'accept-terms': acceptTerms,
    'complete-verification': completeVerification,
    'approve-account-request': approveAccountRequest,
    'reject-account-request': rejectAccountRequest
  };

  async function call(name, body) {
    const action = ACTIONS[name];
    if (!action) throw new Error(`Operazione sconosciuta: ${name}`);
    try {
      return await action(body || {});
    } catch (error) {
      throw friendlyError(error);
    }
  }

  window.QuizAccount = Object.freeze({ call, COURSE_LABELS });
})();
