// Quiz Nuoto — ripristino dei numeri persi nel corso Istruttore (problema del 19–23 ottobre 2026).
// Si avvia a mano da GitHub (Actions → "Ripristino Istruttore"). Con modo "prova" (predefinito) legge e
// mostra soltanto cosa cambierebbe; con modo "applica" scrive.
//
// Cosa si può ricostruire: la classifica conta per sempre le risposte giuste del quiz misto e l'obiettivo
// giornaliero conta per sempre le risposte date nel quiz misto. Da questi due numeri si rimettono le
// statistiche (risposte date, giuste, sbagliate, quiz svolti, voto medio). Quali domande erano state fatte
// non è scritto da nessun'altra parte: quelle non si inventano (il quiz salterebbe domande mai viste).
//
// Nelle annotazioni solo numeri, niente nomi, email o identificativi: il repository è pubblico.
// Prima di scrivere, i valori di prima vengono salvati nel documento dell'utente (progressRestore.before).
import { leggiAccountServizio, creaGestoreToken, creaClientGoogle } from './google.js';
import { creaFirestore } from './firestore.js';

const MODO = (process.env.RIPRISTINO_MODO || 'prova').trim();
const DOMANDE_PER_QUIZ = 20;
const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function calcolaRipristino({ stats = {}, totaleGiusteClassifica = 0, risposteObiettivo = 0 }) {
  const prima = {
    totalAnswered: n(stats.totalAnswered),
    correct: n(stats.correct),
    wrong: n(stats.wrong),
    quizCount: n(stats.quizCount),
    totalScore: n(stats.totalScore),
    averageScore: n(stats.averageScore)
  };
  const correct = Math.max(prima.correct, n(totaleGiusteClassifica));
  const totalAnswered = Math.max(prima.totalAnswered, n(risposteObiettivo), correct);
  const wrong = Math.max(prima.wrong, totalAnswered - correct);
  const quizCount = Math.max(prima.quizCount, Math.round(totalAnswered / DOMANDE_PER_QUIZ));
  const quizMancanti = quizCount - prima.quizCount;
  const risposteMancanti = totalAnswered - prima.totalAnswered;
  const giusteMancanti = correct - prima.correct;
  const votoStimato = risposteMancanti > 0 ? Math.min(10, (giusteMancanti / risposteMancanti) * 10) : 0;
  const totalScore = prima.totalScore + quizMancanti * votoStimato;
  const averageScore = quizCount ? totalScore / quizCount : 0;
  const dopo = {
    totalAnswered, correct, wrong, quizCount,
    totalScore: Math.round(totalScore * 100) / 100,
    averageScore: Math.round(averageScore * 100) / 100
  };
  const cambia = Object.keys(dopo).some((k) => Math.abs(dopo[k] - prima[k]) > 0.001);
  return { prima, dopo, cambia };
}

async function main() {
  const account = leggiAccountServizio(process.env.FIREBASE_SERVICE_ACCOUNT);
  const fs = creaFirestore(creaClientGoogle(creaGestoreToken(account)), account.project_id);

  const voci = await fs.tutti('entries', { gruppo: true });
  const righe = [`Modo: ${MODO === 'applica' ? 'APPLICA (scrive)' : 'prova (non scrive niente)'}`];
  let k = 0; let scritti = 0;
  for (const v of voci) {
    if (v.percorso[0] !== 'courseLeaderboards' || v.percorso[1] !== 'istruttore') continue;
    const uid = v.percorso[3];
    const giuste = n(v.dati?.totalCorrect);
    if (giuste <= 0) continue;
    const utente = await fs.leggi(`users/${uid}`);
    if (!utente) continue;
    const stats = utente.stats || {};
    if (giuste <= n(stats.correct) + 5) continue; // niente di perso
    const obiettivo = (await fs.leggi(`users/${uid}/studyGoals/istruttore`)) || {};
    const conteggi = obiettivo.dailyCounts && typeof obiettivo.dailyCounts === 'object' ? obiettivo.dailyCounts : {};
    const sommaGiorni = Object.values(conteggi).reduce((s, x) => s + n(x), 0);
    const risposteObiettivo = Math.max(n(obiettivo.lifetimeRecordedUnits), sommaGiorni);
    const { prima, dopo, cambia } = calcolaRipristino({ stats, totaleGiusteClassifica: giuste, risposteObiettivo });
    k += 1;
    const domandeFatte = (utente.progress?.allAnswered || []).length;
    righe.push(`Utente ${k}: giorni di studio registrati ${Object.keys(conteggi).length} · domande segnate come fatte ora ${domandeFatte}/1000`);
    righe.push(`  risposte date ${prima.totalAnswered} → ${dopo.totalAnswered} · giuste ${prima.correct} → ${dopo.correct} · sbagliate ${prima.wrong} → ${dopo.wrong} · quiz ${prima.quizCount} → ${dopo.quizCount} · voto medio ${prima.averageScore.toFixed(2)} → ${dopo.averageScore.toFixed(2)}`);
    if (MODO === 'applica' && cambia) {
      const stamp = new Date();
      await fs.aggiornaCampi(`users/${uid}`, {
        stats: { ...stats, ...dopo },
        progressRestore: { at: stamp, reason: 'progressi-azzerati-ottobre-2026', before: prima, after: dopo }
      }, ['stats.totalAnswered', 'stats.correct', 'stats.wrong', 'stats.quizCount', 'stats.totalScore', 'stats.averageScore', 'progressRestore']);
      scritti += 1;
    }
  }
  if (!k) righe.push('Nessun utente con risposte giuste mancanti.');
  if (MODO === 'applica') righe.push(`Utenti aggiornati: ${scritti}`);
  console.log(`::notice title=Ripristino Istruttore::${righe.join('%0A')}`);
}

if (process.argv[1] && process.argv[1].endsWith('ripristino.js')) {
  main().catch((e) => {
    console.log(`::error title=Ripristino Istruttore::${String(e.message || e).slice(0, 500)}`);
    process.exit(1);
  });
}
