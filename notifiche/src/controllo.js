// Quiz Nuoto — controllo dei dati reali (si avvia a mano da GitHub: Actions → "Controllo dati").
// Legge Firestore e gli account di accesso con l'account di servizio e stampa SOLO conteggi e
// impostazioni generali: niente nomi, email o identificativi (il repository è pubblico).
import { leggiAccountServizio, creaGestoreToken, creaClientGoogle } from './google.js';
import { creaFirestore } from './firestore.js';
import { streakReale, oraItaliana, giorniTra } from './logica.js';

const CORSI = ['istruttore', 'bagnino', 'arte'];
const righe = [];
const avvisi = [];
const conta = (etichetta, n, { avviso = false, soglia = 0 } = {}) => {
  righe.push(`${etichetta}: ${n}`);
  if (avviso && n > soglia) avvisi.push(`${etichetta}: ${n}`);
};
const kb = (v) => Math.round(Buffer.byteLength(JSON.stringify(v ?? null)) / 1024);
const dataValida = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

async function main() {
  const account = leggiAccountServizio(process.env.FIREBASE_SERVICE_ACCOUNT);
  const chiama = creaClientGoogle(creaGestoreToken(account));
  const fs = creaFirestore(chiama, account.project_id);
  const oggi = oraItaliana(new Date()).data;

  /* ---------- Impostazioni generali ---------- */
  const impostazioni = await fs.tutti('courseSettings');
  const bandiere = [];
  for (const d of impostazioni) {
    const id = d.percorso[1];
    const x = d.dati || {};
    const on = ['maintenance', 'blocked', 'hidden'].filter((k) => x[k] === true);
    if (on.length) bandiere.push(`${id}: ${on.join('+')}`);
  }
  righe.push(`Impostazioni con blocchi/manutenzione attivi: ${bandiere.length ? bandiere.join(' · ') : 'nessuna'}`);
  if (bandiere.length) avvisi.push(`Blocchi o manutenzione attivi: ${bandiere.join(' · ')}`);
  const notifiche = impostazioni.find((d) => d.percorso[1] === 'notifiche')?.dati || {};
  righe.push(`Promemoria streak: ${notifiche.streakReminders === false ? 'spenti' : 'attivi'} alle ${(notifiche.hours || [18, 21]).join(', ')} · avvisi richieste admin: ${notifiche.adminRequests === false ? 'spenti' : 'attivi'}`);

  /* ---------- Utenti ---------- */
  const utenti = await fs.tutti('users');
  const perUid = new Map(utenti.map((u) => [u.percorso[1], u.dati || {}]));
  conta('Utenti (documenti)', utenti.length);
  let approvati = 0; let inAttesa = 0; let rifiutati = 0; let bloccati = 0; let senzaTermini = 0; let verificaBloccata = 0;
  let incoerenti = 0; let pendingGiaConcessi = 0; let senzaNome = 0; let conPush = 0; let tokenTanti = 0; let tokenTotali = 0;
  let grandi200 = 0; let grandi500 = 0; let grandi800 = 0; let maxKb = 0; let statoStrano = 0; let idFuori = 0; let doppioni = 0;
  for (const [, d] of perUid) {
    const a = d.access || {};
    const ca = a.courseAccess || {};
    const corsiOk = Object.entries(ca).filter(([, v]) => v === true).map(([k]) => k);
    if (a.banned) bloccati++;
    else if (a.appVerified) approvati++;
    else if (a.accountStatus === 'rejected') rifiutati++;
    else inAttesa++;
    if (a.appVerified && !a.banned && !a.termsAcceptedAt) senzaTermini++;
    if (a.appVerified && a.requiresEmailVerification === true && a.verificationRequiredVersion === 'v24' && d.profile?.emailVerified !== true) verificaBloccata++;
    if (!a.appVerified && !a.banned && corsiOk.length) incoerenti++;
    if (a.appVerified && Array.isArray(a.pendingCourses) && a.pendingCourses.some((c) => ca[c] === true)) pendingGiaConcessi++;
    if (a.appVerified && !(d.profile?.firstName || '').trim()) senzaNome++;
    const tokens = Array.isArray(d.push?.tokens) ? d.push.tokens.length : 0;
    if (tokens) conPush++;
    if (tokens > 4) tokenTanti++;
    tokenTotali += tokens;
    const peso = kb(d);
    maxKb = Math.max(maxKb, peso);
    if (peso > 200) grandi200++;
    if (peso > 500) grandi500++;
    if (peso > 800) grandi800++;
    // stato del corso Istruttore (salvato in alto nel documento utente)
    const st = d.stats;
    if (st && (Number(st.totalAnswered) < 0 || Number(st.correct) > Number(st.totalAnswered) || !Number.isFinite(Number(st.averageScore ?? 0)))) statoStrano++;
    const elenchi = [d.progress?.mixedCompleted, d.progress?.allAnswered, d.wrong?.mixed, d.markedQuestions].filter(Array.isArray);
    for (const el of elenchi) {
      if (el.some((x) => !(Number(x) >= 1 && Number(x) <= 1000))) idFuori++;
      if (new Set(el.map(Number)).size !== el.length) doppioni++;
    }
  }
  // Dettagli senza dati personali: forma dell'accesso degli utenti "incoerenti" e attività salvata
  const forme = [];
  let conAttivita = 0; let quizMax = 0; let misteMax = 0; let approvatiSenzaStato = 0; let ultimiAccessi = [];
  for (const [, d] of perUid) {
    const a = d.access || {};
    const ca = a.courseAccess || {};
    const corsiOk = Object.entries(ca).filter(([, v]) => v === true).map(([k]) => k);
    if (!a.appVerified && !a.banned && corsiOk.length) {
      forme.push(`stato=${a.accountStatus || '-'} corsi=${corsiOk.join('+')} rifiuti=${a.rejectedCount ?? '-'} inAttesa=${(a.pendingCourses || []).join('+') || '-'} revisione=${a.reviewPending ? 'sì' : 'no'} sbloccato=${a.accountStatus === 'unblocked' ? 'sì' : 'no'} approvatoIl=${a.approvedAt ? 'sì' : 'no'} verificatoDaAdmin=${a.verifiedBy ? 'sì' : 'no'}`);
    }
    const quiz = Number(d.stats?.quizCount || 0);
    const misto = Array.isArray(d.progress?.mixedCompleted) ? d.progress.mixedCompleted.length : 0;
    if (quiz > 0 || misto > 0) conAttivita++;
    quizMax = Math.max(quizMax, quiz);
    misteMax = Math.max(misteMax, misto);
    if (a.appVerified && (ca.istruttore === true || !Object.keys(ca).length) && !d.stats) approvatiSenzaStato++;
    const ultimo = Date.parse(d.profile?.lastLoginAt || '');
    if (Number.isFinite(ultimo)) ultimiAccessi.push(Math.floor((Date.now() - ultimo) / 864e5));
  }
  ultimiAccessi.sort((x, y) => x - y);
  righe.push(`Istruttore: utenti con attività salvata ${conAttivita} · quiz massimo per utente ${quizMax} · domande del misto fatte (max) ${misteMax} · approvati Istruttore senza nessun dato salvato ${approvatiSenzaStato}`);
  righe.push(`Ultimo accesso registrato (giorni fa, per utente): ${ultimiAccessi.join(', ') || '—'}`);
  forme.forEach((f, i) => righe.push(`Incoerente ${i + 1}: ${f}`));
  conta('Approvati', approvati);
  conta('In attesa / revisione', inAttesa);
  conta('Rifiutati', rifiutati);
  conta('Bloccati', bloccati);
  conta('Approvati che non hanno ancora accettato i termini', senzaTermini);
  conta('Approvati fermi alla verifica email', verificaBloccata, { avviso: true });
  conta('Non approvati ma con un corso aperto (incoerenti)', incoerenti, { avviso: true });
  conta('Approvati con richiesta in sospeso per un corso già concesso', pendingGiaConcessi, { avviso: true });
  conta('Approvati senza nome nel profilo', senzaNome);
  conta('Utenti con notifiche attive', conPush);
  conta('Dispositivi registrati per le notifiche', tokenTotali);
  conta('Utenti con più di 4 dispositivi registrati', tokenTanti, { avviso: true });
  righe.push(`Documento utente più pesante: ${maxKb} KB (limite Firestore 1024 KB) · >200 KB: ${grandi200} · >500 KB: ${grandi500} · >800 KB: ${grandi800}`);
  if (grandi500) avvisi.push(`Documenti utente oltre 500 KB: ${grandi500} (oltre 800 KB: ${grandi800})`);
  conta('Statistiche Istruttore incoerenti', statoStrano, { avviso: true });
  conta('Elenchi di domande con numeri fuori 1–1000', idFuori, { avviso: true });
  conta('Elenchi di domande con doppioni', doppioni, { avviso: true });

  /* ---------- Dati dei corsi Bagnino / Arte ---------- */
  const corsiDati = await fs.tutti('courseData', { gruppo: true });
  let maxCorso = 0; let corsoGrandi = 0;
  for (const c of corsiDati) { const p = kb(c.dati); maxCorso = Math.max(maxCorso, p); if (p > 500) corsoGrandi++; }
  righe.push(`Dati corso Bagnino/Arte: ${corsiDati.length} documenti · il più pesante ${maxCorso} KB · oltre 500 KB: ${corsoGrandi}`);
  if (corsoGrandi) avvisi.push(`Dati corso oltre 500 KB: ${corsoGrandi}`);

  /* ---------- Account di accesso (Firebase Authentication) ---------- */
  try {
    let pagina = '';
    let auth = [];
    do {
      const r = await chiama(`https://identitytoolkit.googleapis.com/v1/projects/${account.project_id}/accounts:batchGet?maxResults=1000${pagina ? `&nextPageToken=${encodeURIComponent(pagina)}` : ''}`);
      auth = auth.concat(r.users || []);
      pagina = r.nextPageToken || '';
    } while (pagina);
    const senzaDoc = auth.filter((u) => !perUid.has(u.localId)).length;
    const docSenzaAccount = [...perUid.keys()].filter((uid) => !auth.some((u) => u.localId === uid)).length;
    const disattivati = auth.filter((u) => u.disabled).length;
    const soloGoogle = auth.filter((u) => (u.providerUserInfo || []).every((p) => p.providerId === 'google.com')).length;
    const conPassword = auth.filter((u) => (u.providerUserInfo || []).some((p) => p.providerId === 'password')).length;
    const nonVerificati = auth.filter((u) => !u.emailVerified).length;
    const recenti = auth.filter((u) => Number(u.lastLoginAt || 0) > Date.now() - 7 * 864e5).length;
    righe.push(`Account di accesso: ${auth.length} · con password ${conPassword} · solo Google ${soloGoogle} · email non verificata ${nonVerificati} · disattivati ${disattivati} · entrati negli ultimi 7 giorni ${recenti}`);
    const verifica = [...perUid.entries()].filter(([, d]) => d.access?.appVerified && d.access?.requiresEmailVerification === true && d.access?.verificationRequiredVersion === 'v24');
    verifica.forEach(([uid, d], i) => {
      const u = auth.find((x) => x.localId === uid);
      const giorni = u?.lastLoginAt ? Math.floor((Date.now() - Number(u.lastLoginAt)) / 864e5) : '-';
      righe.push(`Verifica email ${i + 1}: email verificata per l'accesso=${u?.emailVerified ? 'sì' : 'no'} · nel profilo=${d.profile?.emailVerified ? 'sì' : 'no'} · accesso con ${(u?.providerUserInfo || []).map((p) => p.providerId).join('+') || '-'} · ultimo ingresso ${giorni} giorni fa`);
    });
    conta('Account di accesso senza documento utente', senzaDoc, { avviso: true, soglia: 2 });
    conta('Documenti utente senza account di accesso (cancellati)', docSenzaAccount, { avviso: true, soglia: 2 });
  } catch (e) {
    righe.push(`Account di accesso: non leggibili (${String(e.message).slice(0, 120)})`);
  }

  /* ---------- Richieste account ---------- */
  const richieste = await fs.tutti('accountRequests');
  const aperte = richieste.filter((r) => ['pending', 'review'].includes(r.dati?.status || 'pending'));
  const vecchie = aperte.filter((r) => Date.parse(r.dati?.createdAt || '') < Date.now() - 7 * 864e5).length;
  const giaApprovate = aperte.filter((r) => { const u = perUid.get(r.dati?.uid); const ca = u?.access?.courseAccess || {}; const corsi = r.dati?.requestedCourses || []; return corsi.length && corsi.every((c) => ca[c] === true); }).length;
  const perUtente = new Map(); aperte.forEach((r) => perUtente.set(r.dati?.uid, (perUtente.get(r.dati?.uid) || 0) + 1));
  const doppie = [...perUtente.values()].filter((n) => n > 1).length;
  const nonSegnalate = aperte.filter((r) => !r.dati?.adminNotifiedAt).length;
  righe.push(`Richieste account aperte: ${aperte.length} (più vecchie di 7 giorni: ${vecchie}) · altre chiuse rimaste: ${richieste.length - aperte.length}`);
  conta('Richieste aperte per corsi già concessi', giaApprovate, { avviso: true });
  conta('Utenti con più richieste aperte insieme', doppie, { avviso: true });
  conta('Richieste aperte non ancora segnalate all\'admin', nonSegnalate);

  /* ---------- Obiettivi e streak ---------- */
  const obiettivi = await fs.tutti('studyGoals', { gruppo: true });
  let futuro = 0; let quotaStrana = 0; let streakSenzaData = 0; let streakSopraRecord = 0; let giorniTanti = 0; let corsoSbagliato = 0; let attiveOggi = 0; let fattiOggi = 0;
  for (const g of obiettivi) {
    const d = g.dati || {};
    const corso = g.percorso[3];
    if (d.lastMetDate && (!dataValida(d.lastMetDate) || d.lastMetDate > oggi)) futuro++;
    if (!(Number(d.dailyTarget) >= 1 && Number(d.dailyTarget) <= 1000)) quotaStrana++;
    if (Number(d.streak) > 0 && !d.lastMetDate) streakSenzaData++;
    if (Number(d.bestStreak || 0) < Number(d.streak || 0)) streakSopraRecord++;
    if (d.dailyCounts && Object.keys(d.dailyCounts).length > 400) giorniTanti++;
    if (d.courseId && d.courseId !== corso) corsoSbagliato++;
    if (streakReale(d, oggi) > 0) attiveOggi++;
    if (d.lastMetDate === oggi) fattiOggi++;
  }
  righe.push(`Obiettivi impostati: ${obiettivi.length} · streak accese oggi: ${attiveOggi} · obiettivo già fatto oggi: ${fattiOggi}`);
  conta('Obiettivi con data dell\'ultimo giorno riuscito nel futuro o non valida', futuro, { avviso: true });
  conta('Obiettivi con quota giornaliera non valida', quotaStrana, { avviso: true });
  conta('Streak > 0 senza giorno riuscito', streakSenzaData, { avviso: true });
  conta('Streak più alta del record', streakSopraRecord, { avviso: true });
  conta('Obiettivi con più di 400 giorni di conteggi', giorniTanti);
  conta('Obiettivi salvati sotto il corso sbagliato', corsoSbagliato, { avviso: true });

  /* ---------- Classifiche ---------- */
  const voci = await fs.tutti('entries', { gruppo: true });
  let orfane = 0; let senzaNomeCl = 0; let streakDiversa = 0;
  const goalPer = new Map(obiettivi.map((g) => [`${g.percorso[1]}:${g.percorso[3]}`, g.dati || {}]));
  for (const v of voci) {
    const corso = v.percorso[1];
    const uid = v.percorso[3];
    if (!CORSI.includes(corso)) continue;
    if (!perUid.has(uid)) orfane++;
    if (!(v.dati?.displayName || '').trim()) senzaNomeCl++;
    const g = goalPer.get(`${uid}:${corso}`);
    if (g && streakReale(g, oggi) !== streakReale(v.dati || {}, oggi)) streakDiversa++;
  }
  righe.push(`Voci di classifica: ${voci.length}`);

  // Progressi Istruttore probabilmente azzerati: la classifica conta per sempre le risposte giuste del
  // quiz misto; se il documento dell'utente ne ha meno, i suoi progressi sono stati sovrascritti.
  let azzerati = 0; let giusteSparite = 0; let istruttoreAttivi = 0;
  for (const v of voci) {
    if (v.percorso[1] !== 'istruttore') continue;
    const d = perUid.get(v.percorso[3]);
    if (!d) continue;
    const totale = Number(v.dati?.totalCorrect || 0);
    if (totale > 0) istruttoreAttivi++;
    const nelDoc = Number(d.stats?.correct || 0);
    if (totale > nelDoc + 5) { azzerati++; giusteSparite += totale - nelDoc; }
  }
  righe.push(`Istruttore: utenti con risposte giuste in classifica: ${istruttoreAttivi}`);
  conta('Istruttore: utenti con progressi più bassi della classifica (probabilmente azzerati)', azzerati, { avviso: true });
  if (azzerati) righe.push(`Istruttore: risposte giuste in classifica che mancano nei progressi: ${giusteSparite}`);
  conta('Voci di classifica di utenti che non esistono più', orfane, { avviso: true });
  conta('Voci di classifica senza nome', senzaNomeCl, { avviso: true });
  conta('Voci di classifica con streak diversa dall\'obiettivo', streakDiversa, { avviso: true });

  /* ---------- Annunci e notifiche ---------- */
  const annunci = await fs.tutti('announcements');
  const attivi = annunci.filter((a) => a.dati?.active === true);
  const scadutiAttivi = attivi.filter((a) => a.dati?.endAt && Date.parse(a.dati.endAt) < Date.now()).length;
  const pesoAnnunci = attivi.reduce((n, a) => n + kb(a.dati), 0);
  righe.push(`Annunci: ${annunci.length} (attivi ${attivi.length}, scaduti ma ancora attivi ${scadutiAttivi}) · peso degli attivi scaricato a ogni accesso: ${pesoAnnunci} KB`);
  if (pesoAnnunci > 600) avvisi.push(`Annunci attivi pesanti: ${pesoAnnunci} KB a ogni accesso`);
  const coda = await fs.tutti('pushQueue');
  const ferme = coda.filter((q) => q.dati?.status === 'pending' && Date.parse(q.dati?.createdAt || '') < Date.now() - 6 * 3600e3).length;
  const errori = coda.filter((q) => q.dati?.status === 'error').length;
  righe.push(`Notifiche admin: ${coda.length} in tutto · in coda da più di 6 ore: ${ferme} · con errore: ${errori}`);
  if (ferme) avvisi.push(`Notifiche dell'admin in coda da più di 6 ore: ${ferme}`);
  const promemoria = await fs.leggi('meta/promemoria');
  righe.push(`Ultimi promemoria streak: ${promemoria ? `${promemoria.date} ore ${(promemoria.done || []).join(', ') || '—'}` : 'mai'}`);

  // Annotazioni brevi (GitHub mostra un numero limitato di annotazioni per passo)
  const blocchi = [];
  let corrente = '';
  for (const r of righe) {
    if ((corrente + r).length > 900) { blocchi.push(corrente); corrente = ''; }
    corrente += `${r}%0A`;
  }
  if (corrente) blocchi.push(corrente);
  blocchi.forEach((b, i) => console.log(`::notice title=Controllo dati ${i + 1}/${blocchi.length}::${b}`));
  avvisi.slice(0, 9).forEach((a) => console.log(`::warning title=Da guardare::${a}`));
  if (!avvisi.length) console.log('::notice title=Esito::Nessuna anomalia nei dati.');
}

main().catch((e) => {
  console.log(`::error title=Controllo dati::${String(e.message || e).slice(0, 500)}`);
  process.exit(1);
});
