// Logica pura (senza rete) delle notifiche di Quiz Nuoto: orari, streak, testi, destinatari.

export const CORSI = {
  istruttore: { nome: 'Istruttore', unita: 'domande', pagina: 'istruttore.html' },
  bagnino: { nome: 'Bagnino', unita: 'domande', pagina: 'bagnino.html' },
  arte: { nome: 'Arte', unita: 'opere', pagina: 'arte.html' }
};
export const IMPOSTAZIONI_PREDEFINITE = { streakReminders: true, hours: [18, 21] };

/** Data e ora italiane di un istante: { data: 'YYYY-MM-DD', ora, minuto }. */
export function oraItaliana(istante = new Date()) {
  const parti = Object.fromEntries(new Intl.DateTimeFormat('it-IT', {
    timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(istante).map((p) => [p.type, p.value]));
  return { data: `${parti.year}-${parti.month}-${parti.day}`, ora: Number(parti.hour), minuto: Number(parti.minute) };
}

export function minutiAMezzanotte({ ora, minuto }) {
  return Math.max(0, (23 - ora) * 60 + (60 - minuto));
}
export function testoTempo(minuti) {
  const h = Math.floor(minuti / 60);
  const m = minuti % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Giorni di calendario tra due date YYYY-MM-DD (b - a). */
export function giorniTra(a, b) {
  const pa = String(a || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const pb = String(b || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!pa || !pb) return 0;
  return Math.round((Date.UTC(+pb[1], +pb[2] - 1, +pb[3]) - Date.UTC(+pa[1], +pa[2] - 1, +pa[3])) / 86400000);
}

/** Stessa regola del sito (study-goal.js): +1 per ogni giorno riuscito, −1 per ogni giorno intero saltato. */
export function streakReale(obiettivo, oggi) {
  if (!obiettivo?.lastMetDate) return 0;
  const streak = Math.max(0, Number(obiettivo.streak || 0));
  if (obiettivo.lastMetDate >= oggi) return streak;
  const saltati = Math.max(0, giorniTra(obiettivo.lastMetDate, oggi) - 1);
  return Math.max(0, streak - saltati);
}

/**
 * Quale promemoria tocca adesso. Restituisce { orario, stato } (stato da salvare) oppure null.
 * Se il controllo è rimasto indietro, manda solo l'ultimo orario passato (niente raffiche).
 */
export function promemoriaDovuto(impostazioni, statoSalvato, adesso) {
  if (impostazioni.streakReminders === false) return null;
  const orari = (impostazioni.hours?.length ? impostazioni.hours : IMPOSTAZIONI_PREDEFINITE.hours).map(Number).filter((h) => h >= 0 && h <= 23);
  const stato = statoSalvato?.date === adesso.data ? { date: adesso.data, done: [...(statoSalvato.done || [])] } : { date: adesso.data, done: [] };
  const scaduti = orari.filter((h) => adesso.ora >= h && !stato.done.includes(h));
  if (!scaduti.length) return null;
  stato.done = [...new Set([...stato.done, ...scaduti])].sort((a, b) => a - b);
  return { orario: Math.max(...scaduti), stato };
}

/**
 * Testo del promemoria per un utente, dati i suoi obiettivi ({ corso, obiettivo }).
 * null se non serve: obiettivo già fatto oggi, o utente inattivo da più di una settimana senza streak.
 */
export function promemoriaUtente(obiettivi, adesso) {
  const oggi = adesso.data;
  const righe = [];
  for (const { corso, obiettivo } of obiettivi) {
    const info = CORSI[corso];
    if (!info || !obiettivo) continue;
    const quota = Math.max(1, Number(obiettivo.dailyTarget || 0));
    const fatte = Number(obiettivo.dailyCounts?.[oggi] || 0);
    if (fatte >= quota || obiettivo.lastMetDate === oggi) continue;
    const streak = streakReale(obiettivo, oggi);
    const recente = obiettivo.lastMetDate && giorniTra(obiettivo.lastMetDate, oggi) <= 7;
    if (streak <= 0 && !recente && fatte === 0) continue;
    righe.push({ corso, info, mancano: quota - fatte, streak });
  }
  if (!righe.length) return null;
  const tempo = testoTempo(minutiAMezzanotte(adesso));
  if (righe.length === 1) {
    const r = righe[0];
    return {
      titolo: r.streak > 0 ? `🔥 Streak di ${r.streak} ${r.streak === 1 ? 'giorno' : 'giorni'} a rischio` : '🔥 Riaccendi il fuoco oggi',
      corpo: `${r.info.nome}: ti mancano ${r.mancano} ${r.info.unita}. Hai tempo fino a mezzanotte (${tempo}).${r.streak > 0 ? ` Se salti oggi scende a ${r.streak - 1}.` : ''}`,
      url: `./${r.info.pagina}`
    };
  }
  return {
    titolo: `🔥 Obiettivo di oggi da fare in ${righe.length} corsi`,
    corpo: `${righe.map((r) => `${r.info.nome}: mancano ${r.mancano} ${r.info.unita}${r.streak > 0 ? ` (streak ${r.streak})` : ''}`).join(' · ')}. Tempo fino a mezzanotte: ${tempo}.`,
    url: './index.html'
  };
}

export function haCorso(access = {}, corso) {
  const ca = access.courseAccess || {};
  if (corso === 'istruttore') return ca.istruttore === true || (access.appVerified === true && Object.keys(ca).length === 0);
  return ca[corso] === true;
}

/** Utenti a cui va una notifica dell'admin. */
export function destinatari(utenti, target = {}) {
  const attivi = utenti.filter((u) => u.tokens.length && u.access?.banned !== true);
  if (target.type === 'user') return attivi.filter((u) => u.uid === target.uid);
  if (target.type === 'course') return attivi.filter((u) => haCorso(u.access, target.course));
  return attivi;
}
