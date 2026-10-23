# Quiz Istruttore di Nuoto

Sito statico a budget zero per esercitarsi sulle 1000 domande.

## File principali

- `index.html` - interfaccia del sito
- `style.css` - stile chiaro/scuro in stile app moderna
- `app.js` - logica quiz, progressi, statistiche, salvataggi
- `questions.js` - banca dati caricata dal browser
- `questions.json` - banca dati in formato JSON
- `firebase-config.js` - configurazione Firebase
- `firestore.rules` - regole di sicurezza consigliate
- `extract_questions.py` - script usato per rigenerare `questions.js` dai PDF
- `validation_report.json` - report di controllo estrazione

## Validazione estrazione

Risultato generato:

- domande: 1000
- risposte correttore: 1000
- argomenti: 7
- domande senza risposta: 0
- risposte senza domanda: 0

Due anomalie di layout del PDF sono state gestite nello script senza cambiare il testo delle domande:

- domanda 833
- domanda 964

## Firebase

Il sito funziona anche senza Firebase, salvando tutto nel browser con `localStorage`.
Per avere account e sincronizzazione:

1. Crea un progetto Firebase.
2. Attiva Authentication.
3. Abilita i provider:
   - Email/Password
   - Google
4. Crea Firestore Database.
5. Incolla la configurazione Web in `firebase-config.js`.
6. Pubblica le regole contenute in `firestore.rules`.

## Deploy gratuito

Opzione semplice:

- carica tutti i file su GitHub
- attiva GitHub Pages dalla root del repository

Opzione Firebase:

- usa Firebase Hosting, sempre con file statici

## Note operative

- Le domande non vengono salvate su Firestore: sono nel file statico `questions.js`.
- Firestore salva solo dati utente: progressi, errori, statistiche, storico.
- Il quiz misto pesca fino a 7 domande per ciascuno dei 7 argomenti.
- I quiz per argomento pescano fino a 7 domande dall'argomento selezionato.
- Le domande sbagliate vengono rimosse quando vengono risposte correttamente.

## Aggiornamento funzioni

Questa versione aggiunge:
- timer opzionale prima di ogni quiz;
- tasto Suggerimento: elimina una risposta sbagliata, massimo una volta per domanda;
- penalità suggerimento: risposta corretta con suggerimento = 0,5 punti;
- simulazione esame da 50 domande, con suggerimento disattivato;
- domande segnate da rivedere;
- argomento con più errori nel singolo quiz misto;
- argomento con più errori nella totalità dei quiz misti;
- errori degli ultimi 5 quiz misti, con ripetizione della singola domanda;
- andamento voti e badge.

Per aggiornare Netlify: carica di nuovo questa cartella completa, non lo ZIP interno del vecchio deploy.

## Aggiornamento admin v5

File aggiunti/modificati:
- `admin.html`: pannello admin protetto.
- `admin.js`: gestione utenti, schede tecniche, blocco/sblocco, approvazione account, annunci.
- `firestore.rules`: regole aggiornate per admin, utenti e annunci.
- `app.js`: verifica email obbligatoria, reset password, reinvio verifica, controllo blocco account, annunci in home, accesso admin.

### Primo admin
L'owner è configurato con UID:

```text
uPsEYGwQwrXZEwt5KID6DnVt51p2
```

Quando questo account accede, il sito crea automaticamente il documento:

```text
admins/uPsEYGwQwrXZEwt5KID6DnVt51p2
```

### Verifica utenti
Firebase Auth non consente a una pagina client statica di impostare `emailVerified=true` su un utente: per quello servirebbe Firebase Admin SDK / backend.
Per restare a budget zero, il pannello admin usa una verifica interna dell'app:

```text
users/{uid}/access.appVerified = true
```

Questa approvazione permette all'utente di usare il quiz anche se non ha cliccato il link email.

### Regole Firestore
Dopo il deploy devi copiare il contenuto di `firestore.rules` in:

```text
Firebase Console → Firestore Database → Rules → Publish
```

## Versione v6

Aggiunte principali:

- Correzione domande dell'argomento **La Cultura dell’Acqua**: rimosso il prefisso `dell’acqua` dal testo della domanda.
- Nuova modalità **Flash card**: due risposte, allenamento infinito, feedback immediato dopo ogni risposta.
- Supporto PWA: `manifest.webmanifest`, `service-worker.js`, icone `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`.

### Installazione come app

- iPhone/iPad: apri il sito in Safari → Condividi → Aggiungi alla schermata Home.
- Android: apri il sito in Chrome → menu ⋮ → Installa app / Aggiungi a schermata Home.

## v19 - Multicorso + Assistenti Bagnanti Piscina

