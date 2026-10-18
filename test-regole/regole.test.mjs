// Prove delle regole Firestore con l'emulatore, usando il VERO codice del sito (public/account-actions.js).
// Si avviano da GitHub Actions prima di ogni pubblicazione:
//   firebase emulators:exec --only firestore --project demo-quiz-nuoto "npm --prefix test-regole test"
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';

const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const actionsCode = readFileSync(new URL('../public/account-actions.js', import.meta.url), 'utf8');

let env;
let QuizAccount;
const FV = firebase.firestore.FieldValue;

/* ---------- Sessione finta: un utente del sito con il suo Firestore ---------- */
function fakeUser(uid, { email = `${uid}@esempio.it`, emailVerified = false } = {}) {
  return { uid, email, emailVerified, async updateProfile() {}, async reload() {}, async getIdToken() { return 'token'; } };
}
function session(uid, { email = `${uid}@esempio.it`, emailVerified = false, signedIn = true } = {}) {
  const db = env.authenticatedContext(uid, { email, email_verified: emailVerified }).firestore();
  const user = fakeUser(uid, { email, emailVerified });
  const auth = {
    currentUser: signedIn ? user : null,
    async createUserWithEmailAndPassword() { this.currentUser = user; return { user }; }
  };
  globalThis.window.FirebaseQuiz = { db, auth };
  return db;
}
async function read(path) {
  let data = null;
  await env.withSecurityRulesDisabled(async (ctx) => {
    const snap = await ctx.firestore().doc(path).get();
    data = snap.exists ? snap.data() : null;
  });
  return data;
}
async function requestsOf(uid) {
  const out = [];
  await env.withSecurityRulesDisabled(async (ctx) => {
    const snap = await ctx.firestore().collection('accountRequests').where('uid', '==', uid).get();
    snap.forEach((d) => out.push({ id: d.id, ...d.data() }));
  });
  return out;
}

before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-quiz-nuoto', firestore: { rules } });
  globalThis.window = { firebase };
  vm.runInThisContext(actionsCode, { filename: 'account-actions.js' });
  QuizAccount = globalThis.window.QuizAccount;
  assert.ok(QuizAccount, 'account-actions.js caricato');

  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc('admins/admin1').set({ uid: 'admin1', role: 'owner', active: true });
    await db.doc('users/admin1').set({ profile: { uid: 'admin1', email: 'admin1@esempio.it' } });
    await db.doc('users/approvato').set({
      profile: { uid: 'approvato', email: 'approvato@esempio.it', firstName: 'Anna', lastName: 'Rossi', emailVerified: true },
      access: { appVerified: true, accountStatus: 'approved', courseAccess: { istruttore: true } }
    });
    await db.doc('users/bannato').set({
      profile: { uid: 'bannato', email: 'bannato@esempio.it' },
      access: { banned: true, appVerified: false, accountStatus: 'banned' }
    });
    await db.doc('users/rifiutato').set({
      profile: { uid: 'rifiutato', email: 'rifiutato@esempio.it', firstName: 'Rino', lastName: 'Verdi' },
      access: { appVerified: false, accountStatus: 'rejected', rejectedCount: 1, canRequestReview: true, lastRejectedCourses: ['istruttore'] }
    });
  });
});

after(async () => { await env?.cleanup(); });

/* ---------- Nuovo account ---------- */
let nuovoRequestId = '';

test('nuovo account: crea utente in attesa e richiesta per lo staff', async () => {
  session('nuovo1', { signedIn: false });
  const res = await QuizAccount.call('create-account-request', {
    firstName: 'Nuovo', lastName: 'Utente', email: 'nuovo1@esempio.it', password: 'segreta1', requestedCourses: ['istruttore'], message: 'Ciao'
  });
  assert.equal(res.ok, true);
  assert.equal(res.status, 'pending');
  nuovoRequestId = res.requestId;
  const user = await read('users/nuovo1');
  assert.deepEqual(user.access.pendingCourses, ['istruttore']);
  assert.equal(user.access.accountStatus, 'pending');
  assert.equal(user.access.courseRequestStatus.istruttore, 'pending');
  assert.equal(user.access.appVerified, undefined, 'l\'utente non si dà permessi');
  const req = await read(`accountRequests/${res.requestId}`);
  assert.equal(req.uid, 'nuovo1');
  assert.deepEqual(req.requestedCourses, ['istruttore']);
});

