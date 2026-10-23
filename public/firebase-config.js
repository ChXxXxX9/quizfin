/*
  Firebase config per Quiz Nuoto.
  Non usare import.
  Questo file funziona con Firebase caricato tramite script CDN nell'HTML.
*/

(function () {
  // Messaggi d'errore in italiano comprensibile (al posto di "Firebase: Error (auth/...)")
  const MESSAGGI = {
    'auth/invalid-credential': 'Email o password non corrette.',
    'auth/invalid-login-credentials': 'Email o password non corrette.',
    'auth/wrong-password': 'Email o password non corrette.',
    'auth/user-not-found': 'Non esiste un account con questa email.',
    'auth/invalid-email': 'L’email non è scritta correttamente.',
    'auth/missing-password': 'Scrivi la password.',
    'auth/missing-email': 'Scrivi l’email.',
    'auth/too-many-requests': 'Troppi tentativi: aspetta qualche minuto e riprova.',
    'auth/network-request-failed': 'Connessione assente o instabile: controlla la rete e riprova.',
    'auth/user-disabled': 'Questo account è disattivato: contatta lo staff.',
    'auth/email-already-in-use': 'Esiste già un account con questa email: accedi invece di registrarti.',
    'auth/weak-password': 'La password è troppo debole: usa almeno 6 caratteri.',
    'auth/popup-closed-by-user': 'Accesso con Google annullato.',
    'auth/cancelled-popup-request': 'Accesso con Google annullato.',
    'auth/popup-blocked': 'Il browser ha bloccato la finestra di Google: consenti i popup e riprova.',
    'auth/unauthorized-domain': 'L’accesso con Google non è attivo per questo indirizzo: avvisa lo staff.',
    'auth/operation-not-allowed': 'Questo tipo di accesso non è attivo: avvisa lo staff.',
    'auth/account-exists-with-different-credential': 'Questa email è già registrata con un altro metodo di accesso (email e password oppure Google).',
    'auth/credential-already-in-use': 'Questo account Google è già collegato a un altro utente.',
    'auth/requires-recent-login': 'Per sicurezza esci, rientra e riprova.',
    'auth/internal-error': 'Errore temporaneo dell’accesso: riprova tra poco.',
    'auth/web-storage-unsupported': 'Il browser blocca i dati del sito (navigazione privata?): non si può restare collegati.',
    'auth/user-token-expired': 'La sessione è scaduta: accedi di nuovo.',
    'auth/expired-action-code': 'Il link è scaduto: chiedine uno nuovo.',
    'auth/invalid-action-code': 'Il link non è più valido: chiedine uno nuovo.',
    'permission-denied': 'Operazione non permessa per questo account.',
    'unavailable': 'Server non raggiungibile: controlla la connessione e riprova.',
    'resource-exhausted': 'Il sito ha raggiunto il limite di uso per oggi: riprova più tardi.',
    'deadline-exceeded': 'Il server ci sta mettendo troppo: riprova.',
    'unauthenticated': 'La sessione è scaduta: accedi di nuovo.'
  };
  window.QuizErrors = {
    text(error) {
      const code = String(error?.code || '').replace(/^firestore\//, '');
      if (MESSAGGI[code]) return MESSAGGI[code];
      const msg = String(error?.message || error || 'Operazione non riuscita.');
      const found = msg.match(/\((auth\/[a-z-]+)\)/);
      if (found && MESSAGGI[found[1]]) return MESSAGGI[found[1]];
      return msg.replace(/^Firebase:\s*/, '').replace(/\s*\((auth|firestore)\/[a-z-]+\)\.?$/, '').trim() || 'Operazione non riuscita.';
    }
  };

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

  // Prove automatiche: solo sul computer di prova (localhost) e solo se richiesto, il sito usa gli
  // emulatori di Firebase invece del database vero. Sul sito pubblicato questo non succede mai.
  let emulatori = false;
  try {
    emulatori = ['localhost', '127.0.0.1'].includes(location.hostname) && localStorage.getItem('quizNuotoEmulatori') === '1';
  } catch (e) { /* niente */ }
  if (emulatori) firebaseConfig.projectId = 'demo-quiz-nuoto';

  try {
    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }

    const auth = firebase.auth();
    if (emulatori) {
      auth.useEmulator('http://127.0.0.1:9099', { disableWarnings: true });
      firebase.firestore().useEmulator('127.0.0.1', 8080);
    }

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