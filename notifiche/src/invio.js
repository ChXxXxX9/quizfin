// Invio delle notifiche push con Firebase Cloud Messaging (API HTTP v1).

const ERRORI_TOKEN = new Set(['UNREGISTERED', 'INVALID_ARGUMENT', 'NOT_FOUND', 'SENDER_ID_MISMATCH']);

function codiceErroreFcm(errore) {
  const dettagli = errore?.dati?.error?.details ?? [];
  for (const d of dettagli) if (d.errorCode) return d.errorCode;
  return errore?.dati?.error?.status ?? null;
}

export function creaInvio({ chiamaGoogle, progetto }) {
  return {
    /** 'ok' | 'token-non-valido' | 'errore' */
    async push(token, { titolo, corpo, url, tag, ttlSecondi = 172800 }) {
      try {
        await chiamaGoogle(`https://fcm.googleapis.com/v1/projects/${progetto}/messages:send`, {
          method: 'POST',
          body: {
            message: {
              token,
              // Solo "data": la notifica la mostra il service worker del sito (service-worker.js)
              data: { titolo: String(titolo), corpo: String(corpo), url: String(url || './index.html'), tag: String(tag || '') },
              webpush: { headers: { Urgency: 'high', TTL: String(Math.max(60, Math.round(ttlSecondi))) } }
            }
          }
        });
        return 'ok';
      } catch (e) {
        const codice = codiceErroreFcm(e);
        if (e.status === 404 || (e.status === 400 && ERRORI_TOKEN.has(codice))) return 'token-non-valido';
        console.error(`Push non inviata: ${e.message}`);
        return 'errore';
      }
    }
  };
}

/** Esegue le promesse con al massimo `n` in parallelo. */
export async function inParallelo(elementi, n, funzione) {
  const risultati = new Array(elementi.length);
  let prossimo = 0;
  async function lavoratore() {
    while (prossimo < elementi.length) {
      const i = prossimo++;
      risultati[i] = await funzione(elementi[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, elementi.length) }, lavoratore));
  return risultati;
}