test('nuovo account: la stessa richiesta due volte viene fermata', async () => {
  session('nuovo1');
  await assert.rejects(
    QuizAccount.call('create-account-request', { requestedCourses: ['istruttore'] }),
    /già inviata/
  );
});

test('profilo creato al primo accesso (solo profilo) è consentito, con permessi no', async () => {
  const db = session('fresco');
  await assertSucceeds(db.doc('users/fresco').set({ profile: { uid: 'fresco', email: 'fresco@esempio.it' } }, { merge: true }));
  const db2 = session('furbo');
  await assertFails(db2.doc('users/furbo').set({ profile: { uid: 'furbo' }, access: { appVerified: true, courseAccess: { istruttore: true } } }));
});

/* ---------- Utente già approvato ---------- */
test('utente approvato: richiede un altro corso', async () => {
  session('approvato', { emailVerified: true });
  const res = await QuizAccount.call('create-account-request', { requestedCourses: ['bagnino'], message: 'Richiesta accesso area Bagnino' });
  assert.equal(res.status, 'pending');
  const user = await read('users/approvato');
  assert.deepEqual(user.access.pendingCourses, ['bagnino']);
  assert.equal(user.access.accountStatus, 'approved', 'lo stato account non cambia');
  assert.equal(user.access.courseAccess.istruttore, true);
});

test('dati di studio, profilo e promo: l\'utente li salva liberamente', async () => {
  const db = session('approvato', { emailVerified: true });
  await assertSucceeds(db.doc('users/approvato').set({ version: 2, stats: { totalAnswered: 5, correct: 4 }, progress: { mixedCompleted: [1, 2, 3] } }, { merge: true }));
  await assertSucceeds(db.doc('users/approvato').set({ profile: { promoSeen: { nuotifica_v1: FV.serverTimestamp() } } }, { merge: true }));
  await assertSucceeds(db.doc('users/approvato/courseData/bagnino').set({ stats: { totalAnswered: 1 } }, { merge: true }));
});

test('termini: accettazione consentita', async () => {
  session('approvato', { emailVerified: true });
  const res = await QuizAccount.call('accept-terms', {});
  assert.equal(res.ok, true);
  const user = await read('users/approvato');
  assert.ok(user.access.termsAcceptedAt);
});

test('niente auto-promozioni: permessi, blocchi e rifiuti restano dell\'admin', async () => {
  const db = session('rifiutato');
  const ref = db.doc('users/rifiutato');
  await assertFails(ref.set({ access: { appVerified: true } }, { merge: true }));
  await assertFails(ref.set({ access: { courseAccess: { istruttore: true } } }, { merge: true }));
  await assertFails(ref.set({ access: { accountStatus: 'approved' } }, { merge: true }));
  await assertFails(ref.set({ access: { rejectedCount: 0 } }, { merge: true }));
  await assertFails(ref.set({ access: { canRequestReview: true, banned: false } }, { merge: true }));
  await assertFails(ref.set({ access: FV.delete() }, { merge: true }));
  const db2 = session('approvato', { emailVerified: true });
  await assertFails(db2.doc('users/approvato').set({ access: { courseAccess: { bagnino: true } } }, { merge: true }));
  await assertFails(db2.doc('users/rifiutato').set({ profile: { firstName: 'Hacker' } }, { merge: true }));
  // le chiavi della verifica email si toccano solo con il token "email verificata"
  const db3 = session('rifiutato');
  await assertFails(db3.doc('users/rifiutato').set({ access: { requiresEmailVerification: false } }, { merge: true }));
});

