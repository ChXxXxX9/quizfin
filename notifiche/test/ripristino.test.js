import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcolaRipristino } from '../src/ripristino.js';

test('ripristino: rimette i numeri dalla classifica e dall\'obiettivo, senza mai abbassarli', () => {
  const r = calcolaRipristino({
    stats: { totalAnswered: 20, correct: 15, wrong: 5, quizCount: 1, totalScore: 7.5, averageScore: 7.5 },
    totaleGiusteClassifica: 75,
    risposteObiettivo: 100
  });
  assert.equal(r.cambia, true);
  assert.equal(r.dopo.totalAnswered, 100);
  assert.equal(r.dopo.correct, 75);
  assert.equal(r.dopo.wrong, 25);
  assert.equal(r.dopo.quizCount, 5);
  // 4 quiz mancanti con 60 giuste su 80 → voto 7,5 ciascuno
  assert.equal(r.dopo.averageScore, 7.5);
  for (const k of Object.keys(r.prima)) if (k !== 'averageScore') assert.ok(r.dopo[k] >= r.prima[k], k);
});

test('ripristino: niente da cambiare se i numeri sono già giusti', () => {
  const r = calcolaRipristino({ stats: { totalAnswered: 100, correct: 80, wrong: 20, quizCount: 5, totalScore: 40, averageScore: 8 }, totaleGiusteClassifica: 70, risposteObiettivo: 90 });
  assert.equal(r.cambia, false);
});

test('ripristino: senza obiettivo le risposte date sono almeno le giuste', () => {
  const r = calcolaRipristino({ stats: {}, totaleGiusteClassifica: 30, risposteObiettivo: 0 });
  assert.equal(r.dopo.totalAnswered, 30);
  assert.equal(r.dopo.wrong, 0);
  assert.equal(r.dopo.quizCount, 2);
});
