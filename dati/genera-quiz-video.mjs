// Quiz per video: controlla l'abbinamento domande → sezioni FAD e genera public/video-quiz.js.
// Uso: node dati/genera-quiz-video.mjs
// Fonte: dati/video/domande-per-sezione.json (abbinamento fatto dai titoli dei video, non dal contenuto).
import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';

const RADICE = new URL('..', import.meta.url);
const fonte = JSON.parse(readFileSync(new URL('dati/video/domande-per-sezione.json', RADICE), 'utf8'));
const contesto = { window: {} };
vm.runInNewContext(readFileSync(new URL('public/questions.js', RADICE), 'utf8'), contesto);
const domandeSito = new Map(contesto.window.QUIZ_QUESTIONS.map((q) => [q.id, q]));

const errori = [];
const sezioni = fonte.sezioni;
const video = new Map(fonte.video.map((v) => [v.moodleId, v]));
const perDomanda = new Map();
for (const s of sezioni) {
  if (!/^[a-z0-9-]{2,60}$/.test(s.id)) errori.push(`id sezione non valido: ${s.id}`);
  if (s.numeroDomande !== s.domande.length) errori.push(`${s.id}: numeroDomande ${s.numeroDomande} ma ${s.domande.length} domande`);
  if (new Set(s.domande).size !== s.domande.length) errori.push(`${s.id}: domande ripetute`);
  if (!s.video.length) errori.push(`${s.id}: nessun video`);
  for (const id of s.video) if (video.get(id)?.sezioneId !== s.id) errori.push(`${s.id}: video ${id} non torna`);
  for (const n of s.domande) {
    if (!domandeSito.has(n)) errori.push(`${s.id}: domanda ${n} non esiste nel sito`);
    if (!perDomanda.has(n)) perDomanda.set(n, new Set());
    perDomanda.get(n).add(s.id);
  }
}
for (let n = 1; n <= 1000; n++) if (!perDomanda.has(n)) errori.push(`domanda ${n} senza sezione`);
const norm = (t) => String(t || '').replace(/[’‘]/g, "'").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
let testiDiversi = 0;
for (const d of fonte.domande) {
  const sito = domandeSito.get(d.n);
  const attese = [...(perDomanda.get(d.n) || [])].sort().join(',');
  if ([...d.sezioni].sort().join(',') !== attese) errori.push(`domanda ${d.n}: sezioni diverse tra elenco e sezioni`);
  // il testo serve solo a riconoscere la domanda: nel PDF la 277 ha "112 118" (correzione a mano)
  if (sito && norm(d.testo) !== norm(sito.question) && !norm(d.testo).startsWith(norm(sito.question).slice(0, 25))) {
    testiDiversi++;
    errori.push(`domanda ${d.n}: testo diverso da quello del sito`);
  }
}
if (errori.length) {
  console.error(`Abbinamento NON valido (${errori.length} problemi):\n- ${errori.slice(0, 30).join('\n- ')}`);
  process.exit(1);
}
const uscita = {
  nota: "L'abbinamento delle domande ai video è stato fatto senza guardare i video: per ogni domanda è stato scelto il video più probabile, in base al testo della domanda e al titolo del video.",
  sezioni: sezioni.map((s) => ({
    id: s.id,
    titolo: s.titolo,
    video: s.video.map((id) => ({ id, titolo: video.get(id).titolo })),
    domande: s.domande
  }))
};
writeFileSync(new URL('public/video-quiz.js', RADICE),
  `// Quiz per video — generato da dati/genera-quiz-video.mjs (fonte: dati/video/domande-per-sezione.json). Non modificare a mano.\nwindow.QUIZ_VIDEO = ${JSON.stringify(uscita)};\n`);
const presenze = sezioni.reduce((n, s) => n + s.domande.length, 0);
console.log(`OK: ${sezioni.length} sezioni, ${video.size} video, ${perDomanda.size} domande, ${presenze} abbinamenti → public/video-quiz.js`);