test('verifica email: solo con email davvero verificata', async () => {
  // token NON verificato: le regole rifiutano anche se il browser dice il contrario
  const db = env.authenticatedContext('approvato', { email: 'approvato@esempio.it', email_verified: false }).firestore();
  globalThis.window.FirebaseQuiz = { db, auth: { currentUser: fakeUser('approvato', { emailVerified: true }) } };
  await assert.rejects(QuizAccount.call('complete-verification', {}));
  // token verificato: va
  session('approvato', { emailVerified: true });
  const res = await QuizAccount.call('complete-verification', {});
  assert.equal(res.ok, true);
  const user = await read('users/approvato');
  assert.equal(user.access.requiresEmailVerification, false);
});

/* ---------- Bannati e corsi bloccati ---------- */
test('utente bannato: non può inviare richieste né toccare lo stato', async () => {
  const db = session('bannato');
  await assert.rejects(QuizAccount.call('create-account-request', { requestedCourses: ['istruttore'] }), /bloccato/);
  await assertFails(db.collection('accountRequests').add({
    uid: 'bannato', firstName: 'B', lastName: 'B', email: 'bannato@esempio.it', requestedCourses: ['istruttore'], message: '', status: 'pending', source: 'x', createdAt: FV.serverTimestamp(), updatedAt: FV.serverTimestamp()
  }));
  await assertFails(db.doc('users/bannato').set({ access: { pendingCourses: ['istruttore'], accountStatus: 'pending' } }, { merge: true }));
});

test('richieste: niente accesso anonimo e niente richieste a nome di altri', async () => {
  const anon = env.unauthenticatedContext().firestore();
  await assertFails(anon.collection('accountRequests').add({ uid: 'x', firstName: 'a', lastName: 'b', email: 'x@y.it', requestedCourses: ['istruttore'], message: '', status: 'pending', source: 'x' }));
  const db = session('approvato', { emailVerified: true });
  await assertFails(db.collection('accountRequests').add({ uid: 'nuovo1', firstName: 'a', lastName: 'b', email: 'x@y.it', requestedCourses: ['istruttore'], message: '', status: 'pending', source: 'x' }));
  await assertFails(db.collection('accountRequests').add({ uid: 'approvato', firstName: 'a', lastName: 'b', email: 'x@y.it', requestedCourses: ['istruttore'], message: '', status: 'approved', source: 'x' }));
});

test('richieste: ognuno legge solo le proprie', async () => {
  const db = session('approvato', { emailVerified: true });
  await assertSucceeds(db.collection('accountRequests').where('uid', '==', 'approvato').get());
  await assertFails(db.collection('accountRequests').where('uid', '==', 'nuovo1').get());
  await assertFails(db.collection('accountRequests').get());
});

/* ---------- Admin ---------- */
test('solo l\'admin approva', async () => {
  session('approvato', { emailVerified: true });
  await assert.rejects(QuizAccount.call('approve-account-request', { requestId: nuovoRequestId, approvedCourses: ['istruttore'] }));
});

test('admin: approva il nuovo account', async () => {
  session('admin1', { email: 'admin1@esempio.it', emailVerified: true });
  const res = await QuizAccount.call('approve-account-request', { requestId: nuovoRequestId, approvedCourses: ['istruttore'] });
  assert.equal(res.ok, true);
  const user = await read('users/nuovo1');
  assert.equal(user.access.appVerified, true);
  assert.equal(user.access.courseAccess.istruttore, true);
  assert.equal(user.access.accountStatus, 'approved');
  assert.equal(user.access.pendingCourses, undefined);
  assert.equal(user.access.requiresEmailVerification, true, 'email da verificare per il nuovo account');
  assert.equal(user.access.courseRequestStatus?.istruttore, undefined);
  assert.equal(await read(`accountRequests/${nuovoRequestId}`), null, 'richiesta tolta');
});

