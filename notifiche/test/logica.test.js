import { test } from 'node:test';
import assert from 'node:assert/strict';
import { oraItaliana, promemoriaDovuto, promemoriaUtente, streakReale, destinatari, testoTempo, minutiAMezzanotte } from '../src/logica.js';

test('ora italiana con ora legale e solare', () => {
  assert.deepEqual(oraItaliana(new Date('2026-07-10T16:30:00Z')), { data: '2026-07-10', ora: 18, minuto: 30 });
  assert.deepEqual(oraItaliana(new Date('2026-12-10T17:05:00Z')), { data: '2026-12-10', ora: 18, minuto: 5 });
  assert.deepEqual(oraItaliana(new Date('2026-12-31T23:30:00Z')), { data: '2027-01-01', ora: 0, minuto: 30 });
});

test('tempo fino a mezzanotte', () => {
  assert.equal(minutiAMezzanotte({ ora: 21, minuto: 0 }), 180);
  assert.equal(testoTempo(180), '3 h');
  assert.equal(testoTempo(95), '1 h 35 min');
  assert.equal(testoTempo(12), '12 min');
});

test('streak reale: −1 per ogni giorno saltato, come sul sito', () => {
  const g = { streak: 3, lastMetDate: '2026-10-10' };
  assert.equal(streakReale(g, '2026-10-10'), 3);
  assert.equal(streakReale(g, '2026-10-11'), 3);
  assert.equal(streakReale(g, '2026-10-12'), 2);
  assert.equal(streakReale(g, '2026-10-13'), 1);
  assert.equal(streakReale(g, '2026-10-20'), 0);
});

test('orari dei promemoria: una volta per orario, niente raffiche', () => {
  const imp = { streakReminders: true, hours: [18, 21] };
  assert.equal(promemoriaDovuto(imp, null, { data: '2026-10-18', ora: 17 }), null);
  const a = promemoriaDovuto(imp, null, { data: '2026-10-18', ora: 18 });
  assert.equal(a.orario, 18);
  assert.deepEqual(a.stato.done, [18]);
  assert.equal(promemoriaDovuto(imp, a.stato, { data: '2026-10-18', ora: 19 }), null);
  const b = promemoriaDovuto(imp, a.stato, { data: '2026-10-18', ora: 22 });
  assert.equal(b.orario, 21);
  // controllo rimasto indietro: solo l'ultimo orario passato
  const c = promemoriaDovuto(imp, null, { data: '2026-10-18', ora: 23 });
  assert.equal(c.orario, 21);
  assert.deepEqual(c.stato.done, [18, 21]);
  // giorno nuovo: si riparte
  assert.equal(promemoriaDovuto(imp, c.stato, { data: '2026-10-19', ora: 18 }).orario, 18);
  assert.equal(promemoriaDovuto({ streakReminders: false, hours: [18] }, null, { data: '2026-10-18', ora: 20 }), null);
});

test('testo del promemoria: quanto manca e quanto tempo resta', () => {
  const adesso = { data: '2026-10-18', ora: 21, minuto: 0 };
  const obiettivo = { dailyTarget: 20, dailyCounts: { '2026-10-18': 12 }, streak: 5, lastMetDate: '2026-10-17' };
  const m = promemoriaUtente([{ corso: 'istruttore', obiettivo }], adesso);
  assert.match(m.titolo, /Streak di 5 giorni a rischio/);
  assert.match(m.corpo, /ti mancano 8 domande/);
  assert.match(m.corpo, /3 h/);
  assert.match(m.corpo, /scende a 4/);
  assert.equal(m.url, './istruttore.html');
  // già fatto oggi → niente
  assert.equal(promemoriaUtente([{ corso: 'istruttore', obiettivo: { ...obiettivo, lastMetDate: '2026-10-18' } }], adesso), null);
  // inattivo da tanto e streak a zero → niente
  assert.equal(promemoriaUtente([{ corso: 'bagnino', obiettivo: { dailyTarget: 10, dailyCounts: {}, streak: 2, lastMetDate: '2026-09-01' } }], adesso), null);
  // due corsi
  const due = promemoriaUtente([
    { corso: 'istruttore', obiettivo },
    { corso: 'arte', obiettivo: { dailyTarget: 5, dailyCounts: { '2026-10-18': 1 }, streak: 1, lastMetDate: '2026-10-17' } }
  ], adesso);
  assert.match(due.titolo, /2 corsi/);
  assert.match(due.corpo, /Arte: mancano 4 opere/);
});

test('destinatari delle notifiche dell\'admin', () => {
  const utenti = [
    { uid: 'a', tokens: ['t1'], access: { appVerified: true, courseAccess: { istruttore: true } } },
    { uid: 'b', tokens: ['t2', 't3'], access: { appVerified: true, courseAccess: { bagnino: true } } },
    { uid: 'c', tokens: [], access: { appVerified: true, courseAccess: { bagnino: true } } },
    { uid: 'd', tokens: ['t4'], access: { banned: true, courseAccess: { bagnino: true } } },
    { uid: 'e', tokens: ['t5'], access: { appVerified: true, courseAccess: {} } }
  ];
  assert.deepEqual(destinatari(utenti, { type: 'all' }).map((u) => u.uid), ['a', 'b', 'e']);
  assert.deepEqual(destinatari(utenti, { type: 'course', course: 'bagnino' }).map((u) => u.uid), ['b']);
  assert.deepEqual(destinatari(utenti, { type: 'course', course: 'istruttore' }).map((u) => u.uid), ['a', 'e']);
  assert.deepEqual(destinatari(utenti, { type: 'user', uid: 'b' }).map((u) => u.uid), ['b']);
});
