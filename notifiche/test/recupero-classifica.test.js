import { test } from 'node:test';
import assert from 'node:assert/strict';
import { giusteDaRecuperare } from '../src/recupero-classifica.js';

test('recupero classifica: solo quiz per argomento e per video, conclusi prima della data', () => {
  const storico = [
    { mode: 'Quiz misto', correct: 15, date: '2026-11-01T10:00:00Z' },
    { mode: 'Quiz: Biofisiologia', correct: 5, date: '2026-11-02T10:00:00Z' },
    { mode: 'Quiz per video · Il Corpo Umano', correct: 12, date: '2026-11-03T10:00:00Z' },
    { mode: 'Sbagliate: Biofisiologia', correct: 3, date: '2026-11-04T10:00:00Z' },
    { mode: 'Errori · Il Corpo Umano', correct: 2, date: '2026-11-04T11:00:00Z' },
    { mode: 'Ripeti errori ultimo quiz', correct: 1, date: '2026-11-04T12:00:00Z' },
    { mode: 'Esamone ufficiale', correct: 40, date: '2026-11-05T10:00:00Z' },
    { mode: 'Quiz per video · Aspetti amministrativi', correct: 18, date: '2026-11-11T10:00:00Z' }
  ];
  assert.deepEqual(giusteDaRecuperare(storico, '2026-11-10T10:00:00Z'), { giuste: 17, quiz: 2 });
  assert.deepEqual(giusteDaRecuperare([], '2026-11-10T10:00:00Z'), { giuste: 0, quiz: 0 });
  assert.deepEqual(giusteDaRecuperare(null, '2026-11-10T10:00:00Z'), { giuste: 0, quiz: 0 });
});