test('admin: rifiuta un corso, l\'utente chiede un ricontrollo, secondo rifiuto = corso bloccato', async () => {
  // primo rifiuto del corso Bagnino chiesto da "approvato"
  const [req1] = (await requestsOf('approvato')).filter((r) => r.requestedCourses.includes('bagnino'));
  session('admin1', { email: 'admin1@esempio.it', emailVerified: true });
  const r1 = await QuizAccount.call('reject-account-request', { requestId: req1.id, note: 'Manca il certificato' });
  assert.equal(r1.courseOnly, true);
  let user = await read('users/approvato');
  assert.equal(user.access.courseRequestStatus.bagnino, 'rejected');
  assert.equal(user.access.courseCanRequestReview.bagnino, true);
  assert.equal(user.access.courseRejectedCount.bagnino, 1);
  assert.deepEqual(user.access.pendingCourses, undefined);

  // ricontrollo
  session('approvato', { emailVerified: true });
  const res = await QuizAccount.call('create-account-request', { requestedCourses: ['bagnino'], reviewRequest: true });
  assert.equal(res.status, 'review');
  user = await read('users/approvato');
  assert.equal(user.access.courseRequestStatus.bagnino, 'review');
  assert.equal(user.access.courseReviewPending.bagnino, true);
  assert.equal(user.access.courseCanRequestReview?.bagnino, undefined);

  // secondo rifiuto → corso bloccato
  session('admin1', { email: 'admin1@esempio.it', emailVerified: true });
  const r2 = await QuizAccount.call('reject-account-request', { requestId: res.requestId, note: 'No' });
  assert.equal(r2.courseBlocked, true);
  user = await read('users/approvato');
  assert.equal(user.access.courseBlocked.bagnino, true);
  assert.equal(user.access.courseRequestStatus.bagnino, 'blocked');

  // ora non può più chiederlo, nemmeno aggirando il sito
  const db = session('approvato', { emailVerified: true });
  await assert.rejects(QuizAccount.call('create-account-request', { requestedCourses: ['bagnino'] }), /bloccato/);
  await assertFails(db.collection('accountRequests').add({
    uid: 'approvato', firstName: 'Anna', lastName: 'Rossi', email: 'approvato@esempio.it', requestedCourses: ['bagnino'], message: '', status: 'pending', source: 'x', createdAt: FV.serverTimestamp(), updatedAt: FV.serverTimestamp()
  }));
  await assertFails(db.doc('users/approvato').set({ access: { courseBlocked: { bagnino: false } } }, { merge: true }));
});

test('account rifiutato: ricontrollo e secondo rifiuto = account bloccato', async () => {
  session('rifiutato');
  const res = await QuizAccount.call('create-account-request', { requestedCourses: ['istruttore'], reviewRequest: true, message: 'Ricontrollo' });
  assert.equal(res.status, 'review');
  let user = await read('users/rifiutato');
  assert.equal(user.access.accountStatus, 'review');
  assert.equal(user.access.reviewPending, true);
  session('admin1', { email: 'admin1@esempio.it', emailVerified: true });
  const r = await QuizAccount.call('reject-account-request', { requestId: res.requestId, note: 'Definitivo' });
  assert.equal(r.banned, true);
  user = await read('users/rifiutato');
  assert.equal(user.access.banned, true);
  assert.equal(user.access.accountStatus, 'banned');
});

/* ---------- Impostazioni e promozione ---------- */
test('impostazioni (manutenzione, promo Nuotifica): leggono tutti, scrive solo l\'admin', async () => {
  const db = session('approvato', { emailVerified: true });
  await assertSucceeds(db.doc('courseSettings/promo').get());
  await assertFails(db.doc('courseSettings/promo').set({ bannerEnabled: false }, { merge: true }));
  const adminDb = session('admin1', { email: 'admin1@esempio.it', emailVerified: true });
  await assertSucceeds(adminDb.doc('courseSettings/promo').set({ bannerEnabled: true, popupVersion: 2 }, { merge: true }));
});

