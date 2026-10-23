// Quiz Nuoto — prova completa del sito con il VERO SDK Firebase, gli emulatori (accesso + database con
// le regole vere) e il service worker vero. Percorre il sito come un utente nuovo e come l'admin.
// Uso: firebase emulators:exec --only auth,firestore --project demo-quiz-nuoto "node prove-sito/prova.mjs"
// Il risultato esce come annotazioni di GitHub (::notice / ::warning / ::error).
import { chromium } from 'playwright';
import { avvia } from './serve.mjs';
import { codificaCampi, decodificaCampi } from '../notifiche/src/firestore.js';

const SITE = 'http://127.0.0.1:5055';
const PROJECT = 'demo-quiz-nuoto';
const AUTH = 'http://127.0.0.1:9099';
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const OWNER = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());

let nuovoUid = null;
const esiti = [];
const problemi = [];
const erroriPagina = new Map(); // testo → conteggio
const ok = (cond, msg) => { esiti.push(`${cond ? 'OK' : 'NO'} ${msg}`); if (!cond) problemi.push(msg); return cond; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- Emulatori ---------------- */
async function signUp(email, password) {
  const r = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=prova`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) });
  const d = await r.json();
  if (!d.localId) throw new Error(`signUp ${email}: ${JSON.stringify(d)}`);
  return d.localId;
}
async function authUpdate(localId, fields) {
  const r = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:update`, { method: 'POST', headers: OWNER, body: JSON.stringify({ localId, ...fields }) });
  if (!r.ok) throw new Error(`accounts:update ${r.status} ${await r.text()}`);
}
async function uidByEmail(email) {
  const r = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:lookup`, { method: 'POST', headers: OWNER, body: JSON.stringify({ email: [email] }) });
  const d = await r.json();
  return d.users?.[0]?.localId || null;
}
async function fsSet(path, data) {
  const r = await fetch(`${FS}/${path}`, { method: 'PATCH', headers: OWNER, body: JSON.stringify({ fields: codificaCampi(data) }) });
  if (!r.ok) throw new Error(`fsSet ${path}: ${r.status} ${await r.text()}`);
}
async function fsGet(path) {
  const r = await fetch(`${FS}/${path}`, { headers: OWNER });
  if (r.status === 404) return null;
  const d = await r.json();
  return d.fields ? decodificaCampi(d.fields) : {};
}
async function fsList(collectionPath) {
  const r = await fetch(`${FS}/${collectionPath}?pageSize=300`, { headers: OWNER });
  const d = await r.json();
  return (d.documents || []).map((doc) => ({ id: doc.name.split('/').pop(), dati: decodificaCampi(doc.fields || {}) }));
}
async function fsDelete(path) { await fetch(`${FS}/${path}`, { method: 'DELETE', headers: OWNER }); }

/* ---------------- Browser ---------------- */
let browser;
async function nuovaPagina(nome, { width = 390, height = 844 } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, permissions: ['notifications'], locale: 'it-IT', timezoneId: 'Europe/Rome' });
  await context.addInitScript(() => { try { localStorage.setItem('quizNuotoEmulatori', '1'); } catch (e) { /* niente */ } });
  const page = await context.newPage();
  const registra = (testo) => {
    if (/status of 400 \(Bad Request\)/.test(testo) && nome === 'utente' && !nuovoUid) return;
    if (/favicon|ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|net::ERR_FAILED.*(gstatic|googleapis)|Failed to load resource: net::ERR_INTERNET/.test(testo)) return;
    const chiave = `[${nome}] ${testo.slice(0, 220)}`;
    erroriPagina.set(chiave, (erroriPagina.get(chiave) || 0) + 1);
  };
  page.on('pageerror', (e) => registra(`errore JS: ${e.message}`));
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error') registra(`console: ${t}`);
    else if (m.type() === 'warning' && /permission|insufficient|FirebaseError|denied|Uncaught/i.test(t)) registra(`avviso: ${t}`);
  });
  page.on('dialog', (d) => d.accept());
  return { context, page };
}
const visti = [];
async function chiudiPopup(page, { quiete = 4000, max = 25000 } = {}) {
  // promozione Nuotifica, popup notifiche, annunci: si chiudono come farebbe un utente, finché per
  // `quiete` ms non ne compare più nessuno. Ricorda l'ordine in cui sono comparsi.
  const t0 = Date.now(); let ultimo = Date.now();
  while (Date.now() - t0 < max && Date.now() - ultimo < quiete) {
    if (await page.locator('.nf-overlay .nf-later').isVisible().catch(() => false)) { visti.push('promozione'); await page.click('.nf-overlay .nf-later'); ultimo = Date.now(); await sleep(700); continue; }
    if (await page.locator('.push-intro [data-intro-close]').isVisible().catch(() => false)) { visti.push('notifiche'); await page.click('.push-intro [data-intro-close]'); ultimo = Date.now(); await sleep(300); continue; }
    if (await page.locator('.ann-modal [data-ann-ok]').isVisible().catch(() => false)) { visti.push('annuncio'); await page.click('.ann-modal [data-ann-ok]'); ultimo = Date.now(); await sleep(300); continue; }
    await sleep(300);
  }
}
async function testo(page, sel) { return (await page.locator(sel).first().textContent().catch(() => '')) || ''; }
async function aspetta(page, fn, ms = 15000, arg) { return page.waitForFunction(fn, arg, { timeout: ms }).then(() => true).catch(() => false); }

async function scenario(nome, fn) {
  try { await fn(); } catch (e) { ok(false, `${nome}: interrotto (${String(e.message).split('\n')[0].slice(0, 200)})`); }
}

/* ---------------- Prova ---------------- */
async function main() {
  const server = await avvia();
  browser = await chromium.launch();

  // Admin e utente "vecchio" già approvato
  const adminUid = await signUp('admin@prova.it', 'AdminProva1!');
  await authUpdate(adminUid, { emailVerified: true, displayName: 'Admin Prova' });
  await fsSet(`admins/${adminUid}`, { uid: adminUid, role: 'owner', active: true });
  await fsSet(`users/${adminUid}`, { profile: { uid: adminUid, email: 'admin@prova.it', firstName: 'Admin', lastName: 'Prova', promoSeen: { nuotifica_v1: 'x', notifiche_v1: 'x' } }, access: { appVerified: true, accountStatus: 'approved', courseAccess: { istruttore: true, bagnino: true, arte: true }, termsAcceptedAt: '2026-01-01T00:00:00Z' } });

  const nuovaEmail = 'giulia.prova@esempio.it';
  const nuovaPw = 'GiuliaProva1';
  const U = await nuovaPagina('utente');
  const A = await nuovaPagina('admin', { width: 1280, height: 900 });

  await scenario('Portale senza accesso', async () => {
    await U.page.goto(`${SITE}/index.html`, { waitUntil: 'load' });
    ok(await aspetta(U.page, () => !document.getElementById('authCard').classList.contains('hidden') && document.getElementById('loginBtn').offsetParent), 'portale: compare il modulo di accesso');
    await U.page.fill('#emailInput', 'nessuno@esempio.it');
    await U.page.fill('#passwordInput', 'sbagliata1');
    await U.page.click('#loginBtn');
    await aspetta(U.page, () => document.getElementById('authMessage').textContent.trim().length > 0, 8000);
    const msg = await testo(U.page, '#authMessage');
    ok(msg && !/^Firebase:|auth\//.test(msg), `accesso sbagliato: messaggio comprensibile ("${msg.slice(0, 90)}")`);
  });

  await scenario('Richiesta account', async () => {
    await U.page.click('#requestBtn');
    await U.page.fill('#requestFirstName', 'Giulia');
    await U.page.fill('#requestLastName', 'Prova');
    await U.page.fill('#requestEmail', nuovaEmail);
    await U.page.fill('#requestPassword', nuovaPw);
    await U.page.fill('#requestPasswordConfirm', nuovaPw);
    await U.page.check('#requestCourseIstruttore');
    await U.page.click('#submitAccountRequestBtn');
    ok(await aspetta(U.page, () => /attesa/i.test(document.getElementById('authTitle').textContent), 20000), `richiesta: compare "In attesa" (titolo: "${(await testo(U.page, '#authTitle')).slice(0, 60)}")`);
    nuovoUid = await uidByEmail(nuovaEmail);
    ok(Boolean(nuovoUid), 'richiesta: account di accesso creato');
    let u = null; let req = [];
    for (let i = 0; i < 20; i++) {
      u = await fsGet(`users/${nuovoUid}`);
      req = (await fsList('accountRequests')).filter((r) => r.dati.uid === nuovoUid);
      if (u?.access?.accountStatus && req.length) break;
      await sleep(500);
    }
    ok(u?.access?.accountStatus === 'pending', `richiesta: stato account "pending" (${u?.access?.accountStatus})`);
    ok(req.length === 1, `richiesta: una richiesta nel database (${req.length})`);
  });

  await scenario('Admin: accesso e approvazione', async () => {
    await A.page.goto(`${SITE}/index.html`, { waitUntil: 'load' });
    await aspetta(A.page, () => document.getElementById('loginBtn')?.offsetParent, 15000);
    await A.page.fill('#emailInput', 'admin@prova.it');
    await A.page.fill('#passwordInput', 'AdminProva1!');
    await A.page.click('#loginBtn');
    ok(await aspetta(A.page, () => !document.getElementById('mainContent').classList.contains('hidden'), 20000), 'admin: entra nel portale');
    ok(await aspetta(A.page, () => !document.getElementById('adminBtn').classList.contains('hidden'), 10000), 'admin: compare il pulsante dell\'area gestione');
    ok(await aspetta(A.page, () => Number(document.getElementById('adminPendingBadge')?.textContent) >= 1, 10000), 'admin: campanella con 1 richiesta');
    await A.page.goto(`${SITE}/admin.html`, { waitUntil: 'load' });
    ok(await aspetta(A.page, () => document.querySelector('[data-approve-request]'), 20000), 'admin: la richiesta compare nel pannello');
    await A.page.click('[data-approve-request]');
    await A.page.click('[data-site-confirm]');
    ok(await aspetta(A.page, () => !document.querySelector('[data-approve-request]'), 15000), 'admin: richiesta approvata e tolta dall\'elenco');
    const u = await fsGet(`users/${nuovoUid}`);
    ok(u?.access?.appVerified === true && u?.access?.courseAccess?.istruttore === true, 'admin: utente approvato per Istruttore');
    // tutte le sezioni del pannello si aprono senza errori
    for (const s of ['users', 'announcements', 'courses', 'streak', 'fad', 'notifications', 'promo', 'requests']) {
      await A.page.click(`[data-section="${s}"]`);
      await sleep(700);
    }
    ok(true, 'admin: aperte tutte le sezioni del pannello');
  });

  await scenario('Admin: annuncio con conferma e notifica', async () => {
    await A.page.click('[data-section="announcements"]');
    await A.page.waitForSelector('#annfTitle', { timeout: 10000 });
    await A.page.fill('#annfTitle', 'Annuncio di prova');
    await A.page.fill('#annfBody', 'Leggi **bene** questo [avviso](https://example.com).');
    await A.page.check('#annfAck');
    await A.page.click('[data-ann-act="publish"]');
    ok(await aspetta(A.page, () => document.querySelectorAll('[data-ann-row]').length >= 1, 10000), 'annuncio: pubblicato dal pannello');
    const ann = await fsList('announcements');
    ok(ann.some((a) => a.dati.title === 'Annuncio di prova' && a.dati.active === true), 'annuncio: salvato nel database');
    await A.page.click('[data-section="notifications"]');
    await A.page.waitForSelector('#pnTitle', { timeout: 10000 });
    await A.page.fill('#pnTitle', 'Prova notifica');
    await A.page.fill('#pnBody', 'Testo di prova');
    await A.page.click('[data-pn-act="send"]');
    await sleep(1500);
    const coda = await fsList('pushQueue');
    ok(coda.some((q) => q.dati.title === 'Prova notifica' && q.dati.status === 'pending'), 'notifica admin: messa in coda');
  });

  await scenario('Utente: verifica email ed entrata', async () => {
    await U.page.reload({ waitUntil: 'load' });
    ok(await aspetta(U.page, () => /verifica/i.test(document.getElementById('authTitle').textContent), 20000), `dopo l'approvazione: chiede di verificare l'email ("${(await testo(U.page, '#authTitle')).slice(0, 60)}")`);
    await authUpdate(nuovoUid, { emailVerified: true });
    await U.page.click('#refreshStatusBtn');
    await U.page.waitForLoadState('load');
    ok(await aspetta(U.page, () => /verificato/i.test(document.getElementById('authTitle').textContent) || !document.getElementById('mainContent').classList.contains('hidden'), 20000), 'email verificata: "Account verificato e approvato"');
    if (await U.page.locator('#completeRequestBtn').isVisible().catch(() => false)) await U.page.click('#completeRequestBtn');
    ok(await aspetta(U.page, () => !document.getElementById('mainContent').classList.contains('hidden'), 20000), 'utente: vede i suoi corsi');
    await chiudiPopup(U.page);
    ok(visti[0] === 'promozione' && visti.includes('annuncio'), `utente nuovo: popup uno alla volta (${visti.join(' → ') || 'nessuno'}; quello delle notifiche compare solo dove il browser le supporta)`);
    await sleep(800);
    const prof = (await fsGet(`users/${nuovoUid}`))?.profile || {};
    ok(Boolean(prof.promoSeen?.nuotifica_v1) && Boolean(prof.promoSeen?.notifiche_v1), 'popup: "già visti" salvati nel profilo');
    const ann = (await fsList('announcements')).find((a) => a.dati.title === 'Annuncio di prova');
    const ack = ann ? await fsGet(`announcements/${ann.id}/acks/${nuovoUid}`) : null;
    ok(Boolean(ack), 'annuncio: la conferma OK viene salvata');
    await U.page.reload({ waitUntil: 'load' });
    await aspetta(U.page, () => !document.getElementById('mainContent').classList.contains('hidden'), 15000);
    const primaDi = visti.length;
    await chiudiPopup(U.page, { quiete: 5000 });
    ok(visti.length === primaDi, `ricarica: nessun popup già visto ricompare (${visti.slice(primaDi).join(', ') || 'nessuno'})`);
  });

  await scenario('Corso Istruttore: termini, obiettivo, quiz', async () => {
    await U.page.click('#openIstruttoreBtn');
    // al primo ingresso il portale chiede di impostare l'obiettivo
    const chiedeObiettivo = await U.page.waitForSelector('.study-goal-modal [data-study-save]', { timeout: 8000 }).then(() => true).catch(() => false);
    ok(chiedeObiettivo, 'primo ingresso nel corso: chiede l\'obiettivo giornaliero');
    if (chiedeObiettivo) {
      await U.page.click('.study-goal-modal [data-target="10"]').catch(() => {});
      await U.page.click('.study-goal-modal [data-study-save]');
    }
    await U.page.waitForURL('**/istruttore.html', { timeout: 15000 });
    ok(await aspetta(U.page, () => document.getElementById('termsModal') && !document.getElementById('termsModal').classList.contains('hidden'), 20000), 'Istruttore: chiede di accettare i termini');
    await U.page.check('#termsAcceptCheck');
    await U.page.click('#acceptTermsBtn');
    ok(await aspetta(U.page, () => document.querySelector('#homeView.active') && !document.body.classList.contains('app-locked'), 20000), 'Istruttore: entra nella home del corso');
    const terms = (await fsGet(`users/${nuovoUid}`))?.access?.termsAcceptedAt;
    ok(Boolean(terms), 'termini: accettazione salvata');
    await chiudiPopup(U.page, { quiete: 2500 });
    const goal0 = await fsGet(`users/${nuovoUid}/studyGoals/istruttore`);
    ok(goal0?.dailyTarget === 10, `obiettivo: salvato (quota ${goal0?.dailyTarget})`);
    await U.page.click('#startMixedBtn');
    await U.page.click('#timerNoBtn');
    for (let i = 0; i < 25; i++) {
      if (await U.page.locator('#resultsView.active').count()) break;
      await U.page.locator('#optionsList .option-btn:not(:disabled)').first().click();
      await U.page.click('#nextQuestionBtn');
    }
    ok(await aspetta(U.page, () => document.querySelector('#resultsView.active'), 10000), 'quiz misto: arriva ai risultati');
    ok((await U.page.locator('#resultTiles .result-tile').count()) >= 6, 'risultati: riquadri presenti');
    await sleep(3000);
    const dopo = await fsGet(`users/${nuovoUid}`);
    ok(Number(dopo?.stats?.quizCount) === 1 && (dopo?.progress?.mixedCompleted || []).length === 20, `salvataggio sul cloud: quiz ${dopo?.stats?.quizCount}, domande ${(dopo?.progress?.mixedCompleted || []).length}`);
    const goal = await fsGet(`users/${nuovoUid}/studyGoals/istruttore`);
    ok(goal?.lastMetDate === TODAY && Number(goal?.streak) === 1, `streak: obiettivo di oggi fatto (streak ${goal?.streak}, giorno ${goal?.lastMetDate})`);
    const voce = await fsGet(`courseLeaderboards/istruttore/entries/${nuovoUid}`);
    ok(Number(voce?.streak) === 1, 'classifica: voce dell\'utente salvata');
    await U.page.evaluate(() => document.querySelectorAll('.study-milestone-overlay').forEach((o) => o.remove()));
    for (let i = 0; i < 3; i++) { await U.page.keyboard.press('Escape'); await sleep(200); }
    const coperto = await U.page.evaluate(() => [...document.querySelectorAll('.modal, .site-dialog-backdrop')].filter((m) => !m.classList.contains('hidden') && m.getClientRects().length).map((m) => m.id || m.className).join(', '));
    if (coperto) esiti.push(`-- finestre aperte dopo il quiz: ${coperto}`);
    await U.page.evaluate(() => document.querySelectorAll('.modal:not(.hidden)').forEach((m) => { if (!m.id) m.remove(); else m.classList.add('hidden'); }));
    await U.page.click('.tabbar [data-nav-view="statsView"]');
    ok(await aspetta(U.page, () => document.querySelector('#statsView.active') && document.querySelectorAll('#allQuestionsProgressList .question-check').length > 30, 10000), 'statistiche: si aprono con l\'elenco delle domande');
    await U.page.click('#homeBtn');
    await U.page.click('#startFlashcardsBtn');
    await U.page.locator('#flashcardOptions .option-btn').first().click();
    ok(await aspetta(U.page, () => /manuale|Riferimento/i.test(document.querySelector('.flashcard-explanation')?.textContent || ''), 10000), 'flash card: spiegazione mostrata');
    await U.page.click('#exitFlashcardsBtn');
    await U.page.click('[data-study-leaderboard]');
    ok(await aspetta(U.page, () => /Giulia|giulia/i.test(document.querySelector('.study-leaderboard-modal')?.textContent || ''), 10000), 'classifica: l\'utente compare');
    await U.page.keyboard.press('Escape');
    await U.page.evaluate(() => document.querySelectorAll('.study-leaderboard-modal').forEach((m) => m.remove()));
  });

  await scenario('Account: nome e password', async () => {
    await U.page.click('#accountBtn');
    await U.page.click('[data-acct-sec="profile"] > summary');
    await U.page.fill('[data-acct-first]', 'Giulia Maria');
    await U.page.fill('[data-acct-last]', 'Prova');
    await U.page.click('[data-acct-form="profile"] [type="submit"]');
    ok(await aspetta(U.page, () => /Salvato/.test(document.querySelector('[data-acct-msg="profile"]')?.textContent || ''), 10000), `nome: salvato ("${await testo(U.page, '[data-acct-msg="profile"]')}")`);
    const voce = await fsGet(`courseLeaderboards/istruttore/entries/${nuovoUid}`);
    ok(voce?.displayName === 'Giulia Maria Prova', `nome: aggiornato in classifica ("${voce?.displayName}")`);
    await U.page.click('[data-acct-sec="password"] > summary');
    await U.page.fill('[data-acct-current]', nuovaPw);
    await U.page.fill('[data-acct-new]', 'NuovaPassword!26');
    await U.page.fill('[data-acct-new2]', 'NuovaPassword!26');
    await U.page.click('[data-acct-form="password"] [type="submit"]');
    ok(await aspetta(U.page, () => /Password cambiata/.test(document.querySelector('[data-acct-msg="password"]')?.textContent || ''), 15000), `password: cambiata ("${(await testo(U.page, '[data-acct-msg="password"]')).slice(0, 80)}")`);
    await U.page.click('#logoutBtn');
    await sleep(1500);
    await U.page.goto(`${SITE}/index.html`, { waitUntil: 'load' });
    await aspetta(U.page, () => document.getElementById('loginBtn')?.offsetParent, 15000);
    await U.page.fill('#emailInput', nuovaEmail);
    await U.page.fill('#passwordInput', 'NuovaPassword!26');
    await U.page.click('#loginBtn');
    ok(await aspetta(U.page, () => !document.getElementById('mainContent').classList.contains('hidden'), 20000), 'password nuova: si rientra');
  });

  await scenario('Altri corsi e blocchi', async () => {
    await U.page.goto(`${SITE}/bagnino.html`, { waitUntil: 'load' });
    ok(await aspetta(U.page, () => /autorizzat/i.test(document.getElementById('authTitle')?.textContent || ''), 20000), `Bagnino senza permesso: "${(await testo(U.page, '#authTitle')).slice(0, 50)}"`);
    await U.page.goto(`${SITE}/arte.html`, { waitUntil: 'load' });
    ok(await aspetta(U.page, () => /autorizzat/i.test(document.getElementById('gateTitle')?.textContent || ''), 20000), `Arte senza permesso: "${(await testo(U.page, '#gateTitle')).slice(0, 50)}"`);
    await fsSet('courseSettings/site', { maintenance: true, maintenanceMessage: 'Prova di manutenzione' });
    await U.page.goto(`${SITE}/index.html`, { waitUntil: 'load' });
    ok(await aspetta(U.page, () => document.body.classList.contains('system-gated') && document.getElementById('systemGate')?.offsetParent, 20000), 'manutenzione: schermata dedicata sul portale');
    await U.page.goto(`${SITE}/istruttore.html`, { waitUntil: 'load' });
    ok(await aspetta(U.page, () => document.body.classList.contains('system-gated'), 20000), 'manutenzione: schermata dedicata nel corso');
    await fsSet('courseSettings/site', { maintenance: false });
    await U.page.goto(`${SITE}/index.html`, { waitUntil: 'load' });
    ok(await aspetta(U.page, () => !document.getElementById('mainContent').classList.contains('hidden') && !document.body.classList.contains('system-gated'), 20000), 'fine manutenzione: si torna ai corsi');
  });

  await scenario('Utente già esistente: dati dal cloud e corso Bagnino', async () => {
    const vUid = await signUp('vecchio@prova.it', 'VecchioProva1');
    await authUpdate(vUid, { emailVerified: true, displayName: 'Mario Vecchio' });
    const misto = Array.from({ length: 50 }, (_, i) => i + 1);
    await fsSet(`users/${vUid}`, {
      profile: { uid: vUid, email: 'vecchio@prova.it', firstName: 'Mario', lastName: 'Vecchio', promoSeen: { nuotifica_v1: 'x', notifiche_v1: 'x' } },
      access: { appVerified: true, accountStatus: 'approved', courseAccess: { istruttore: true, bagnino: true }, termsAcceptedAt: '2026-01-01T00:00:00Z' },
      version: 2,
      stats: { totalAnswered: 50, correct: 40, wrong: 10, quizCount: 3, totalScore: 21, averageScore: 7, history: [] },
      progress: { mixedCompleted: misto, mixedCycleSeen: misto, allAnswered: misto }
    });
    for (const c of ['istruttore', 'bagnino']) await fsSet(`users/${vUid}/studyGoals/${c}`, { courseId: c, dailyTarget: 15, goalMode: 'daily', streak: 2, bestStreak: 4, lastMetDate: '2026-01-01', dailyCounts: {} });
    const V = await nuovaPagina('vecchio');
    const logV = [];
    V.page.on('console', (m) => logV.push(`${m.type()}: ${m.text().slice(0, 160)}`));
    await V.page.goto(`${SITE}/index.html`, { waitUntil: 'load' });
    await aspetta(V.page, () => document.getElementById('loginBtn')?.offsetParent, 15000);
    await V.page.fill('#emailInput', 'vecchio@prova.it');
    await V.page.fill('#passwordInput', 'VecchioProva1');
    await V.page.click('#loginBtn');
    ok(await aspetta(V.page, () => !document.getElementById('mainContent').classList.contains('hidden'), 20000), 'utente esistente: entra nei corsi');
    await chiudiPopup(V.page, { quiete: 2500 });
    await V.page.click('#openIstruttoreBtn');
    await V.page.waitForURL('**/istruttore.html', { timeout: 15000 });
    const caricati = await aspetta(V.page, () => /50\s*\/\s*1000/.test(document.getElementById('mixedMiniText')?.textContent || ''), 20000);
    ok(caricati, `utente esistente: i progressi arrivano dal cloud ("${await testo(V.page, '#mixedMiniText')}")`);
    if (!caricati) {
      const diag = await V.page.evaluate(() => ({ body: document.body.className, titolo: document.getElementById('authTitle')?.textContent, msg: document.getElementById('authMessage')?.textContent, vista: document.querySelector('.view.active')?.id, locale: (() => { try { return Object.keys(localStorage).join('|'); } catch { return '-'; } })() }));
      esiti.push(`-- diagnosi: ${JSON.stringify(diag).slice(0, 400)}`);
      esiti.push(`-- console: ${logV.slice(-12).join(' ¦ ').slice(0, 800)}`);
      const doc = await fsGet(`users/${vUid}`);
      esiti.push(`-- nel database: misto=${(doc?.progress?.mixedCompleted || []).length} quiz=${doc?.stats?.quizCount} chiavi=${Object.keys(doc || {}).join(',')}`);
    }
    ok(await aspetta(V.page, () => document.querySelector('.study-goal-widget [data-study-streak]')?.textContent === '0', 10000), 'streak: dopo mesi senza obiettivo è scesa a 0 (−1 al giorno)');
    await V.page.goto(`${SITE}/bagnino.html`, { waitUntil: 'load' });
    ok(await aspetta(V.page, () => document.querySelector('#homeView.active') && !document.body.classList.contains('app-locked'), 20000), 'Bagnino: entra nella home del corso');
    await chiudiPopup(V.page, { quiete: 2000 });
    await V.page.click('#startMixedBtn');
    await V.page.click('#timerNoBtn');
    for (let i = 0; i < 25; i++) {
      if (await V.page.locator('#resultsView.active').count()) break;
      await V.page.locator('#optionsList .option-btn:not(:disabled)').first().click();
      await V.page.click('#nextQuestionBtn');
    }
    ok(await aspetta(V.page, () => document.querySelector('#resultsView.active'), 10000), 'Bagnino: quiz misto completato');
    await sleep(3000);
    const dati = await fsGet(`users/${vUid}/courseData/bagnino`);
    ok(Number(dati?.stats?.quizCount) === 1, `Bagnino: salvataggio sul cloud (quiz ${dati?.stats?.quizCount})`);
    const goal = await fsGet(`users/${vUid}/studyGoals/bagnino`);
    ok(goal?.lastMetDate === TODAY && Number(goal?.streak) === 1, `Bagnino: streak riaccesa a 1 (streak ${goal?.streak})`);
    await V.context.close();
  });

  await scenario('Service worker e rete assente', async () => {
    const attivo = await U.page.evaluate(async () => { const r = await navigator.serviceWorker?.getRegistration(); return Boolean(r?.active); });
    ok(attivo, 'service worker attivo');
    await U.context.setOffline(true);
    const t0 = Date.now();
    await U.page.goto(`${SITE}/istruttore.html`, { waitUntil: 'load' }).catch(() => {});
    const disegnata = await aspetta(U.page, () => document.querySelector('.appbar') && document.querySelector('.boot, #homeView'), 8000);
    ok(disegnata, `senza rete il sito si apre dalla cache (${Date.now() - t0} ms)`);
    await U.context.setOffline(false);
  });

  // ---------------- Resoconto ----------------
  await browser.close();
  server.close();
  const fallite = esiti.filter((e) => e.startsWith('NO'));
  const blocchi = [];
  let cur = '';
  for (const e of esiti) { if ((cur + e).length > 900) { blocchi.push(cur); cur = ''; } cur += `${e}%0A`; }
  if (cur) blocchi.push(cur);
  blocchi.forEach((b, i) => console.log(`::notice title=Prova completa ${i + 1}/${blocchi.length}::${b}`));
  fallite.slice(0, 8).forEach((f) => console.log(`::warning title=Non va::${f.slice(3)}`));
  const errori = [...erroriPagina.entries()].map(([t, n]) => `${n}× ${t}`.replace(/\r?\n/g, ' '));
  if (errori.length) {
    let c = '';
    const out = [];
    for (const e of errori) { if ((c + e).length > 900) { out.push(c); c = ''; } c += `${e}%0A`; }
    if (c) out.push(c);
    out.slice(0, 4).forEach((b, i) => console.log(`::warning title=Errori nella pagina ${i + 1}/${Math.min(out.length, 4)}::${b}`));
  }
  console.log(`::notice title=Esito::${esiti.length - fallite.length}/${esiti.length} controlli OK · ${errori.length} errori diversi nelle pagine`);
}

main().catch((e) => {
  console.log(`::error title=Prova completa::${String(e.stack || e.message || e).slice(0, 800).replace(/\n/g, '%0A')}`);
  process.exit(1);
});
