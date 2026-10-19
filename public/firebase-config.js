/*
  Firebase config per Quiz Nuoto.
  Non usare import.
  Questo file funziona con Firebase caricato tramite script CDN nell'HTML.
*/

(function () {
  const firebaseConfig = {
    apiKey: "AIzaSyB5bAu2rxrJaXi7Fe6xA9mjwqL5YxZaPM8",
    authDomain: "quiz-fin.firebaseapp.com",
    projectId: "quiz-fin",
    storageBucket: "quiz-fin.firebasestorage.app",
    messagingSenderId: "482992802987",
    appId: "1:482992802987:web:238900842defdaae31fbee",
    measurementId: "G-26347GS765"
  };

  const isConfigured = Boolean(
    firebaseConfig.apiKey &&
    firebaseConfig.authDomain &&
    firebaseConfig.projectId
  );

  window.FirebaseQuiz = {
    configured: false,
    auth: null,
    db: null,
    googleProvider: null,
    error: null
  };

  if (!isConfigured) {
    console.warn("Firebase non configurato: uso salvataggio locale.");
    return;
  }

  if (typeof firebase === "undefined") {
    window.FirebaseQuiz.error = "Firebase SDK non caricato.";
    console.error("Firebase SDK non caricato. Controlla gli script CDN nell'HTML.");
    return;
  }

  try {
    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }

    const auth = firebase.auth();

    // Accesso più rapido su telefono e Safari: di serie Firebase, prima di dire chi è collegato,
    // aspetta di aver caricato i servizi Google per l'accesso con Google (script esterno + iframe).
    // Con rete lenta o un blocco pubblicità questo teneva la schermata di accesso visibile per
    // secondi (a volte decine), anche con l'utente già collegato. Ora lo stato dell'accesso arriva
    // subito e i servizi Google si preparano dopo, solo quando servono (pulsante "Continua con Google").
    const delegate = auth._delegate || null;
    const resolver = delegate && delegate._popupRedirectResolver;
    try {
      if (resolver && '_shouldInitProactively' in resolver) {
        Object.defineProperty(resolver, '_shouldInitProactively', { configurable: true, get: () => false });
      }
    } catch (e) { /* versione diversa dell'SDK: resta il comportamento di serie */ }
    let warmed = null;
    const warmPopup = () => {
      if (warmed || !resolver || typeof resolver._initialize !== 'function') return warmed;
      try { warmed = Promise.resolve(resolver._initialize(delegate)).catch(() => { warmed = null; }); } catch (e) { warmed = null; }
      return warmed;
    };

    // Ricordiamo sul dispositivo se c'era un accesso: le pagine mostrano "Accesso in corso…"
    // invece del modulo di accesso mentre Firebase recupera la sessione.
    const HINT = 'quizNuotoAuthHint';
    let likelySignedIn = false;
    try { likelySignedIn = localStorage.getItem(HINT) === '1'; } catch (e) { /* niente */ }
    auth.onAuthStateChanged((user) => {
      try { if (user) localStorage.setItem(HINT, '1'); else localStorage.removeItem(HINT); } catch (e) { /* niente */ }
      if (!user) setTimeout(warmPopup, 600);
    });

    const db = firebase.firestore();
    // Il documento dell'utente serve a più pezzi della pagina (notifiche, account…):
    // una sola lettura condivisa invece di tante uguali nello stesso momento.
    const userDocCache = new Map();
    const getUserDoc = (uid, maxAgeMs = 5000) => {
      const hit = userDocCache.get(uid);
      if (hit && Date.now() - hit.at < maxAgeMs) return hit.promise;
      const promise = db.collection('users').doc(uid).get();
      userDocCache.set(uid, { at: Date.now(), promise });
      promise.catch(() => userDocCache.delete(uid));
      return promise;
    };

    window.FirebaseQuiz = {
      configured: true,
      auth,
      db,
      getUserDoc,
      googleProvider: new firebase.auth.GoogleAuthProvider(),
      likelySignedIn,
      warmPopup,
      error: null
    };

    console.log("Firebase configurato correttamente.");
  } catch (error) {
    window.FirebaseQuiz.error = error;
    console.error("Errore Firebase:", error);
  }
})();