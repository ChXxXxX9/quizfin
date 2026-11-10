// Quiz Nuoto — classifica "risposte giuste" di Istruttore: aggiunge le risposte giuste dei quiz per argomento
// e per video fatti PRIMA che il sito iniziasse a contarle (fino ad allora contava solo il quiz misto).
// Si avvia a mano da GitHub (Actions → "Recupero classifica"): "prova" mostra soltanto, "applica" scrive.
// Fonte: lo storico dei quiz salvato nel documento di ogni utente (stats.history: modalità, giuste, data).
// Una volta applicato a un utente non si ripete (campo recuperoArgomentiVideo nella sua voce di classifica).
// Nelle annotazioni solo numeri: il repository è pubblico.
import { leggiAccountServizio, creaGestoreToken, creaClientGoogle } from './google.js';
import { creaFirestore } from './firestore.js';

const CORSO = 'istruttore';
const ETICHETTA_CORSO = 'Istruttore di Nuoto';
const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Quiz per argomento ("Quiz: <argomento>") e per video ("Quiz per video · <sezione>") fatti prima di `prima`. */
export function giusteDaRecuperare(storico, prima) {
  const limite = Date.parse(prima);
  let giuste = 0; let quiz = 0;
  for (const voce of Array.isArray(storico) ? storico : []) {
    const etichetta = String(voce?.mode || '');
    const tipo = etichetta.startsWith('Quiz per video · ') ? 'video' : (etichetta.startsWith('Quiz: ') ? 'argomento' : null);
    if (!tipo) continue;
    const quando = Date.parse(voce?.date || '');
    if (!Number.isFinite(quando) || !(quando < limite)) continue;
    giuste += Math.max(0, Math.floor(n(voce.correct)));
    quiz += 1;
  }
  return { giuste, quiz };
}

function nomeVisibile(profilo = {}) {
  const pieno = `${profilo.firstName || ''} ${profilo.lastName || ''}`.trim();
  return (profilo.displayName || pieno || String(profilo.email || '').split('@')[0] || 'Utente').slice(0, 60);
}

async function main() {
  const modo = (process.env.RECUPERO_MODO || 'prova').trim();
  const prima = (process.env.RECUPERO_PRIMA || '').trim() || new Date().toISOString();
  if (!Number.isFinite(Date.parse(prima))) throw new Error(`Data non valida: ${prima}`);
  const account = leggiAccountServizio(process.env.FIREBASE_SERVICE_ACCOUNT);
  const fs = creaFirestore(creaClientGoogle(creaGestoreToken(account)), account.project_id);

  const utenti = await fs.tutti('users', { campi: ['stats.history', 'profile.displayName', 'profile.firstName', 'profile.lastName', 'profile.email'] });
  const righe = [`Modo: ${modo === 'applica' ? 'APPLICA (scrive)' : 'prova (non scrive niente)'} · quiz conclusi prima di ${prima}`];
  let k = 0; let scritti = 0; let giaFatti = 0; let storicoPieno = 0;
  for (const u of utenti) {
    const uid = u.percorso[1];
    const storico = u.dati?.stats?.history || [];
    if (storico.length >= 80) storicoPieno++;
    const { giuste, quiz } = giusteDaRecuperare(storico, prima);
    if (!quiz) continue;
    const percorso = `courseLeaderboards/${CORSO}/entries/${uid}`;
    const voce = await fs.leggi(percorso);
    if (voce?.recuperoArgomentiVideo) { giaFatti++; continue; }
    k += 1;
    const prima_ = n(voce?.totalCorrect);
    righe.push(`Utente ${k}: ${quiz} quiz per argomento/video · risposte giuste in classifica ${prima_} → ${prima_ + giuste}${voce ? '' : ' (nuovo in classifica)'}`);
    if (modo !== 'applica') continue;
    const dati = {
      totalCorrect: prima_ + giuste,
      recuperoArgomentiVideo: { at: new Date(), giuste, quiz, prima }
    };
    const campi = ['totalCorrect', 'recuperoArgomentiVideo'];
    if (!voce) {
      Object.assign(dati, { uid, displayName: nomeVisibile(u.dati?.profile), courseId: CORSO, courseLabel: ETICHETTA_CORSO, updatedAt: new Date() });
      campi.push('uid', 'displayName', 'courseId', 'courseLabel', 'updatedAt');
    }
    await fs.aggiornaCampi(percorso, dati, campi);
    scritti += 1;
  }
  if (!k) righe.push('Nessun utente da aggiornare.');
  if (giaFatti) righe.push(`Già recuperati in precedenza: ${giaFatti}`);
  if (storicoPieno) righe.push(`Utenti con storico pieno (80 quiz: i più vecchi non sono più salvati): ${storicoPieno}`);
  if (modo === 'applica') righe.push(`Voci di classifica aggiornate: ${scritti}`);
  console.log(`::notice title=Recupero classifica::${righe.join('%0A')}`);
}

if (process.argv[1] && process.argv[1].endsWith('recupero-classifica.js')) {
  main().catch((e) => {
    console.log(`::error title=Recupero classifica::${String(e.message || e).slice(0, 500)}`);
    process.exit(1);
  });
}