Aggiornamento principale:
- nuovo portale iniziale `index.html` con scelta corso;
- area `istruttore.html` per Istruttore di Nuoto;
- area `bagnino.html` per Assistenti Bagnanti Piscina;
- 573 domande Bagnino importate da `Quiz_Bagnino_Domande_Logiche(1).xlsx` e risposte da `Quiz_Bagnino_Risposte_Logiche(1).xlsx`;
- Esamone Bagnino: 30 domande casuali, 20 minuti, superato con almeno 27/30;
- richiesta account con password scelta dall’utente;
- rimosso il piano abbonamento Base/Gold/Diamond dal flusso richiesta;
- approvazione admin per singoli corsi: Istruttore, Bagnino, oppure entrambi;
- invio email automatico temporaneamente disattivato;
- dati Istruttore originali preservati: `questions.js`, `questions.json`, `explanations.js` invariati rispetto alla v18.

Nota deploy:
- Dopo il caricamento su Netlify, pubblicare anche le nuove `firestore.rules` su Firebase.
- Le variabili Firebase Admin restano necessarie per le Netlify Functions di approvazione/rifiuto.
- Le variabili Resend non sono più necessarie finché l’invio email resta disattivato.


## v20 - colori e scelta corso
- Istruttore: tema azzurro.
- Assistenti Bagnanti Piscina: tema rosso.
- Schermata iniziale dopo login: due grandi banner corso.
- Fix richiesta accesso corso da utenti già abilitati a un altro corso.
- Modale richiesta account scrollabile su mobile/tablet.
- Nessun file dati Istruttore modificato.

## v47 - Grafica "Cronometro" (riscritta da zero)

- `style.css`: sistema unico a livelli (`@layer reset, tokens, base, shell, components, views, utilities`). Colori in OKLCH generati da tinta (`--h`) e saturazione (`--c`) del corso: Istruttore blu, Bagnino rosso, Arte viola; il tema scuro cambia solo le luminosità.
- Motivo grafico: il cronometro da vasca (`.dial`), che mostra l'avanzamento del quiz misto.
- Navigazione: barra in basso su telefono, barra laterale a icone su tablet (≥768px), barra laterale con etichette su computer (≥1200px). Durante quiz, flash card e sudoku le barre spariscono (modalità focus).
- `shell.js`: solo presentazione (vista attiva, quadranti, tema di sistema, scorciatoie da tastiera A–D/1–4, Invio, ←, S, H, E, Esc, pannello account, avviso offline). Non legge né scrive dati.
- Caratteri locali in `assets/fonts` (TeX Gyre Adventor per l'interfaccia, TeX Gyre Schola per domande e spiegazioni; licenza GUST in `LICENSE-fonts.txt`).
- Tutti gli ID usati dagli script sono rimasti invariati.

## v48 - Promozione app Nuotifica

- `promo.js` + `promo.css` (+ grafica in `assets/nuotifica`): popup animato a tutto schermo che ogni utente vede **una sola volta** (la prima volta che entra nel portale o in un corso, mai durante un quiz) e banner fisso in cima a "I tuoi corsi".
- "Già visto" salvato nel profilo utente (`users/{uid}.profile.promoSeen.nuotifica_vN`) e sul dispositivo. Le regole Firestore esistenti lo permettono già (l'utente può scrivere il proprio `profile`).
- Impostazioni in `courseSettings/promo` (`bannerEnabled`, `popupEnabled`, `popupVersion`, `url`): si gestiscono dall'admin, scheda **Nuotifica** (attiva/disattiva banner e popup, "Mostralo di nuovo a tutti", link, anteprime). Se il documento non esiste, banner e popup sono attivi con il link https://nuotifica.web.app.

## v49 - Trasloco su Firebase Hosting

- Il sito è su **https://quiznuoto.web.app** (Firebase Hosting, piano gratuito), pubblicato da GitHub (repository `quizfin`).
- Niente più funzioni Netlify: le operazioni account sono in `account-actions.js` e girano nel browser; le regole Firestore (`firestore.rules`) impediscono agli utenti di darsi permessi da soli.
- Le regole ora permettono anche il salvataggio dei progressi del corso Istruttore nel documento utente.

## v54 - Domande Istruttore confrontate con i PDF originali (23/10/2026)

- Confronto completo delle 1000 domande con `2024_11_16_1000_Domande.pdf` e `2024_11_16_Correttore.pdf` (comprese le correzioni a mano del 16/11/2024): resoconto in `controllo_pdf_2026-10-23.json`.
- Lettere giuste: tutte uguali al correttore (le 22 correzioni erano già applicate). Domanda 964: nel correttore la risposta è cancellata; nel sito resta C ("La percezione dell'impedimento…"), come nel correttore prima della cancellatura.
- Corretti: 271 e 277 (118 → 112 come nel PDF), 275 e 285 (testo estraneo "112" in coda alla risposta D), spazi dopo i trattini e spazi doppi in 38 risposte. Spiegazioni 271, 275, 341 allineate (112).
