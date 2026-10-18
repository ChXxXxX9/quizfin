// Accesso alle API Google (Firestore, FCM, Identity Toolkit) con l'account di servizio Firebase,
// senza librerie esterne: firmiamo noi il JWT e chiediamo il token di accesso.
import { createSign } from 'node:crypto';

const SCOPE = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/firebase.messaging',
  'https://www.googleapis.com/auth/datastore',
].join(' ');

export function leggiAccountServizio(json) {
  if (!json) throw new Error('Manca FIREBASE_SERVICE_ACCOUNT (il file JSON dell\'account di servizio).');
  let dati;
  try {
    dati = JSON.parse(json);
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT non è un JSON valido.');
  }
  for (const campo of ['client_email', 'private_key', 'project_id']) {
    if (!dati[campo]) throw new Error(`FIREBASE_SERVICE_ACCOUNT: manca il campo ${campo}.`);
  }
  return dati;
}

function b64url(oggetto) {
  return Buffer.from(JSON.stringify(oggetto)).toString('base64url');
}

export function creaGestoreToken(account, { fetchFn = fetch } = {}) {
  let token = null;
  let scade = 0;
  return async function ottieniToken() {
    const ora = Math.floor(Date.now() / 1000);
    if (token && ora < scade - 120) return token;
    const intestazione = { alg: 'RS256', typ: 'JWT' };
    const richiesta = {
      iss: account.client_email,
      scope: SCOPE,
      aud: account.token_uri || 'https://oauth2.googleapis.com/token',
      iat: ora,
      exp: ora + 3600,
    };
    const daFirmare = `${b64url(intestazione)}.${b64url(richiesta)}`;
    const firma = createSign('RSA-SHA256').update(daFirmare).sign(account.private_key, 'base64url');
    const risposta = await fetchFn(richiesta.aud, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${daFirmare}.${firma}`,
      }),
    });
    if (!risposta.ok) {
      throw new Error(`Accesso Google non riuscito (${risposta.status}): ${await risposta.text()}`);
    }
    const dati = await risposta.json();
    token = dati.access_token;
    scade = ora + (dati.expires_in ?? 3600);
    return token;
  };
}

/** fetch con token Google e messaggi d'errore leggibili. */
export function creaClientGoogle(ottieniToken, { fetchFn = fetch } = {}) {
  return async function chiamaGoogle(url, { method = 'GET', body, consenti404 = false } = {}) {
    const risposta = await fetchFn(url, {
      method,
      headers: {
        authorization: `Bearer ${await ottieniToken()}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (consenti404 && risposta.status === 404) return null;
    const testo = await risposta.text();
    const dati = testo ? JSON.parse(testo) : {};
    if (!risposta.ok) {
      const errore = new Error(`${method} ${url} -> ${risposta.status}: ${dati?.error?.message ?? testo}`);
      errore.status = risposta.status;
      errore.dati = dati;
      throw errore;
    }
    return dati;
  };
}
