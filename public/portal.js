(() => {
  'use strict';
  const OWNER_ADMIN_UID = 'uPsEYGwQwrXZEwt5KID6DnVt51p2';
  const els = {};
  let currentUser = null;
  let accountData = null;
  let isAdmin = false;
  let userUnsubscribe = null;
  let courseSettings = { istruttore: {}, bagnino: {}, arte: {} };
  document.addEventListener('DOMContentLoaded', init);

  function init() {
    ['themeToggle','adminBellBtn','adminPendingBadge','adminBtn','logoutBtn','authCard','authTitle','authSubtitle','authStatus','authControls','emailInput','passwordInput','loginBtn','googleBtn','requestBtn','forgotPasswordBtn','authMessage','approvalActions','refreshStatusBtn','sendVerificationBtn','requestReviewBtn','completeRequestBtn','mainContent','courseAccessStats','courseIstruttoreCard','courseBagninoCard','courseArteCard','openIstruttoreBtn','openBagninoBtn','openArteBtn','requestIstruttoreBtn','requestBagninoBtn','requestArteBtn','istruttoreLockText','bagninoLockText','arteLockText','artePortalTimer','accountRequestModal','accountRequestCloseBtn','requestFirstName','requestLastName','requestEmail','requestPassword','requestPasswordConfirm','requestCourseIstruttore','requestCourseBagnino','requestCourseArte','requestMessage','submitAccountRequestBtn','accountRequestMessage','toast'].forEach(id => els[id]=document.getElementById(id));
    setupTheme(); bindEvents(); setupAuth(); setInterval(updateArtePortalTimer, 60000);
    if (location.hash === '#request') openAccountRequestModal();
  }
  function bindEvents(){
    els.themeToggle?.addEventListener('click', toggleTheme);
    els.loginBtn?.addEventListener('click', login);
    els.googleBtn?.addEventListener('click', loginWithGoogle);
    els.requestBtn?.addEventListener('click', () => openAccountRequestModal());
    els.forgotPasswordBtn?.addEventListener('click', forgotPassword);
    els.logoutBtn?.addEventListener('click', logout);
    els.adminBtn?.addEventListener('click', () => location.href='admin.html');
    els.adminBellBtn?.addEventListener('click', () => location.href='admin.html');
    els.accountRequestCloseBtn?.addEventListener('click', closeAccountRequestModal);
    els.submitAccountRequestBtn?.addEventListener('click', submitAccountRequest);
    els.openIstruttoreBtn?.addEventListener('click', () => openCourse('istruttore'));
    els.openBagninoBtn?.addEventListener('click', () => openCourse('bagnino'));
    els.openArteBtn?.addEventListener('click', () => openCourse('arte'));
    els.requestIstruttoreBtn?.addEventListener('click', () => requestCourseAccess('istruttore'));
    els.requestBagninoBtn?.addEventListener('click', () => requestCourseAccess('bagnino'));
    els.requestArteBtn?.addEventListener('click', () => requestCourseAccess('arte'));
    els.refreshStatusBtn?.addEventListener('click', async () => { await currentUser?.reload?.(); location.reload(); });
    els.sendVerificationBtn?.addEventListener('click', sendVerificationEmailManual);
    els.requestReviewBtn?.addEventListener('click', requestAccountReview);
  }
  function setupAuth(){
    const fb=window.FirebaseQuiz;
    if(!fb?.configured){ setLoginState('Firebase non configurato','Configura firebase-config.js.','Errore'); return; }
    fb.auth.getRedirectResult?.().catch((error)=>setMessage(error.message));
    fb.auth.onAuthStateChanged(async (user)=>{
      currentUser=user; accountData=null; isAdmin=false; els.adminBtn?.classList.add('hidden');
      if (userUnsubscribe) { try { userUnsubscribe(); } catch {} userUnsubscribe = null; }
      if(!user){
        showLoginGate('Accesso richiesto','Accedi oppure invia una richiesta account scegliendo il corso che ti serve.','Login');
        return;
      }
      try{
        await ensureBootstrapAdmin(user);
        isAdmin=await checkIsAdmin(user.uid);
        if(isAdmin) {
          els.adminBtn?.classList.remove('hidden');
          els.adminBellBtn?.classList.remove('hidden');
          await loadAdminPendingCount();
        }
        await loadCourseSettings();
        const snap=await db().collection('users').doc(user.uid).get();
        accountData=snap.exists ? snap.data() : {};
        await ensureUserProfile(user, accountData);
        userUnsubscribe = db().collection('users').doc(user.uid).onSnapshot(async (docSnap) => {
          accountData = docSnap.exists ? (docSnap.data() || {}) : {};
          await renderAccountState();
        }, (error) => {
          showStatusGate('Errore account', escapeHtml(error.message), 'Errore');
        });
      }catch(error){ showStatusGate('Errore account', escapeHtml(error.message), 'Errore'); }
    });
  }

  async function renderAccountState(){
    const access = getAccess();
    if (!currentUser) return showLoginGate('Accesso richiesto','Accedi oppure invia una richiesta account scegliendo il corso che ti serve.','Login');

    if (isAdmin) {
      els.authCard.classList.add('hidden');
      els.authCard.classList.remove('status-gate-card');
      els.mainContent.classList.remove('hidden');
      els.logoutBtn.classList.remove('hidden');
      els.approvalActions?.classList.add('hidden');
      renderCourses();
      loadPortalAnnouncements();
      return;
    }

    const site = getCourseGlobalState('site');
    if (site.maintenance) {
      return showStatusGate('Sito in manutenzione', `Il sito è temporaneamente in manutenzione.${site.maintenanceMessage ? `<br>${escapeHtml(site.maintenanceMessage)}` : ''}<br>Riprova più tardi.`, 'Manutenzione', { state: 'banned' });
    }
    if (site.blocked) {
      return showStatusGate('Sito non disponibile', `L’accesso al sito è stato bloccato per tutti gli utenti.${site.blockReason ? `<br><strong>Motivo:</strong> ${escapeHtml(site.blockReason)}` : ''}`, 'Bloccato', { state: 'banned' });
    }

    if (access.banned) {
      return showStatusGate('Account bloccato', `Questo account è stato bloccato.${access.banReason ? `<br><strong>Motivo:</strong> ${escapeHtml(access.banReason)}` : ''}<br>Solo lo staff può sbloccarlo.`, 'Bloccato', { state: 'banned' });
    }

    const allowedCourses = getAllowedCourses();
    const hasAnyCourse = allowedCourses.length > 0;

    if (!hasAnyCourse) {
      if (access.reviewPending || access.accountStatus === 'review') {
        return showStatusGate('Attesa di revisione', 'La richiesta di ricontrollo è stata inviata. Attendi la nuova valutazione dello staff.', 'Revisione', { state: 'review' });
      }
      if (access.accountStatus === 'rejected') {
        const reason = access.lastRejectNote || 'Richiesta non approvata.';
        return showStatusGate('Utente rifiutato', `La richiesta è stata rifiutata.<br><strong>Motivo:</strong> ${escapeHtml(reason)}<br>Puoi inviare una sola richiesta di ricontrollo. Se viene rifiutata di nuovo, l’account sarà bloccato.`, 'Rifiutato', { review: true, state: 'rejected' });
      }
      const pending = Array.isArray(access.pendingCourses) ? access.pendingCourses : [];
      if (pending.length || access.accountStatus === 'pending') {
        const pendingText = pending.length ? pending.map(courseLabel).join(', ') : 'corso richiesto';
        return showStatusGate('In attesa dell’approvazione', `Account in attesa di approvazione per: <strong>${escapeHtml(pendingText)}</strong>.<br>Quando la richiesta sarà approvata, passerai alla verifica email se richiesta.`, 'In attesa', { state: 'pending' });
      }
      return showStatusGate('Completa la richiesta accesso', 'Hai effettuato l’accesso. Ora seleziona il corso che vuoi richiedere; lo staff dovrà approvare prima di farti entrare.', 'Richiesta necessaria', { complete: true, state: 'start' });
    }

    const mustVerifyEmail = access.requiresEmailVerification === true && access.verificationRequiredVersion === 'v24' && !currentUser.emailVerified;
    if (mustVerifyEmail) {
      await maybeSendVerificationEmail();
      return showStatusGate('Verifica la tua email', 'Account approvato. Ora devi verificare la tua email: ti abbiamo inviato il link di verifica. Dopo aver cliccato il link, torna qui e premi “Controlla stato”.', 'Email da verificare', { verification: true, state: 'verify' });
    }

    if (access.requiresEmailVerification === true && currentUser.emailVerified) {
      return showStatusGate('Account verificato e approvato', 'La tua email è verificata e l’account è stato approvato. Premi <strong>Entra nel sito</strong> per accedere alla scelta corsi.', 'Completato', { enter: true, state: 'done' });
    }

    els.authCard.classList.add('hidden');
    els.authCard.classList.remove('status-gate-card');
    els.mainContent.classList.remove('hidden');
    els.logoutBtn.classList.remove('hidden');
    els.approvalActions?.classList.add('hidden');
    renderCourses();
    loadPortalAnnouncements();
  }

  async function ensureBootstrapAdmin(user){
    if(user.uid!==OWNER_ADMIN_UID) return;
    await db().collection('admins').doc(user.uid).set({ uid:user.uid, email:user.email||'christiancaputi09@gmail.com', role:'owner', active:true, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, {merge:true});
  }
  async function checkIsAdmin(uid){ const snap=await db().collection('admins').doc(uid).get(); return Boolean(snap.exists && snap.data()?.active); }

  function courseLabel(course){
    if (course === 'arte') return 'Arte · Quinto Liceo'; return course === 'bagnino' ? 'Assistenti Bagnanti Piscina' : 'Istruttore di Nuoto'; }
  function getAllowedCourses(){
    const access = getAccess();
    const ca = access.courseAccess || {};
    const out = [];
    if (isAdmin || ca.istruttore === true || (access.appVerified && Object.keys(ca).length === 0)) out.push('istruttore');
    if (isAdmin || ca.bagnino === true) out.push('bagnino');
    if (isAdmin || ca.arte === true) out.push('arte');
    return [...new Set(out)];
  }
  function showLoginGate(title, subtitle, status){
    els.authCard.classList.remove('hidden', 'status-gate-card');
    els.mainContent.classList.add('hidden');
    els.logoutBtn?.classList.add('hidden');
    els.approvalActions?.classList.add('hidden');
    els.authControls?.classList.remove('hidden');
    setLoginState(title, subtitle, status);
  }
  function showStatusGate(title, html, status, opts={}){
    els.authCard.classList.remove('hidden');
    els.authCard.classList.add('status-gate-card');
    els.mainContent.classList.add('hidden');
    els.logoutBtn?.classList.remove('hidden');
    els.authControls?.classList.add('hidden');
    els.approvalActions?.classList.remove('hidden');
    setLoginState(title, `${buildProgressHtml(opts.state || 'pending')}<div class="status-gate-copy">${html}</div>`, status);
    els.authMessage.textContent = '';
    els.sendVerificationBtn?.classList.toggle('hidden', !opts.verification);
    els.requestReviewBtn?.classList.toggle('hidden', !opts.review);
    els.completeRequestBtn?.classList.toggle('hidden', !opts.complete && !opts.enter);
    if (els.completeRequestBtn) els.completeRequestBtn.textContent = opts.enter ? 'Entra nel sito' : 'Completa richiesta accesso';
    if (opts.enter && els.completeRequestBtn) els.completeRequestBtn.onclick = enterVerifiedSite;
    else if (els.completeRequestBtn) els.completeRequestBtn.onclick = () => openAccountRequestModal();
    els.refreshStatusBtn?.classList.toggle('hidden', Boolean(opts.enter));
  }
  function buildProgressHtml(state){
    const steps = [
      ['start', 'Richiesta'],
      ['pending', 'Approvazione'],
      ['verify', 'Verifica email'],
      ['done', 'Accesso corsi']
    ];
    let index = 0;
    if (state === 'pending' || state === 'review') index = 1;
    if (state === 'verify') index = 2;
    if (state === 'done') index = 3;
    if (state === 'rejected' || state === 'banned') index = 1;
    const percent = Math.round((index / (steps.length - 1)) * 100);
    const cls = state === 'rejected' ? ' rejected' : state === 'banned' ? ' banned' : state === 'review' ? ' review' : '';
    return `<div class="approval-progress${cls}">
      <div class="approval-progress-top"><span>Stato account</span><strong>${percent}%</strong></div>
      <div class="approval-bar"><span style="width:${percent}%"></span></div>
      <div class="approval-steps">${steps.map((step, i) => `<span class="${i < index ? 'done' : i === index ? 'active' : ''}">${step[1]}</span>`).join('')}</div>
    </div>`;
  }

  function verificationActionSettings(){
    return { url: `${location.origin}${location.pathname.replace(/[^/]*$/, '')}index.html?emailVerified=1`, handleCodeInApp: false };
  }
  async function maybeSendVerificationEmail(){
    if (!currentUser || currentUser.emailVerified) return;
    const key = `quizNuotoVerificationSent:${currentUser.uid}`;
    if (localStorage.getItem(key)) return;
    try { await currentUser.sendEmailVerification(verificationActionSettings()); localStorage.setItem(key, String(Date.now())); }
    catch (error) { console.warn('Invio verifica email non riuscito:', error); }
  }
  async function sendVerificationEmailManual(){
    if (!currentUser) return;
    try { await currentUser.sendEmailVerification(verificationActionSettings()); showToast('Email di verifica inviata. Controlla anche spam/promozioni.'); }
    catch (error) { showToast(error.message); }
  }
  async function enterVerifiedSite(){
    if (!currentUser) return;
    try { await currentUser.reload(); await currentUser.getIdToken(true); } catch {}
    if (!currentUser.emailVerified) return showToast('Email non ancora verificata. Dopo aver cliccato il link, premi “Controlla stato”.');
    try {
      const result = await callPublicFunction('complete-verification', {}, true);
      accountData = result.user || accountData || {};
      accountData.access = accountData.access || {};
      accountData.access.requiresEmailVerification = false;
      accountData.access.appVerified = true;
      accountData.profile = accountData.profile || {};
      accountData.profile.emailVerified = true;
      els.authCard.classList.add('hidden');
      els.authCard.classList.remove('status-gate-card');
      els.mainContent.classList.remove('hidden');
      els.logoutBtn.classList.remove('hidden');
      els.approvalActions?.classList.add('hidden');
      renderCourses();
      loadPortalAnnouncements();
    } catch (error) { showToast(error.message); }
  }
  async function requestAccountReview(){
    const access = getAccess();
    const requestedCourses = Array.isArray(access.lastRejectedCourses) && access.lastRejectedCourses.length ? access.lastRejectedCourses : (Array.isArray(access.pendingCourses) ? access.pendingCourses : ['istruttore']);
    try{
      await callPublicFunction('create-account-request', { requestedCourses, reviewRequest:true, message:'Richiesta ricontrollo account dopo rigetto' }, true);
      showToast('Richiesta di ricontrollo inviata.');
    }catch(error){ showToast(error.message); }
  }
  async function ensureUserProfile(user, data){
    await db().collection('users').doc(user.uid).set({ profile:{ uid:user.uid, email:user.email||'', displayName:user.displayName||'', emailVerified:Boolean(user.emailVerified), lastLoginAt: firebase.firestore.FieldValue.serverTimestamp(), createdAt: data?.profile?.createdAt || firebase.firestore.FieldValue.serverTimestamp() } }, {merge:true});
  }
  function getAccess(){ return accountData?.access || {}; }
  async function loadCourseSettings(){
    try {
      const snap = await db().collection('courseSettings').get();
      const next = {};
      snap.forEach((doc) => { next[doc.id] = doc.data() || {}; });
      courseSettings = next;
    } catch { /* in caso di errore lasciamo i corsi non bloccati globalmente */ }
  }
  function getCourseGlobalState(course){ return courseSettings[course] || {}; }
  function hasCourse(course){
    if(isAdmin) return true;
    const g = getCourseGlobalState(course);
    if (g.hidden || g.blocked || g.maintenance) return false;
    const access=getAccess();
    if(access.banned || !access.appVerified) return false;
    const ca=access.courseAccess || {};
    if(course==='istruttore') return ca.istruttore === true || (access.appVerified && Object.keys(ca).length === 0);
    return Boolean(ca[course]);
  }
  function getCourseRequestStatus(course){
    const access=getAccess();
    if (access.courseBlocked?.[course] === true) return 'blocked';
    if (access.courseRequestStatus?.[course]) return access.courseRequestStatus[course];
    if (Array.isArray(access.pendingCourses) && access.pendingCourses.includes(course)) return 'pending';
    return '';
  }
  function getCourseRejectReason(course){
    const access=getAccess();
    return access.courseRejectNotes?.[course] || access.lastCourseRejectNote || '';
  }
  function isCoursePending(course){
    const status = getCourseRequestStatus(course);
    return status === 'pending' || status === 'review';
  }
  function canRequestCourseReview(course){
    const access=getAccess();
    return access.courseCanRequestReview?.[course] === true && access.courseBlocked?.[course] !== true;
  }
  function renderCourses(){
    const access=getAccess();
    const istr=hasCourse('istruttore');
    const bag=hasCourse('bagnino');
    const arte=hasCourse('arte');
    if (els.courseAccessStats) els.courseAccessStats.innerHTML=`<div class="hero-stat"><strong>${istr?'OK':'🔒'}</strong><span>Istruttore</span></div><div class="hero-stat"><strong>${bag?'OK':'🔒'}</strong><span>Bagnino piscina</span></div><div class="hero-stat"><strong>${arte?'OK':'🔒'}</strong><span>Arte</span></div>`;
    updateCourseCard('istruttore', istr, els.courseIstruttoreCard, els.openIstruttoreBtn, els.requestIstruttoreBtn, els.istruttoreLockText);
    updateCourseCard('bagnino', bag, els.courseBagninoCard, els.openBagninoBtn, els.requestBagninoBtn, els.bagninoLockText);
    updateCourseCard('arte', arte, els.courseArteCard, els.openArteBtn, els.requestArteBtn, els.arteLockText);
    updateArtePortalTimer();
    showCourseRejectionNoticeOnce('istruttore');
    showCourseRejectionNoticeOnce('bagnino');
    showCourseRejectionNoticeOnce('arte');
    // Il riquadro streak del portale mostra solo i corsi visibili e sbloccati: si aggiorna dopo le card.
    window.QuizStudyTracker?.refresh?.();
    if(access.banned){ showToast('Account bloccato. Contatta lo staff.'); }
  }
  function updateCourseCard(course, allowed, card, openBtn, requestBtn, textEl){
    const g = getCourseGlobalState(course);
    const globalHidden = Boolean(g.hidden) && !isAdmin;
    card.classList.toggle('hidden', globalHidden);
    if (globalHidden) return;

    const globalBlocked = Boolean(g.blocked) && !isAdmin;
    const globalMaintenance = Boolean(g.maintenance) && !isAdmin;
    const status = getCourseRequestStatus(course);
    const pending = !allowed && (status === 'pending' || status === 'review') && !globalBlocked && !globalMaintenance;
    const blocked = (!allowed && status === 'blocked') || globalBlocked;
    const rejected = !allowed && status === 'rejected' && !globalBlocked && !globalMaintenance;
    const reason = getCourseRejectReason(course);
    const effectiveAllowed = allowed && !globalBlocked && !globalMaintenance;
    card.classList.toggle('locked', !effectiveAllowed);
    card.classList.toggle('unlocked', effectiveAllowed);
    card.classList.toggle('course-rejected', rejected);
    card.classList.toggle('course-blocked', blocked);
    card.classList.toggle('course-review', status === 'review' && !globalBlocked && !globalMaintenance);
    card.classList.toggle('course-maintenance', globalMaintenance);
    openBtn.disabled=!effectiveAllowed;
    openBtn.classList.toggle('hidden', !effectiveAllowed);
    requestBtn.classList.toggle('hidden', effectiveAllowed || blocked || globalMaintenance);
    requestBtn.disabled = pending;
    if (pending) requestBtn.textContent = status === 'review' ? 'Revisione richiesta' : 'Accesso richiesto';
    else if (rejected) requestBtn.textContent = 'Richiedi ricontrollo';
    else requestBtn.textContent = 'Richiedi accesso';
    requestBtn.classList.toggle('warning-btn', rejected || status === 'review');
    requestBtn.classList.toggle('secondary-btn', !(rejected || status === 'review'));
    if (globalMaintenance) textEl.textContent = `🛠️ Corso in manutenzione.${g.maintenanceMessage ? ' ' + g.maintenanceMessage : ''}`;
    else if (globalBlocked) textEl.textContent = `Corso bloccato per tutti gli utenti.${g.blockReason ? ' Motivo: ' + g.blockReason : ''}`;
    else if (effectiveAllowed) textEl.textContent = 'Accesso autorizzato.';
    else if (blocked) textEl.textContent = `Richiesta non selezionabile: accesso bloccato per questo corso.${reason ? ' Motivo: ' + reason : ''}`;
    else if (rejected) textEl.textContent = `Richiesta non approvata.${reason ? ' Motivo: ' + reason : ''} Puoi chiedere un ricontrollo.`;
    else if (pending) textEl.textContent = status === 'review' ? 'Richiesta di ricontrollo inviata, attendi l’approvazione.' : 'Accesso richiesto, attendi l’approvazione.';
    else textEl.textContent = '🔒 Non hai l’autorizzazione per entrare in questa sezione.';
  }

  function showCourseRejectionNoticeOnce(course){
    const status = getCourseRequestStatus(course);
    if (status !== 'rejected' && status !== 'blocked') return;
    const reason = getCourseRejectReason(course);
    const key = `quizNuotoCourseNotice:${currentUser?.uid}:${course}:${status}:${reason}`;
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, '1');
    const label = courseLabel(course);
    setTimeout(() => showSiteNotice({
      eyebrow: status === 'blocked' ? 'Corso bloccato' : 'Richiesta non approvata',
      title: status === 'blocked' ? `${label}: accesso bloccato` : `${label}: richiesta non approvata`,
      message: status === 'blocked'
        ? `La richiesta per ${label} è stata rigettata definitivamente. Questo corso è bloccato per il tuo account.${reason ? '<br><strong>Motivo:</strong> ' + escapeHtml(reason) : ''}`
        : `La richiesta per ${label} non è stata approvata.${reason ? '<br><strong>Motivo:</strong> ' + escapeHtml(reason) : ''}<br>Puoi richiedere un ricontrollo dal banner del corso.`,
      buttonText: 'Ho capito',
      tone: status
    }), 250);
  }

  // Ex funzioni Netlify: ora girano nel browser (account-actions.js) protette dalle regole Firestore
  async function callPublicFunction(name, body) {
    if (!window.QuizAccount) throw new Error('Componente account non caricato: ricarica la pagina.');
    return window.QuizAccount.call(name, body || {});
  }
  async function openCourse(course){
    const g = getCourseGlobalState(course);
    if (!isAdmin && g.maintenance) return showToast(`Corso in manutenzione.${g.maintenanceMessage ? ' ' + g.maintenanceMessage : ''}`);
    if (!isAdmin && g.blocked) return showToast(`Corso bloccato.${g.blockReason ? ' Motivo: ' + g.blockReason : ''}`);
    if(!hasCourse(course)) return showToast('Area non autorizzata. Richiedi accesso allo staff.');
    const navigate = () => { location.href = course==='bagnino' ? 'bagnino.html' : course==='arte' ? 'arte.html' : 'istruttore.html'; };
    if (window.QuizStudyTracker?.ensureGoal) {
      const existing = await window.QuizStudyTracker.ensureGoal(course, navigate);
      if (existing) navigate();
      return;
    }
    navigate();
  }

  function updateArtePortalTimer(){
    if(!els.artePortalTimer) return;
    const target = new Date('2026-07-15T23:59:59+02:00');
    let ms = target - new Date();
    if(ms <= 0){ els.artePortalTimer.textContent = 'Corso concluso'; return; }
    const d = Math.floor(ms / 86400000); ms %= 86400000;
    const h = Math.floor(ms / 3600000); ms %= 3600000;
    const m = Math.floor(ms / 60000);
    els.artePortalTimer.textContent = `Timer corso: ${d}g ${String(h).padStart(2,'0')}h ${String(m).padStart(2,'0')}m`;
  }

  async function requestCourseAccess(course){
    const g = getCourseGlobalState(course);
    if (!isAdmin && g.maintenance) return showToast('Corso in manutenzione: riprova più tardi.');
    if (!isAdmin && g.blocked) return showToast(`Corso bloccato.${g.blockReason ? ' Motivo: ' + g.blockReason : ''}`);
    if(!currentUser) return openAccountRequestModal(course);
    const status = getCourseRequestStatus(course);
    if (status === 'blocked') return showToast('Questo corso è bloccato per il tuo account. Solo lo staff può sbloccarlo.');
    if (isCoursePending(course)) return showToast('Accesso già richiesto: attendi l’approvazione.');
    const reviewRequest = status === 'rejected' || canRequestCourseReview(course);
    try{
      await callPublicFunction('create-account-request', { requestedCourses:[course], reviewRequest, message: reviewRequest ? `Richiesta ricontrollo area ${courseLabel(course)}` : `Richiesta accesso area ${courseLabel(course)}` }, true);
      accountData.access = accountData.access || {};
      accountData.access.pendingCourses = [...new Set([...(accountData.access.pendingCourses || []), course])];
      accountData.access.courseRequestStatus = accountData.access.courseRequestStatus || {};
      accountData.access.courseRequestStatus[course] = reviewRequest ? 'review' : 'pending';
      if (reviewRequest) { accountData.access.courseReviewPending = accountData.access.courseReviewPending || {}; accountData.access.courseReviewPending[course] = true; }
      renderCourses();
      showToast(reviewRequest ? 'Richiesta di ricontrollo inviata allo staff.' : 'Richiesta accesso inviata allo staff.');
    }catch(error){ showToast(error.message); }
  }
  function openAccountRequestModal(preselect){
    els.accountRequestMessage.textContent='';
    if (els.requestPassword) els.requestPassword.value='';
    if (els.requestPasswordConfirm) els.requestPasswordConfirm.value='';
    if(currentUser?.email) els.requestEmail.value=currentUser.email;
    if(currentUser?.displayName){
      const parts=currentUser.displayName.trim().split(/\s+/);
      if(!els.requestFirstName.value) els.requestFirstName.value=parts[0]||'';
      if(!els.requestLastName.value) els.requestLastName.value=parts.slice(1).join(' ');
    }
    els.requestEmail.disabled = Boolean(currentUser);
    els.requestPassword?.closest?.('label');
    const authMode = Boolean(currentUser);
    els.requestPassword.classList.toggle('hidden', authMode);
    els.requestPasswordConfirm.classList.toggle('hidden', authMode);
    const labels=[...els.accountRequestModal.querySelectorAll('label')];
    labels.forEach(label=>{
      if(label.textContent.trim()==='Password' || label.textContent.trim()==='Conferma password') label.classList.toggle('hidden', authMode);
    });
    els.requestCourseIstruttore.checked = preselect ? preselect==='istruttore' : false;
    els.requestCourseBagnino.checked = preselect ? preselect==='bagnino' : false;
    if (els.requestCourseArte) els.requestCourseArte.checked = preselect ? preselect==='arte' : false;
    els.accountRequestModal.classList.remove('hidden');
  }
  function closeAccountRequestModal(){ els.accountRequestModal.classList.add('hidden'); }
  async function submitAccountRequest(){
    const firstName=els.requestFirstName.value.trim(); const lastName=els.requestLastName.value.trim(); const email=els.requestEmail.value.trim().toLowerCase(); const password=els.requestPassword.value; const confirm=els.requestPasswordConfirm.value; const message=els.requestMessage.value.trim();
    const requestedCourses=[]; if(els.requestCourseIstruttore.checked) requestedCourses.push('istruttore'); if(els.requestCourseBagnino.checked) requestedCourses.push('bagnino'); if(els.requestCourseArte?.checked) requestedCourses.push('arte');
    if(!firstName||!lastName||!email) return els.accountRequestMessage.textContent='Nome, cognome ed email sono obbligatori.';
    if(!currentUser && !password) return els.accountRequestMessage.textContent='La password è obbligatoria.';
    if(!currentUser && password.length < 6) return els.accountRequestMessage.textContent='La password deve avere almeno 6 caratteri.';
    if(!currentUser && password !== confirm) return els.accountRequestMessage.textContent='Le password non coincidono.';
    if(!requestedCourses.length) return els.accountRequestMessage.textContent='Seleziona almeno un corso.';
    els.submitAccountRequestBtn.disabled = true;
    try{
      await callPublicFunction('create-account-request', { firstName,lastName,email,password,requestedCourses,message }, Boolean(currentUser));
      els.accountRequestMessage.textContent='Richiesta inviata. Ora attendi la valutazione dello staff.';
      showToast('Richiesta account inviata.');
      if(!currentUser){ try { await window.FirebaseQuiz.auth.signInWithEmailAndPassword(email,password); } catch {} }
      setTimeout(closeAccountRequestModal, 1200);
    }catch(error){ els.accountRequestMessage.textContent = error.message; }
    finally { els.submitAccountRequestBtn.disabled = false; }
  }
  async function loginWithGoogle(){
    if(!window.FirebaseQuiz?.configured) return setMessage('Firebase non configurato.');
    try{ await window.FirebaseQuiz.auth.signInWithPopup(window.FirebaseQuiz.googleProvider); }
    catch(error){
      const fallbackCodes=['auth/popup-blocked','auth/popup-closed-by-user','auth/cancelled-popup-request','auth/operation-not-supported-in-this-environment'];
      if(fallbackCodes.includes(error.code)) return window.FirebaseQuiz.auth.signInWithRedirect(window.FirebaseQuiz.googleProvider);
      setMessage(error.message);
    }
  }

  async function login(){ const email=els.emailInput.value.trim(); const pass=els.passwordInput.value; if(!email||!pass) return setMessage('Inserisci email e password.'); try{ await window.FirebaseQuiz.auth.signInWithEmailAndPassword(email,pass); }catch(error){ setMessage(error.message); } }
  async function forgotPassword(){ const email=els.emailInput.value.trim(); if(!email) return setMessage('Inserisci la tua email.'); try{ await window.FirebaseQuiz.auth.sendPasswordResetEmail(email); setMessage('Email di reimpostazione inviata.'); }catch(error){ setMessage(error.message); } }
  async function logout(){ await window.FirebaseQuiz.auth.signOut(); }
  function setupTheme(){ const saved=localStorage.getItem('quizNuotoTheme')||'light'; document.body.classList.toggle('dark', saved==='dark'); els.themeToggle.textContent=saved==='dark'?'☾':'☀︎'; }
  function toggleTheme(){ const dark=document.body.classList.toggle('dark'); localStorage.setItem('quizNuotoTheme', dark?'dark':'light'); els.themeToggle.textContent=dark?'☾':'☀︎'; }
  function setLoginState(title,subtitle,status){ els.authTitle.textContent=title; els.authSubtitle.innerHTML=subtitle; els.authStatus.textContent=status; }
  function setMessage(text){ els.authMessage.textContent=text||''; }
  function showToast(message){ els.toast.textContent=message; els.toast.classList.remove('hidden'); clearTimeout(showToast.t); showToast.t=setTimeout(()=>els.toast.classList.add('hidden'),2800); }

  async function loadAdminPendingCount(){
    if (!isAdmin || !els.adminBellBtn || !els.adminPendingBadge) return;
    try {
      const snap = await db().collection('accountRequests').limit(200).get();
      let count = 0;
      snap.forEach((doc) => {
        const status = (doc.data() || {}).status || 'pending';
        if (status === 'pending' || status === 'review') count += 1;
      });
      els.adminPendingBadge.textContent = String(count);
      els.adminBellBtn.classList.toggle('has-pending', count > 0);
      els.adminBellBtn.title = count ? `${count} richieste in attesa` : 'Nessuna richiesta in attesa';
    } catch (error) {
      console.warn('Conteggio richieste admin non disponibile:', error);
    }
  }


  async function loadPortalAnnouncements(){
    if (!window.FirebaseQuiz?.configured || !currentUser || !getAllowedCourses().length) return;
    try {
      const [globalSnap, userSnap] = await Promise.all([
        db().collection('announcements').where('active', '==', true).where('scope', '==', 'global').limit(20).get(),
        db().collection('announcements').where('active', '==', true).where('scope', '==', 'user').where('targetUid', '==', currentUser.uid).limit(20).get()
      ]);
      const items = [];
      globalSnap.forEach((doc) => items.push({ id: doc.id, ...doc.data() }));
      userSnap.forEach((doc) => items.push({ id: doc.id, ...doc.data() }));
      if (!items.length) return;
      items.sort((a, b) => Number(b.createdAt?.seconds || 0) - Number(a.createdAt?.seconds || 0));
      showAnnouncementPopup(items, 'portal');
    } catch (error) {
      console.warn('Annunci portale non caricati:', error);
    }
  }

  function showAnnouncementPopup(items, area){
    const storageKey = `quizNuotoSeenAnnouncements:${currentUser.uid}:${area || 'portal'}`;
    let seen = [];
    try { seen = JSON.parse(localStorage.getItem(storageKey) || '[]'); } catch { seen = []; }
    const unseen = items.filter((item) => !seen.includes(item.id));
    if (!unseen.length) return;
    const modal = document.createElement('div');
    modal.className = 'modal site-dialog-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    const main = unseen[0] || {};
    modal.innerHTML = `
      <div class="modal-card account-request-card site-dialog-card announcement-dialog-card">
        <div class="modal-head">
          <div>
            <p class="eyebrow">Avviso</p>
            <h3>${escapeHtml(main.title || 'Annuncio')}</h3>
          </div>
          <button class="icon-btn" type="button" data-close-announcement aria-label="Chiudi">×</button>
        </div>
        <div class="announcement-popup-list">
          ${unseen.map((item, index) => `<div class="announcement-popup-item ${index === 0 ? 'featured' : ''}">${index === 0 ? '' : `<strong>${escapeHtml(item.title || 'Annuncio')}</strong>`}<p>${escapeHtml(item.message || '')}</p></div>`).join('')}
        </div>
        <div class="site-dialog-actions"><button class="primary-btn" type="button" data-close-announcement>Ho capito</button></div>
      </div>`;
    const close = () => {
      const nextSeen = [...new Set([...seen, ...unseen.map((item) => item.id)])];
      localStorage.setItem(storageKey, JSON.stringify(nextSeen));
      modal.remove();
    };
    modal.querySelectorAll('[data-close-announcement]').forEach((btn) => btn.addEventListener('click', close));
    document.body.appendChild(modal);
  }

  function showSiteNotice({ eyebrow = 'Avviso', title = 'Avviso', message = '', buttonText = 'Ho capito', tone = '' } = {}){
    const modal = document.createElement('div');
    modal.className = `modal site-dialog-modal ${tone ? 'site-dialog-' + tone : ''}`;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.innerHTML = `
      <div class="modal-card account-request-card site-dialog-card">
        <div class="modal-head">
          <div>
            <p class="eyebrow">${escapeHtml(eyebrow)}</p>
            <h3>${escapeHtml(title)}</h3>
          </div>
          <button class="icon-btn" type="button" data-close-site-dialog aria-label="Chiudi">×</button>
        </div>
        <div class="site-dialog-message">${message}</div>
        <div class="site-dialog-actions"><button class="primary-btn" type="button" data-close-site-dialog>${escapeHtml(buttonText)}</button></div>
      </div>`;
    const close = () => modal.remove();
    modal.querySelectorAll('[data-close-site-dialog]').forEach((btn) => btn.addEventListener('click', close));
    document.body.appendChild(modal);
  }

  function db(){ return window.FirebaseQuiz.db; }
  function escapeHtml(value){ return String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;'); }
})();
