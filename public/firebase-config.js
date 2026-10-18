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

    window.FirebaseQuiz = {
      configured: true,
      auth: firebase.auth(),
      db: firebase.firestore(),
      googleProvider: new firebase.auth.GoogleAuthProvider(),
      error: null
    };

    console.log("Firebase configurato correttamente.");
  } catch (error) {
    window.FirebaseQuiz.error = error;
    console.error("Errore Firebase:", error);
  }
})();