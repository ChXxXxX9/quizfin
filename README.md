# Quiz Nuoto

Allenamento agli esami dei corsi **Istruttore di Nuoto**, **Assistenti Bagnanti Piscina** e **Arte**.
Sito: **https://quiznuoto.web.app** (Firebase Hosting, progetto Firebase `quiz-fin`, piano gratuito Spark).

## Com'è fatto

```
public/                  il sito (è l'unica cartella che finisce online)
firestore.rules          regole del database: chi può leggere e scrivere cosa
firebase.json            impostazioni di Firebase Hosting (sito "quiznuoto", cache, intestazioni)
test-regole/             prove automatiche delle regole (emulatore, nessun dato vero)
.github/workflows/       pubblicazione automatica
dati/                    banca domande sorgente, script e report di validazione (non pubblicati)
```

Non ci sono più funzioni server: le operazioni sugli account (richiesta account o corso, ricontrollo,
termini, verifica email, approvazioni e rifiuti dell'admin) sono in `public/account-actions.js` e girano nel
browser. La sicurezza la garantiscono le regole in `firestore.rules`: un utente può scrivere i suoi dati di
studio e lo stato delle sue richieste, mai i suoi permessi (accesso ai corsi, blocchi, rifiuti), che restano
dell'admin.

## Pubblicazione automatica

A ogni modifica su `main` di `public/`, `firestore.rules`, `firebase.json` o `test-regole/`, GitHub Actions:

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

## Aggiornare il sito

Modifica i file dentro `public/` (o sostituiscili con quelli di una nuova versione) e fai commit su `main`.
Ricordati di cambiare `CACHE_NAME` in `public/service-worker.js` a ogni versione, così telefoni e app
installate scaricano subito la nuova grafica.

## Prove in locale (facoltativo)

Servono Node 20+ e Java 21:

```bash
npm install --prefix test-regole
npx firebase-tools emulators:exec --only firestore --project demo-quiz-nuoto "npm --prefix test-regole test"
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
