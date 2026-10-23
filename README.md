# Quiz Nuoto

Allenamento agli esami dei corsi **Istruttore di Nuoto**, **Assistenti Bagnanti Piscina** e **Arte**.
Sito: **https://quiznuoto.web.app** (Firebase Hosting, progetto Firebase `quiz-fin`, piano gratuito Spark).

## Com'è fatto

```
public/                  il sito (è l'unica cartella che finisce online)
firestore.rules          regole del database: chi può leggere e scrivere cosa
firebase.json            impostazioni di Firebase Hosting (sito "quiznuoto", cache, intestazioni)
test-regole/             prove automatiche delle regole (emulatore, nessun dato vero)
notifiche/               invio delle notifiche push (gira su GitHub ogni 10 minuti circa)
.github/workflows/       pubblicazione automatica e invio notifiche
dati/                    banca domande sorgente, script e report di validazione (non pubblicati)
```

Non ci sono più funzioni server: le operazioni sugli account (richiesta account o corso, ricontrollo,
termini, verifica email, approvazioni e rifiuti dell'admin) sono in `public/account-actions.js` e girano nel
browser. La sicurezza la garantiscono le regole in `firestore.rules`: un utente può scrivere i suoi dati di
studio e lo stato delle sue richieste, mai i suoi permessi (accesso ai corsi, blocchi, rifiuti), che restano
dell'admin.

## Pubblicazione automatica

A ogni modifica su `main` di `public/`, `firestore.rules`, `firebase.json`, `test-regole/` o `notifiche/`, GitHub Actions:

1. prova le regole con l'emulatore di Firestore usando il vero codice del sito;
2. se le prove passano, pubblica il sito su quiznuoto.web.app e aggiorna le regole del database.

Si vede tutto nella scheda **Actions** del repository. In emergenza si può pubblicare anche con le prove
fallite: Actions → "Pubblica Quiz Nuoto" → Run workflow → spunta "Pubblica anche se…".

### Configurazione (una volta sola)

1. **Chiave dell'account di servizio**: Firebase Console → progetto `quiz-fin` → ⚙️ Impostazioni progetto →
   Account di servizio → **Genera nuova chiave privata** (scarica un file JSON).
2. **Permessi**: [Google Cloud Console → IAM](https://console.cloud.google.com/iam-admin/iam?project=quiz-fin) →
   matita accanto a `firebase-adminsdk-…@quiz-fin.iam.gserviceaccount.com` → aggiungi il ruolo **Firebase Admin** → Salva.
3. **Secret su GitHub**: questo repository → Settings → Secrets and variables → Actions → New repository secret →
   nome `FIREBASE_SERVICE_ACCOUNT`, valore = tutto il contenuto del file JSON. Poi cancella il file dal computer.
4. **Dominio autorizzato per l'accesso**: Firebase Console → Authentication → Impostazioni → Domini autorizzati →
   controlla che ci sia `quiznuoto.web.app` (se manca: Aggiungi dominio).
5. Actions → "Pubblica Quiz Nuoto" → **Run workflow**.

Il sito `quiznuoto` viene creato da solo al primo giro se non esiste (si può anche creare a mano:
Firebase Console → Hosting → Aggiungi un altro sito).

## Notifiche push

Al primo accesso dopo l'aggiornamento compare una volta il popup "Abbiamo aggiunto le notifiche"; poi si
gestiscono da **Account** (attiva/disattiva, promemoria streak). Su iPhone e iPad funzionano solo dall'app
aggiunta alla schermata Home. Il dispositivo si salva in `users/{uid}.push`.

In **Account** ci sono anche nome e cognome (aggiornano profilo e classifiche) e la password: si cambia
scrivendo quella attuale, oppure con l'email di reimpostazione; chi entra con Google può crearne una.

Il lavoro **Notifiche** (`.github/workflows/notifiche.yml`, codice in `notifiche/`) gira da solo ogni 10 minuti
circa con lo stesso secret `FIREBASE_SERVICE_ACCOUNT` e:

- manda le notifiche che l'admin mette in coda dal pannello (sezione **Notifiche**: a tutti, a un corso o a un
  utente) — collezione `pushQueue`;
- agli orari scelti dall'admin (predefiniti 18:00 e 21:00, ora italiana) avvisa chi ha un obiettivo e non l'ha
  ancora raggiunto oggi: quante domande mancano, quanto tempo resta fino a mezzanotte e a quanto scende la
  streak se salta il giorno;
- toglie da solo i dispositivi non più validi.

- avvisa gli admin (e solo loro) quando arriva una richiesta di account, di accesso a un corso o di ricontrollo
  (si può spegnere dal pannello, sezione Notifiche → Avvisi per l'admin).

Per mandare subito senza aspettare: Actions → "Notifiche" → **Run workflow** (con la spunta parte anche il
promemoria streak).

**Importante:** GitHub fa partire da solo i lavori programmati molto meno spesso di quanto chiesto (in pratica
ogni 2–4 ore). Per avere notifiche puntuali basta farlo avviare ogni 5 minuti da un servizio gratuito:

1. GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token:
   solo il repository `quizfin`, permesso **Actions: Read and write**, scadenza la più lunga.
2. [cron-job.org](https://cron-job.org) → Create cronjob → URL
   `https://api.github.com/repos/ChXxXxX9/quizfin/actions/workflows/notifiche.yml/dispatches`, ogni 5 minuti.
   In *Advanced*: metodo **POST**, intestazioni `Authorization: Bearer <token>`,
   `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`, corpo `{"ref":"main"}`.
   *Test run* deve rispondere 204.

Se l'invio dà errore di permessi, in [Google Cloud → API](https://console.cloud.google.com/apis/library/fcm.googleapis.com?project=quiz-fin)
controlla che **Firebase Cloud Messaging API** sia attiva. Prove della logica: `npm --prefix notifiche test`.

## Aggiornare il sito

Modifica i file dentro `public/` (o sostituiscili con quelli di una nuova versione) e fai commit su `main`.
Il sito si apre dalla cache del telefono (service worker) per essere istantaneo: a ogni pubblicazione il lavoro
aggiunge da solo il codice del commit a `CACHE_NAME`, quindi telefoni e app installate prendono la versione nuova
al massimo dalla pagina successiva, senza doverlo cambiare a mano.

## Prove in locale (facoltativo)

Servono Node 22+ (meglio l'ultima 22.x o 24.x: la 20 non riceve più correzioni di sicurezza) e Java 21:

```bash
npm install --prefix test-regole --ignore-scripts
npx firebase-tools@15.33.0 emulators:exec --only firestore --project demo-quiz-nuoto "npm --prefix test-regole test"
```

## Addio a Netlify

- La cartella "netlify-addio" (consegnata a parte) va pubblicata **una volta** sul vecchio sito Netlify:
  chi apre il vecchio indirizzo o la vecchia app installata viene portato su quiznuoto.web.app.
- Dopo qualche settimana si può eliminare il sito su Netlify.
- Su Netlify c'erano le variabili `FIREBASE_PRIVATE_KEY`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PROJECT_ID`
  (e forse `RESEND_API_KEY`): eliminale e, in Google Cloud → IAM → Account di servizio → Chiavi, elimina la
  vecchia chiave che usava Netlify.
- In Authentication → Domini autorizzati si può togliere il vecchio dominio `.netlify.app`.

Lo storico delle versioni precedenti è in `dati/STORICO-VERSIONI.md`.
