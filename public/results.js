/* ==========================================================================
   Quiz Nuoto — schermata finale del quiz (results.js)
   --------------------------------------------------------------------------
   Usata dai corsi Istruttore e Bagnino. Disegna:
   - nel riquadro scuro: giudizio, barra corrette/errate/senza risposta;
   - riquadri distinti: corrette, errate, punteggio, tempo, suggerimenti, media;
   - riquadro largo con l'argomento con più errori;
   - intestazione della revisione con filtro Tutte / Errate / Corrette.
   ========================================================================== */
(() => {
  'use strict';

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICONS = {
    ok: svg('<path d="M20 6 9 17l-5-5"/>'),
    no: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
    points: svg('<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>'),
    time: svg('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/>'),
    hint: svg('<path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.3h6c0-1 .4-1.8 1-2.3A7 7 0 0 0 12 2z"/>'),
    avg: svg('<path d="M3 20h18"/><path d="m5 15 4-4 4 3 6-7"/>'),
    target: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>'),
    weak: svg('<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>'),
    party: svg('<path d="M5.8 11.3 2 22l10.7-3.8"/><path d="M4 3h.01M22 8h.01M15 2h.01M22 20h.01"/><path d="m22 2-2.2.8a2.9 2.9 0 0 0-1.9 3.3 2.9 2.9 0 0 1-1.9 3.3L14 10"/><path d="M9.8 8.2a12 12 0 0 1 6 6"/>')
  };

  function tile({ tone = '', icon, label, value, unit = '', sub = '', wide = false, bar = null }) {
    return `<article class="result-tile${tone ? ` tone-${tone}` : ''}${wide ? ' result-tile-wide' : ''}">
      <p class="result-tile-head"><span class="result-tile-ico">${ICONS[icon] || ''}</span>${esc(label)}</p>
      <p class="result-tile-value">${value}${unit ? `<small>${unit}</small>` : ''}</p>
      ${bar !== null ? `<span class="result-tile-bar"><span style="width:${Math.max(0, Math.min(100, bar))}%"></span></span>` : ''}
      ${sub ? `<p class="result-tile-sub">${sub}</p>` : ''}
    </article>`;
  }

  function verdict(vote, correct, total) {
    if (total && correct === total) return 'Tutto giusto: complimenti!';
    if (vote >= 9) return 'Eccellente, sei pronto.';
    if (vote >= 7.5) return 'Ottimo lavoro.';
    if (vote >= 6) return 'Sufficiente: continua così.';
    if (vote >= 4) return 'Ci sei quasi: ripassa gli errori.';
    return 'Da ripassare: riparti dagli errori qui sotto.';
  }

  function plural(n, one, many) { return `${n} ${n === 1 ? one : many}`; }

  function topicsWithErrors(results) {
    const map = new Map();
    results.forEach((r) => {
      const t = r.question?.topic || '—';
      if (!map.has(t)) map.set(t, { topic: t, errors: 0, total: 0 });
      const row = map.get(t);
      row.total += 1;
      if (!r.isCorrect) row.errors += 1;
    });
    return [...map.values()];
  }

  function render(o) {
    const fmtVote = o.fmtVote || ((v) => Number(v || 0).toFixed(1).replace('.0', ''));
    const fmtDec = o.fmtDecimal || fmtVote;
    const fmtDur = o.fmtDuration || ((s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
    const results = Array.isArray(o.results) ? o.results : [];
    const total = Number(o.total || results.length || 0);
    const correct = Number(o.correct || 0);
    const unanswered = results.filter((r) => r.selectedIndex === null || r.selectedIndex === undefined).length;
    const wrong = Math.max(0, total - correct - unanswered);
    const hints = results.filter((r) => r.hintUsed).length;
    const hintLoss = results.filter((r) => r.hintUsed && r.isCorrect).length * 0.5;
    const accuracy = total ? Math.round((correct / total) * 100) : 0;
    const exam = o.mode === 'examone';

    // Intestazione del riquadro scuro
    const eyebrow = document.querySelector('#resultsView .result-card .eyebrow');
    if (eyebrow) eyebrow.textContent = o.label ? `Risultato · ${o.label}` : 'Risultato';

    // Giudizio + barra
    const summary = document.getElementById('resultSummary');
    if (summary) {
      const seg = (cls, n) => (n > 0 ? `<span class="${cls}" style="flex:${n}"></span>` : '');
      const examLine = exam
        ? (o.passed ? `Sopra la soglia di ${o.threshold} risposte corrette.` : `Servivano ${o.threshold} risposte corrette: ne mancavano ${Math.max(0, o.threshold - correct)}.`)
        : verdict(Number(o.vote || 0), correct, total);
      summary.innerHTML = `
        <p class="result-verdict">${esc(o.timeout ? `Tempo scaduto. ${examLine}` : examLine)}</p>
        <div class="result-split" role="img" aria-label="${esc(`${correct} corrette, ${wrong} errate${unanswered ? `, ${unanswered} senza risposta` : ''} su ${total}`)}">${seg('ok', correct)}${seg('no', wrong)}${seg('skip', unanswered)}</div>
        <ul class="result-legend">
          <li><i class="ok"></i>${plural(correct, 'corretta', 'corrette')}</li>
          <li><i class="no"></i>${plural(wrong, 'errata', 'errate')}</li>
          ${unanswered ? `<li><i class="skip"></i>${unanswered} senza risposta</li>` : ''}
        </ul>
        ${exam ? '<p class="result-note">Esito della sola simulazione del sito: non decide l’ammissione all’esame ufficiale.</p>' : ''}`;
    }
    const oldPanel = document.getElementById('mixedWeakPanel');
    if (oldPanel) { oldPanel.classList.add('hidden'); oldPanel.innerHTML = ''; }

    // Riquadri
    const perQuestion = total ? Math.round(Number(o.durationSeconds || 0) / total) : 0;
    const tiles = [
      tile({ tone: 'ok', icon: 'ok', label: 'Corrette', value: correct, unit: `/${total}`, bar: accuracy, sub: `${accuracy}% di precisione` }),
      tile({ tone: 'no', icon: 'no', label: 'Errate', value: wrong, sub: unanswered ? `più ${unanswered} senza risposta` : (wrong ? 'qui sotto con la spiegazione' : 'nessun errore') })
    ];
    if (exam) {
      const gap = correct - Number(o.threshold || 0);
      tiles.push(tile({ tone: o.passed ? 'ok' : 'no', icon: 'target', label: 'Soglia', value: o.threshold, unit: `/${total}`, sub: gap >= 0 ? `${plural(gap, 'risposta', 'risposte')} sopra la soglia` : `${plural(-gap, 'risposta', 'risposte')} sotto la soglia` }));
      tiles.push(tile({ icon: 'time', label: 'Tempo', value: esc(fmtDur(Number(o.durationSeconds || 0))), sub: total ? (perQuestion < 1 ? 'meno di 1 s a domanda' : `circa ${perQuestion} s a domanda`) : '' }));
    } else {
      tiles.push(tile({ tone: 'rope', icon: 'points', label: 'Punteggio', value: esc(fmtDec(o.points)), unit: `/${total}`, sub: hintLoss ? `−${esc(fmtDec(hintLoss))} per i suggerimenti` : '1 punto per risposta corretta' }));
      tiles.push(tile({ icon: 'time', label: 'Tempo', value: esc(fmtDur(Number(o.durationSeconds || 0))), sub: total ? (perQuestion < 1 ? 'meno di 1 s a domanda' : `circa ${perQuestion} s a domanda`) : '' }));
      tiles.push(tile({ icon: 'hint', label: 'Suggerimenti', value: hints, sub: hints ? 'mezzo punto in meno se poi rispondi giusto' : 'nessun aiuto usato' }));
      if (Number.isFinite(o.average) && Number(o.quizCount) > 0) {
        const n = Number(o.quizCount);
        const prev = n > 1 ? (Number(o.totalScore || o.average * n) - Number(o.vote || 0)) / (n - 1) : null;
        const diff = prev === null ? null : Number(o.vote || 0) - prev;
        const diffText = diff === null ? 'il tuo primo quiz registrato'
          : Math.abs(diff) < 0.05 ? 'questo quiz è in linea con la media'
          : `questo quiz: ${diff > 0 ? '+' : '−'}${esc(fmtVote(Math.abs(diff)))} rispetto a prima`;
        tiles.push(tile({ tone: diff !== null && diff > 0 ? 'ok' : '', icon: 'avg', label: 'La tua media', value: esc(fmtVote(o.average)), unit: '/10', sub: `${diffText} · ${plural(n, 'quiz', 'quiz')}` }));
      } else {
        tiles.push(tile({ icon: 'avg', label: 'Voto', value: esc(fmtVote(o.vote)), unit: '/10', sub: 'questo ripasso non entra nelle statistiche' }));
      }
    }
    const topics = topicsWithErrors(results);
    if (topics.length > 1 || exam) {
      const withErrors = topics.filter((t) => t.errors > 0).sort((a, b) => b.errors - a.errors || b.errors / b.total - a.errors / a.total || a.topic.localeCompare(b.topic, 'it'));
      if (!withErrors.length) {
        tiles.unshift(tile({ tone: 'ok', icon: 'party', label: 'Argomenti', value: 'Nessun errore in nessun argomento', wide: true, sub: `${plural(topics.length, 'argomento', 'argomenti')} in questo quiz, tutti giusti` }));
      } else {
        const top = withErrors[0];
        const others = withErrors.slice(1, 3).map((t) => `${esc(t.topic)} (${t.errors})`).join(' · ');
        tiles.unshift(tile({
          tone: 'no', icon: 'weak', wide: true,
          label: exam ? 'Argomento più debole' : 'Argomento con più errori',
          value: esc(top.topic),
          bar: top.total ? (top.errors / top.total) * 100 : 0,
          sub: `${plural(top.errors, 'errore', 'errori')} su ${plural(top.total, 'domanda', 'domande')}${others ? ` · poi: ${others}` : ''}`
        }));
      }
    }
    const box = document.getElementById('resultTiles');
    if (box) box.innerHTML = tiles.join('');

    // Revisione con filtro
    const head = document.getElementById('resultReviewHead');
    const review = document.getElementById('answersReview');
    if (head && review) {
      review.dataset.filter = 'all';
      const wrongTotal = wrong + unanswered;
      head.innerHTML = `<h3>Le tue risposte</h3>
        <div class="review-filter" role="group" aria-label="Filtra le risposte">
          <button type="button" data-review-filter="all" aria-pressed="true">Tutte <span>${total}</span></button>
          <button type="button" data-review-filter="wrong" aria-pressed="false" ${wrongTotal ? '' : 'disabled'}>Da rivedere <span>${wrongTotal}</span></button>
          <button type="button" data-review-filter="correct" aria-pressed="false" ${correct ? '' : 'disabled'}>Corrette <span>${correct}</span></button>
        </div>`;
      head.onclick = (event) => {
        const btn = event.target.closest('[data-review-filter]');
        if (!btn || btn.disabled) return;
        review.dataset.filter = btn.dataset.reviewFilter;
        head.querySelectorAll('[data-review-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      };
    }
  }

  window.QuizResults = Object.freeze({ render });
})();