/* ---------- Annunci, conferme "OK" e notifiche ---------- */
test('annunci: l\'admin pubblica, l\'utente legge solo quelli attivi e suoi, e conferma solo per sé', async () => {
  const adminDb = session('admin1', { email: 'admin1@esempio.it', emailVerified: true });
  const base = { version: 2, body: '**Ciao**', message: 'Ciao', display: 'popup', tone: 'info', requireAck: true, frequency: 'once', createdAt: FV.serverTimestamp() };
  await assertSucceeds(adminDb.doc('announcements/a1').set({ ...base, title: 'Per tutti', scope: 'global', active: true }));
  await assertSucceeds(adminDb.doc('announcements/a2').set({ ...base, title: 'Solo Anna', scope: 'user', targetUid: 'approvato', active: true }));
  await assertSucceeds(adminDb.doc('announcements/a3').set({ ...base, title: 'Bozza', scope: 'global', active: false }));

  const db = session('approvato', { emailVerified: true });
  await assertFails(db.doc('announcements/a1').set({ title: 'x' }, { merge: true }));
  const glob = await assertSucceeds(db.collection('announcements').where('active', '==', true).where('scope', '==', 'global').get());
  assert.deepEqual(glob.docs.map((d) => d.id), ['a1']);
  const mine = await assertSucceeds(db.collection('announcements').where('active', '==', true).where('scope', '==', 'user').where('targetUid', '==', 'approvato').get());
  assert.deepEqual(mine.docs.map((d) => d.id), ['a2']);
  await assertFails(db.doc('announcements/a3').get());

  await assertSucceeds(db.doc('announcements/a1/acks/approvato').set({ uid: 'approvato', name: 'Anna Rossi', rev: 0, at: FV.serverTimestamp() }));
  await assertSucceeds(db.doc('announcements/a1/acks/approvato').get());
  await assertFails(db.doc('announcements/a1/acks/admin1').set({ uid: 'admin1', name: 'finto', at: FV.serverTimestamp() }));
  await assertFails(db.doc('announcements/a1/acks/approvato').set({ uid: 'approvato', at: FV.serverTimestamp(), extra: true }));
  await assertFails(db.doc('announcements/a1/acks/admin1').get());

  const adminAgain = session('admin1', { email: 'admin1@esempio.it', emailVerified: true });
  const acks = await assertSucceeds(adminAgain.collection('announcements/a1/acks').get());
  assert.equal(acks.size, 1);
});

test('notifiche: l\'utente salva i suoi dispositivi, la coda di invio è solo dell\'admin', async () => {
  const db = session('approvato', { emailVerified: true });
  await assertSucceeds(db.doc('users/approvato').set({ push: { tokens: FV.arrayUnion('tok-1'), enabled: true, streak: true, updatedAt: FV.serverTimestamp() } }, { merge: true }));
  await assertSucceeds(db.doc('users/approvato').set({ push: { tokens: FV.arrayRemove('tok-1'), enabled: false } }, { merge: true }));
  await assertFails(db.doc('users/approvato').set({ push: { tokens: ['x'] }, access: { appVerified: true, courseAccess: { bagnino: true } } }, { merge: true }));
  await assertFails(db.collection('pushQueue').add({ title: 'Spam', body: 'x', status: 'pending', target: { type: 'all' } }));
  await assertFails(db.collection('pushQueue').get());
  await assertFails(db.doc('meta/promemoria').get());

  const adminDb = session('admin1', { email: 'admin1@esempio.it', emailVerified: true });
  const ref = await assertSucceeds(adminDb.collection('pushQueue').add({ title: 'Ciao', body: 'Prova', url: 'index.html', target: { type: 'all' }, status: 'pending', createdAt: FV.serverTimestamp(), createdBy: 'admin1' }));
  await assertSucceeds(adminDb.collection('pushQueue').get());
  await assertSucceeds(ref.delete());
  await assertSucceeds(adminDb.doc('courseSettings/notifiche').set({ streakReminders: true, hours: [18, 21] }, { merge: true }));
});
