// Quiz Nuoto — invio notifiche (gira su GitHub Actions ogni 10 minuti).
// 1) manda le notifiche messe in coda dall'admin (collezione pushQueue);
// 2) agli orari scelti, manda il promemoria streak a chi non ha ancora fatto l'obiettivo di oggi.
import { leggiAccountServizio, creaGestoreToken, creaClientGoogle } from './google.js';
import { creaFirestore } from './firestore.js';
import { creaInvio, inParallelo } from './invio.js';
import { oraItaliana, promemoriaDovuto, promemoriaUtente, destinatari, minutiAMezzanotte, IMPOSTAZIONI_PREDEFINITE } from './logica.js';

const SITO = (process.env.SITO_URL || 'https://quiznuoto.web.app').replace(/\/$/, '');
const assoluto = (url) => {
  if (/^https?:\/\//i.test(url || '')) return url;
  return `${SITO}/${String(url || 'index.html').replace(/^\.?\//, '')}`;
};

async function main() {
  const account = leggiAccountServizio(process.env.FIREBASE_SERVICE_ACCOUNT);
  const progetto = account.project_id;
  const chiamaGoogle = creaClientGoogle(creaGestoreToken(account));
  const fs = creaFirestore(chiamaGoogle, progetto);
  const invio = creaInvio({ chiamaGoogle, progetto });
  const adesso = oraItaliana(new Date());
  const forzaPromemoria = process.argv.includes('--promemoria-ora');

  let utenti = null;
  async function caricaUtenti() {
    if (utenti) return utenti;
    const righe = await fs.tutti('users', { campi: ['push', 'access', 'profile.displayName', 'profile.firstName'] });
    utenti = righe.map((r) => ({
      uid: r.percorso[1],
      tokens: Array.isArray(r.dati.push?.tokens) ? r.dati.push.tokens.filter(Boolean) : [],
      streak: r.dati.push?.streak !== false,
      access: r.dati.access || {}
    }));
    return utenti;
  }
  const tokenDaTogliere = new Map(); // uid -> Set(token)

  async function manda(utente, messaggio) {
    let ok = 0; let falliti = 0;
    const giaScartati = tokenDaTogliere.get(utente.uid);
    const validi = giaScartati ? utente.tokens.filter((t) => !giaScartati.has(t)) : utente.tokens;
    await inParallelo(validi, 4, async (token) => {
      const esito = await invio.push(token, messaggio);
      if (esito === 'ok') ok++;
      else {
        falliti++;
        if (esito === 'token-non-valido') {
          if (!tokenDaTogliere.has(utente.uid)) tokenDaTogliere.set(utente.uid, new Set());
          tokenDaTogliere.get(utente.uid).add(token);
        }
      }
    });
    return { ok, falliti };
  }

  // ---- 1) Coda dell'admin ----
  const coda = await fs.tutti('pushQueue', { dove: ['status', 'EQUAL', 'pending'], limite: 20 });
  for (const voce of coda) {
    const id = voce.percorso[1];
    const d = voce.dati;
    try {
      const elenco = destinatari(await caricaUtenti(), d.target || {});
      let ok = 0; let falliti = 0; let dispositivi = 0;
      await inParallelo(elenco, 5, async (u) => {
        dispositivi += u.tokens.length;
        const r = await manda(u, { titolo: d.title, corpo: d.body, url: assoluto(d.url), tag: `admin-${id}` });
        ok += r.ok; falliti += r.falliti;
      });
      await fs.aggiornaCampi(`pushQueue/${id}`, { status: 'sent', sentAt: new Date(), stats: { users: elenco.length, devices: dispositivi, ok, failed: falliti } }, ['status', 'sentAt', 'stats']);
      console.log(`Notifica "${d.title}": ${ok}/${dispositivi} dispositivi (${elenco.length} utenti).`);
    } catch (e) {
      console.error(`Notifica ${id} non inviata: ${e.message}`);
      await fs.aggiornaCampi(`pushQueue/${id}`, { status: 'error', error: e.message.slice(0, 300), sentAt: new Date() }, ['status', 'error', 'sentAt']);
    }
  }

  // ---- 2) Promemoria streak ----
  const impostazioni = { ...IMPOSTAZIONI_PREDEFINITE, ...(await fs.leggi('courseSettings/notifiche') || {}) };
  const statoSalvato = await fs.leggi('meta/promemoria');
  const dovuto = forzaPromemoria ? { orario: adesso.ora, stato: statoSalvato || { date: adesso.data, done: [] } } : promemoriaDovuto(impostazioni, statoSalvato, adesso);
  if (dovuto) {
    // salvo subito l'orario come fatto: se qualcosa va storto non si manda due volte
    if (!forzaPromemoria) await fs.scrivi('meta/promemoria', { date: dovuto.stato.date, done: dovuto.stato.done, aggiornato: new Date() });
    const conNotifiche = (await caricaUtenti()).filter((u) => u.tokens.length && u.streak && u.access?.banned !== true);
    if (conNotifiche.length) {
      const goals = await fs.tutti('studyGoals', { gruppo: true });
      const perUtente = new Map();
      for (const g of goals) {
        // users/{uid}/studyGoals/{corso}
        const [, uid, , corso] = g.percorso;
        if (!perUtente.has(uid)) perUtente.set(uid, []);
        perUtente.get(uid).push({ corso, obiettivo: g.dati });
      }
      let inviati = 0;
      const ttl = minutiAMezzanotte(adesso) * 60;
      await inParallelo(conNotifiche, 5, async (u) => {
        const testo = promemoriaUtente(perUtente.get(u.uid) || [], adesso);
        if (!testo) return;
        const r = await manda(u, { ...testo, url: assoluto(testo.url), tag: `streak-${adesso.data}`, ttlSecondi: ttl });
        if (r.ok) inviati++;
      });
      console.log(`Promemoria delle ${dovuto.orario}:00 → ${inviati} utenti.`);
    }
  } else {
    console.log(`Nessun promemoria da mandare alle ${adesso.ora}:${String(adesso.minuto).padStart(2, '0')}.`);
  }

  // ---- 3) Pulizia dei dispositivi non più validi ----
  for (const [uid, vecchi] of tokenDaTogliere) {
    const u = utenti.find((x) => x.uid === uid);
    const restano = u.tokens.filter((t) => !vecchi.has(t));
    await fs.aggiornaCampi(`users/${uid}`, { push: { tokens: restano } }, ['push.tokens']);
    console.log(`Tolti ${vecchi.size} dispositivi non più validi di un utente.`);
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
