// GestNow Mini: picagem com cartão, obras, trabalhadores, quem está na obra, documentos e mapa de horas.
// Sem passo de compilação: ficheiros estáticos, publicáveis em qualquer alojamento com HTTPS.
'use strict';

const cfg = window.GESTNOW_CONFIG || {};
const app = document.getElementById('app');
const nav = document.getElementById('nav');
const PRIVILEGED = ['admin', 'hr', 'finance'];   // the database asks these roles for MFA (aal2)
const QUEUE_KEY = 'gestnow.queue';
const SITE_KEY = 'gestnow.site';

const REASONS = {
  unknown_credential: 'Cartão desconhecido',
  debounce: 'Já picou há instantes',
  collaborator_inactive: 'Trabalhador inativo',
  onboarding_incomplete: 'Acolhimento incompleto',
  project_not_in_execution: 'A obra não está em execução',
  suspended_safety: 'Suspenso por segurança',
  on_leave: 'De baixa ou licença',
  ss_admission_missing: 'Falta a admissão na Segurança Social',
  corrective_training_pending: 'Formação corretiva por fazer',
  not_assigned_to_project: 'Não está atribuído a esta obra',
  insufficient_rest: 'Descanso insuficiente desde a última saída',
  daily_limit_reached: 'Limite de horas do dia atingido',
  weekly_limit_reached: 'Limite de horas da semana atingido',
  handover_not_acknowledged: 'Falta confirmar a passagem de turno',
};
const REASON_PREFIX = {
  'document_invalid:': 'Documento em falta ou caducado: ',
  'company_document_invalid:': 'Documento da empresa em falta: ',
  'requirement_missing:': 'Requisito da obra em falta: ',
  'skill_missing:': 'Falta a competência: ',
};
const ERRORS = [
  [/simple mode is off/i, 'O modo simples não está ligado nesta empresa.'],
  [/not allowed|insufficient_privilege|permission denied/i, 'Sem permissão. Confirma que entraste com a segunda verificação (código da app).'],
  [/already exists/i, 'Já existe uma obra com esse código.'],
  [/duplicate key.*tax_number|tenant_id, tax_number/i, 'Já existe um trabalhador com esse NIF.'],
  [/duplicate key.*employee_number/i, 'Já existe um trabalhador com esse número.'],
  [/uq_credentials_active_uid|duplicate key.*uid/i, 'Esse cartão já pertence a outra pessoa.'],
  [/write why \(at least (\d+)/i, 'Escreve o motivo (pelo menos umas palavras).'],
  [/at least 10 characters/i, 'Escreve o que foi verificado em papel (pelo menos 10 letras).'],
  [/already belongs to another person/i, 'Esse cartão já pertence a outra pessoa.'],
  [/issue date cannot be in the future/i, 'A data de emissão não pode ser no futuro.'],
  [/expiry date is before the issue date/i, 'A validade não pode ser antes da data de emissão.'],
  [/event time is in the future/i, 'A hora não pode ser no futuro.'],
  [/too old for the Mini/i, 'Essa picagem tem mais de 35 dias. Fala com os Recursos Humanos.'],
  [/cannot add clock-ins for yourself/i, 'Não podes acrescentar picagens a ti próprio.'],
  [/cannot validate your own hours/i, 'Não podes validar as tuas próprias horas.'],
  [/has anomalies/i, 'Esse dia tem picagens em falta. Corrige primeiro.'],
  [/overtime: approve or refuse/i, 'Esse dia tem horas extra: aprova ou recusa.'],
  [/cannot go to/i, 'Esse dia já foi validado.'],
  [/up to 2 months/i, 'Escolhe um período até 2 meses.'],
  [/e-mail already has a login/i, 'Esse email já tem conta.'],
  [/person already has a login/i, 'Esta pessoa já tem conta.'],
  [/invalid e-mail/i, 'O email não parece válido.'],
  [/this person is inactive/i, 'Esta pessoa está inativa.'],
  [/your own login/i, 'Não podes desligar a tua própria conta.'],
  [/could not create the login/i, 'Não consegui criar a conta. Tenta outra vez.'],
  [/required/i, 'Falta preencher um campo obrigatório.'],
  [/Invalid login credentials/i, 'Email ou palavra-passe errados.'],
  [/Failed to fetch|NetworkError|network/i, 'Sem rede. Tenta outra vez.'],
];

const state = { ready: false, me: null, sites: [], people: [], docTypes: [], view: 'picar', direction: 'in', nfc: null, timer: null,
  worker: null, weekStart: null };

// ------------------------------------------------------------------ helpers
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (sel) => app.querySelector(sel);
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 3500);
}
function friendly(err) {
  const msg = (err && (err.message || err.error_description || err.hint)) || String(err);
  if (AUTH_LOST.test(msg)) checkSession();
  for (const [re, pt] of ERRORS) if (re.test(msg)) return pt;
  return 'Erro: ' + msg;
}
function reasonText(code) {
  if (REASONS[code]) return REASONS[code];
  if (code.startsWith('document_invalid:')) {
    const t = state.docTypes.find((d) => d.code === code.slice(17));
    if (t) return t.name + ' em falta ou caducado(a)';
  }
  for (const p in REASON_PREFIX) if (code.startsWith(p)) return REASON_PREFIX[p] + code.slice(p.length);
  return code;
}
const fmtTime = (iso) => new Date(iso).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const fmtDate = (d) => d ? new Date(d + 'T12:00:00').toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
const fmtHour = (iso) => iso ? new Date(iso).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' }) : '';
const fmtMin = (m) => { m = m || 0; return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`; };
const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const isAdmin = () => state.me && state.me.role === 'admin';
const canPeople = () => state.me && ['admin', 'hr'].includes(state.me.role);
const canDocs = () => state.me && ['admin', 'hr', 'hse'].includes(state.me.role);
const normUid = (v) => String(v || '').replace(/[\s:\-]/g, '').toUpperCase();
function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
function store(key, val) { try { val === undefined ? localStorage.removeItem(key) : localStorage.setItem(key, JSON.stringify(val)); } catch (_) {} }
function load(key, dflt) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : dflt; } catch (_) { return dflt; } }
function beep(ok) {
  try { navigator.vibrate && navigator.vibrate(ok ? 120 : [80, 60, 80, 60, 200]); } catch (_) {}
  try {
    const a = new (window.AudioContext || window.webkitAudioContext)(); const o = a.createOscillator(); const g = a.createGain();
    o.frequency.value = ok ? 880 : 220; o.connect(g); g.connect(a.destination); g.gain.value = 0.15;
    o.start(); o.stop(a.currentTime + (ok ? 0.15 : 0.5));
  } catch (_) {}
}

// ------------------------------------------------------------------ start
if (!cfg.url || cfg.url.startsWith('COLA_') || !window.supabase) {
  app.innerHTML = `<div class="card"><h1>Falta configurar</h1>
    <p>Abre o ficheiro <code>config.js</code> e cola o <b>Project URL</b> e a chave <b>anon public</b> do Supabase
    (Project Settings &gt; API).</p></div>`;
  throw new Error('config missing');
}
const sb = window.supabase.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
const core = () => sb.schema('core');

nav.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.action === 'sair') return signOut();
  go(b.dataset.view);
});
sb.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') boot(); });
// The session can end outside this tab (Sair in another tab, expired token). Re-check when the user comes back.
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkSession(); });
window.addEventListener('online', flushQueue);
boot();

async function boot() {
  stopNfc(); clearInterval(state.timer);
  state.ready = false; nav.hidden = true;
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return showLogin();
  const { data: me, error } = await core().from('app_users')
    .select('role, tenant_id, organization_id, collaborator_id, is_active').eq('user_id', session.user.id).maybeSingle();
  if (error || !me) return showMessage('Sem acesso', 'Este utilizador ainda não está ligado a nenhuma empresa. Corre o primeiro-admin.sql com este email.', true);
  if (!me.is_active) return showMessage('Conta desligada', 'A tua conta está desligada. Fala com o administrador.', true);
  state.me = { ...me, email: session.user.email };
  const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  if (PRIVILEGED.includes(me.role) && aal.currentLevel !== 'aal2') {
    return aal.nextLevel === 'aal2' ? showMfaVerify() : showMfaEnroll();
  }
  // A login made by the admin comes with a temporary password: the person chooses their own first.
  if (session.user.user_metadata && session.user.user_metadata.must_change_password) return showNewPassword();
  state.ready = true;
  nav.hidden = false;
  await loadBasics();
  flushQueue();
  go(state.view);
}

const AUTH_LOST = /permission denied|JWT|not authenticated|401/i;
async function sessionGone() {
  const { data: { session } } = await sb.auth.getSession();
  return !session;
}
// If the screen is open but the login is gone, go back to "Entrar" instead of showing errors.
async function checkSession() {
  if (!state.ready || !(await sessionGone())) return false;
  toast('A sessão terminou. Entra outra vez.');
  boot();
  return true;
}

async function signOut() { stopNfc(); state.ready = false; nav.hidden = true; await sb.auth.signOut(); }

function showMessage(title, text, withLogout) {
  nav.hidden = true;
  app.innerHTML = `<div class="card"><h1>${esc(title)}</h1><p>${esc(text)}</p>
    ${withLogout ? '<button class="btn ghost" id="out">Sair</button>' : ''}</div>`;
  if (withLogout) $('#out').onclick = signOut;
}

// ------------------------------------------------------------------ login and MFA
function showLogin() {
  nav.hidden = true;
  app.innerHTML = `<div class="card" style="max-width:420px;margin:30px auto">
    <h1>Entrar</h1>
    <form id="f"><label>Email</label><input name="email" type="email" autocomplete="username" required>
    <label>Palavra-passe</label><input name="password" type="password" autocomplete="current-password" required>
    <p><button class="btn" style="width:100%">Entrar</button></p></form></div>`;
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const { error } = await sb.auth.signInWithPassword({ email: f.get('email'), password: f.get('password') });
    if (error) return toast(friendly(error));
    boot();
  };
}

async function showMfaEnroll() {
  nav.hidden = true;
  // Drop half-finished enrolments so a new QR can be issued.
  const { data: list } = await sb.auth.mfa.listFactors();
  for (const f of (list && list.all) || []) if (f.status !== 'verified') await sb.auth.mfa.unenroll({ factorId: f.id });
  const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'GestNow ' + new Date().toISOString().slice(0, 10) });
  if (error) return showMessage('Segunda verificação', friendly(error), true);
  app.innerHTML = `<div class="card" style="max-width:460px;margin:20px auto">
    <h1>Ativar a segunda verificação</h1>
    <p>Como administrador, precisas de um código do telemóvel para entrar. Faz isto uma vez:</p>
    <ol><li>Instala no telemóvel uma app de códigos (Google Authenticator, Microsoft Authenticator ou 1Password).</li>
    <li>Na app, adiciona uma conta e aponta a câmara para este código:</li></ol>
    <div class="qr"><img alt="Código QR" src="${esc(data.totp.qr_code)}"></div>
    <p class="small muted">Se não conseguires ler o QR, escreve esta chave na app: <code>${esc(data.totp.secret)}</code></p>
    <form id="f"><label>Escreve o código de 6 números que aparece na app</label>
    <input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" required>
    <p><button class="btn">Confirmar</button> <button type="button" class="btn ghost" id="out">Sair</button></p></form></div>`;
  $('#out').onclick = signOut;
  $('#f').onsubmit = (e) => { e.preventDefault(); verifyCode(data.id, new FormData(e.target).get('code')); };
}

async function showMfaVerify() {
  nav.hidden = true;
  const { data: list } = await sb.auth.mfa.listFactors();
  const factor = list && list.totp && list.totp[0];
  if (!factor) return showMfaEnroll();
  app.innerHTML = `<div class="card" style="max-width:420px;margin:30px auto"><h1>Código de verificação</h1>
    <form id="f"><label>Abre a app de códigos e escreve os 6 números</label>
    <input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" required autofocus>
    <p><button class="btn">Confirmar</button> <button type="button" class="btn ghost" id="out">Sair</button></p></form></div>`;
  $('#out').onclick = signOut;
  $('#f').onsubmit = (e) => { e.preventDefault(); verifyCode(factor.id, new FormData(e.target).get('code')); };
}

function showNewPassword() {
  nav.hidden = true;
  app.innerHTML = `<div class="card" style="max-width:420px;margin:30px auto"><h1>Escolhe a tua palavra-passe</h1>
    <p>Entraste com uma palavra-passe temporária. Escolhe agora a tua. Não a digas a ninguém.</p>
    <form id="f"><label>Palavra-passe nova (pelo menos 10 caracteres)</label>
    <input name="p1" type="password" autocomplete="new-password" minlength="10" required>
    <label>Repete a palavra-passe</label><input name="p2" type="password" autocomplete="new-password" minlength="10" required>
    <p><button class="btn">Guardar</button> <button type="button" class="btn ghost" id="out">Sair</button></p></form></div>`;
  $('#out').onclick = signOut;
  $('#f').onsubmit = async (e) => {
    e.preventDefault(); const f = new FormData(e.target);
    if (f.get('p1') !== f.get('p2')) return toast('As duas palavras-passe não são iguais.');
    const { error } = await sb.auth.updateUser({ password: f.get('p1'), data: { must_change_password: false } });
    if (error) return toast(/same|different/i.test(error.message) ? 'Escolhe uma palavra-passe diferente da temporária.' : friendly(error));
    toast('Palavra-passe guardada.'); boot();
  };
}

async function verifyCode(factorId, code) {
  const { error } = await sb.auth.mfa.challengeAndVerify({ factorId, code: String(code).trim() });
  if (error) return toast('Código errado ou expirado. Tenta o próximo.');
  boot();
}

// ------------------------------------------------------------------ data
async function loadBasics() {
  const [s, p] = await Promise.all([
    core().from('projects').select('id, title, cost_center_code, status, address').order('title'),
    core().from('collaborators').select('id, full_name, employee_number, tax_number, job_title, onboarding_status, is_active, organization_id').order('full_name'),
  ]);
  if (s.error) toast(friendly(s.error));
  if (p.error) toast(friendly(p.error));
  state.sites = s.data || [];
  state.people = p.data || [];
  const t = await sb.rpc('mini_document_types');
  state.docTypes = t.error ? [] : (t.data || []);
}
const activeSites = () => state.sites.filter((s) => s.status === 'execution');
function currentSite() {
  const id = load(SITE_KEY, null);
  return activeSites().find((s) => s.id === id) || activeSites()[0] || null;
}
function siteSelect(id) {
  const sites = activeSites();
  if (!sites.length) return '<p class="muted">Ainda não há obras abertas. Abre uma em <b>Obras</b>.</p>';
  const cur = currentSite();
  return `<label>Obra</label><select id="${id}">${sites.map((s) =>
    `<option value="${esc(s.id)}" ${cur && cur.id === s.id ? 'selected' : ''}>${esc(s.title)} (${esc(s.cost_center_code)})</option>`).join('')}</select>`;
}
function bindSiteSelect(id, after) {
  const el = $('#' + id); if (!el) return;
  el.onchange = () => { store(SITE_KEY, el.value); after && after(); };
}

function go(view) {
  if (!state.ready) return boot();   // never show a screen before login (and the phone code, when required)
  stopNfc(); clearInterval(state.timer);
  state.view = view;
  const tab = view === 'ficha' ? 'trabalhadores' : view;
  nav.querySelectorAll('button[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === tab));
  ({ picar: viewClock, naobra: viewOnSite, horas: viewHours, seguranca: viewSafety, trabalhadores: viewPeople,
     ficha: viewWorker, obras: viewSites }[view] || viewClock)();
}

// ------------------------------------------------------------------ Picar
function viewClock() {
  const nfcOk = 'NDEFReader' in window;
  app.innerHTML = `<h1>Picar</h1>
    <div class="card">${siteSelect('site')}
      <div class="dir"><button class="in ${state.direction === 'in' ? 'on' : ''}" data-d="in">ENTRADA</button>
      <button class="out ${state.direction === 'out' ? 'on' : ''}" data-d="out">SAÍDA</button></div>
      ${nfcOk ? '<button class="btn" id="nfc" style="width:100%;padding:16px">Começar a ler cartões</button>'
              : '<p class="small muted">Este aparelho não lê cartões pelo browser (só o Chrome em Android lê). Usa o leitor USB ou escreve o número do cartão.</p>'}
      <form id="manual" class="row" style="margin-top:10px"><div><label>Número do cartão (ou leitor USB)</label>
        <input name="uid" autocomplete="off" placeholder="ex.: 04:A1:B2:C3"></div>
        <div style="flex:0 0 auto"><button class="btn ghost">Picar</button></div></form>
      <div id="result"></div><p id="queue" class="small muted"></p>
    </div>
    <h2>Últimas picagens nesta obra</h2><div class="card" id="recent"><p class="muted">A carregar…</p></div>`;
  bindSiteSelect('site', loadRecent);
  app.querySelectorAll('.dir button').forEach((b) => b.onclick = () => {
    state.direction = b.dataset.d;
    app.querySelectorAll('.dir button').forEach((x) => x.classList.toggle('on', x === b));
  });
  $('#manual').onsubmit = (e) => {
    e.preventDefault(); const input = e.target.uid;
    if (normUid(input.value)) clock(input.value); input.value = ''; input.focus();
  };
  if (nfcOk) $('#nfc').onclick = toggleNfc;
  showQueue(); loadRecent();
}

async function toggleNfc() {
  const btn = $('#nfc');
  if (state.nfc) { stopNfc(); btn.textContent = 'Começar a ler cartões'; return; }
  try {
    const ctrl = new AbortController(); const reader = new NDEFReader();
    await reader.scan({ signal: ctrl.signal });
    state.nfc = ctrl; btn.textContent = 'A ler… encosta o cartão (toca para parar)';
    let last = { uid: '', at: 0 };
    reader.onreading = (ev) => {
      const uid = normUid(ev.serialNumber);
      if (!uid) return toast('Este cartão não mostra o número. Usa outro tipo de cartão.');
      if (uid === last.uid && Date.now() - last.at < 3000) return;   // the same tap read twice
      last = { uid, at: Date.now() }; clock(uid);
    };
    reader.onreadingerror = () => toast('Não consegui ler o cartão. Encosta outra vez.');
  } catch (err) {
    toast(err.name === 'NotAllowedError' ? 'Dá permissão ao NFC no Chrome.' : 'O NFC não arrancou: ' + err.message);
  }
}
function stopNfc() { if (state.nfc) { state.nfc.abort(); state.nfc = null; } }

async function clock(rawUid) {
  const site = currentSite(); if (!site) return toast('Escolhe uma obra.');
  const ev = { p_project: site.id, p_capture: 'card_on_supervisor_phone', p_raw: normUid(rawUid), p_direction: state.direction,
    p_event_time: new Date().toISOString(), p_client_event_id: uuid(), p_device_time: new Date().toISOString() };
  const r = await sendEvent(ev);
  if (r.authLost) { showResult('warn', 'Picagem guardada', 'A sessão terminou. Entra outra vez e ela é enviada.'); beep(false); checkSession(); return; }
  if (r.queued) { showResult('warn', 'Guardada sem rede', 'Vai ser enviada quando a rede voltar.'); beep(true); return; }
  if (r.error) { showResult('bad', 'Erro', friendly(r.error)); beep(false); return; }
  const d = r.data; const who = d.name || 'Cartão ' + ev.p_raw;
  const word = state.direction === 'in' ? 'ENTRADA' : 'SAÍDA';
  if (d.status === 'accepted') { showResult('ok', who, `${word} aceite`); beep(true); if (state.direction === 'in' && d.collaborator_id) warnExpiring(d.collaborator_id, who, word); }
  else if (d.status === 'duplicate') { showResult('warn', who, 'Já picou há instantes'); beep(true); }
  else { showResult('bad', `${who}: NÃO ENTRA`, (d.reasons || []).map(reasonText).join(' · ')); beep(false); }
  loadRecent();
}
// After an accepted entry: say which documents are about to expire (the entry itself is never held up by this).
async function warnExpiring(collabId, who, word) {
  const { data, error } = await sb.rpc('mini_worker_documents', { p_collab: collabId });
  if (error || !data) return;
  const soon = data.filter((x) => x.state === 'a_caducar');
  if (!soon.length) return;
  const el = $('#result'); if (!el) return;
  el.innerHTML = `<div class="result warn"><b>${esc(who)}</b>${esc(word)} aceite<div class="small" style="margin-top:6px">Atenção: ${soon.map((x) =>
    `${esc(x.name)} caduca ${x.days_left === 0 ? 'hoje' : `daqui a ${x.days_left} dia(s)`}`).join(' · ')}</div></div>`;
}
async function sendEvent(ev) {
  try {
    const { data, error } = await sb.rpc('clock_event', ev);
    if (error && /fetch|network/i.test(error.message || '')) throw error;
    if (error && AUTH_LOST.test(error.message || '') && await sessionGone()) {
      // Never lose a tap because the login ended: keep it and send it after the next login.
      const q = load(QUEUE_KEY, []); q.push(ev); store(QUEUE_KEY, q);
      return { authLost: true };
    }
    return { data, error };
  } catch (_) {
    const q = load(QUEUE_KEY, []); q.push({ ...ev, p_was_offline: true }); store(QUEUE_KEY, q); showQueue();
    return { queued: true };
  }
}
async function flushQueue() {
  if (!state.ready) return;   // only send saved taps when logged in, or they would be refused and lost
  const q = load(QUEUE_KEY, []); if (!q.length) return;
  const left = [];
  for (const ev of q) {
    try {
      const { error } = await sb.rpc('clock_event', ev);
      if (error && /fetch|network/i.test(error.message || '')) left.push(ev);
      else if (error && AUTH_LOST.test(error.message || '') && await sessionGone()) left.push(ev);
      else if (error) toast('Uma picagem guardada foi recusada: ' + friendly(error));
    } catch (_) { left.push(ev); }
  }
  store(QUEUE_KEY, left.length ? left : undefined); showQueue();
  if (left.length < q.length) toast(`${q.length - left.length} picagem(ns) guardada(s) enviada(s).`);
}
function showQueue() {
  const el = $('#queue'); if (!el) return;
  const n = load(QUEUE_KEY, []).length;
  el.textContent = n ? `${n} picagem(ns) à espera de rede.` : '';
}
function showResult(kind, title, text) {
  const el = $('#result'); if (!el) return toast(title + ': ' + text);
  el.innerHTML = `<div class="result ${kind}"><b>${esc(title)}</b>${esc(text)}</div>`;
}
async function loadRecent() {
  const el = $('#recent'); const site = currentSite(); if (!el) return;
  if (!site) { el.innerHTML = '<p class="muted">Sem obra.</p>'; return; }
  const { data, error } = await core().from('time_events')
    .select('id, event_time, direction, status, reasons, collaborator_id, raw_uid')
    .eq('project_id', site.id).order('event_time', { ascending: false }).limit(15);
  if (error) { el.innerHTML = `<p class="muted">${esc(friendly(error))}</p>`; return; }
  if (!data.length) { el.innerHTML = '<p class="muted">Ainda não há picagens.</p>'; return; }
  const name = (id) => (state.people.find((p) => p.id === id) || {}).full_name;
  el.innerHTML = `<table><tr><th>Hora</th><th>Quem</th><th></th><th>Resultado</th></tr>${data.map((e) => `<tr>
    <td>${esc(fmtTime(e.event_time))}</td><td>${esc(name(e.collaborator_id) || 'Cartão ' + (e.raw_uid || '?'))}</td>
    <td>${e.direction === 'in' ? 'Entrada' : e.direction === 'out' ? 'Saída' : esc(e.direction)}</td>
    <td>${e.status === 'accepted' ? '<span class="pill ok">aceite</span>' : e.status === 'duplicate' ? '<span class="pill warn">repetida</span>'
      : `<span class="pill bad">recusada</span> <span class="small">${esc((e.reasons || []).map(reasonText).join(' · '))}</span>`}</td></tr>`).join('')}</table>`;
}

// ------------------------------------------------------------------ Na obra
function viewOnSite() {
  app.innerHTML = `<h1>Quem está na obra agora</h1>
    <div class="card"><div class="noprint">${siteSelect('site')}</div>
    <div id="list"><p class="muted">A carregar…</p></div>
    <p class="noprint"><button class="btn ghost" id="print">Imprimir lista (emergência)</button></p></div>`;
  bindSiteSelect('site', loadOnSite);
  $('#print').onclick = () => window.print();
  loadOnSite();
  state.timer = setInterval(loadOnSite, 30000);
}
async function loadOnSite() {
  const el = $('#list'); const site = currentSite(); if (!el) return;
  if (!site) { el.innerHTML = ''; return; }
  const { data, error } = await sb.rpc('mini_on_site', { p_project: site.id });
  if (error) { el.innerHTML = `<p>${esc(friendly(error))}</p>`; return; }
  el.innerHTML = `<p><span class="big-count">${data.length}</span> pessoa(s) em <b>${esc(site.title)}</b>
    <span class="small muted">· atualizado ${esc(new Date().toLocaleTimeString('pt-PT'))}</span></p>
    ${data.length ? `<table><tr><th>Nome</th><th>Nº</th><th>Empresa</th><th>Desde</th></tr>${data.map((r) => `<tr>
      <td>${esc(r.full_name)}</td><td>${esc(r.employee_number || '')}</td><td>${esc(r.organization)}</td><td>${esc(fmtTime(r.since))}</td></tr>`).join('')}</table>` : ''}`;
}

// ------------------------------------------------------------------ Trabalhadores
async function viewPeople() {
  app.innerHTML = `<h1>Trabalhadores</h1>
    <div class="card" id="list"><p class="muted">A carregar…</p></div>
    ${canPeople() ? `<p><button class="btn" id="new">+ Novo trabalhador</button></p>
    <div class="card" id="newcard" hidden><h2 style="margin-top:0">Novo trabalhador</h2>
    <p class="small muted">Só para quem ainda não está na lista. Se a pessoa já está, toca no nome dela.</p>
    <form id="f"><div class="row"><div><label>Nome completo *</label><input name="name" required></div>
      <div><label>NIF *</label><input name="nif" inputmode="numeric" required></div></div>
      <div class="row"><div><label>Nº de trabalhador</label><input name="num"></div>
      <div><label>Função</label><input name="job" placeholder="ex.: Serralheiro"></div></div>
      <div class="row"><div><label>Cartão</label><input name="card" autocomplete="off" placeholder="Encosta o cartão ou escreve o número"></div>
      ${'NDEFReader' in window ? '<div style="flex:0 0 auto"><button type="button" class="btn ghost" id="read">Ler cartão</button></div>' : ''}</div>
      ${siteSelect('site')}
      <h2>Documentos que travam a entrada</h2>
      <p class="small muted">Copia as datas do papel. Sem estes dois válidos, a pessoa não entra na obra. Se ainda não os tens, deixa em branco e regista depois na ficha.</p>
      ${state.docTypes.filter((t) => t.is_blocking).map((t) => `<fieldset class="doc" data-type="${esc(t.id)}"><legend>${esc(t.name)}</legend>
        <div class="row"><div><label>Data de emissão</label><input name="i_${esc(t.id)}" type="date" max="${isoDay(new Date())}"></div>
        <div><label>Válido até (vazio = não caduca)</label><input name="e_${esc(t.id)}" type="date"></div></div></fieldset>`).join('')}
      <label class="check"><input type="checkbox" name="seen" required> Vi em papel a identificação e o contrato desta pessoa *</label>
      <label>Notas (opcional)</label><input name="notes" placeholder="ex.: contrato a termo até 12/2026">
      <p class="small muted">Fica guardado, com o teu nome, como prova do que verificaste.</p>
      <p><button class="btn">Guardar</button></p></form></div>` : ''}`;
  if ($('#f')) {
    $('#new').onclick = () => { $('#newcard').hidden = false; $('#new').hidden = true; $('#newcard').scrollIntoView({ behavior: 'smooth' }); };
    bindSiteSelect('site');
    if ($('#read')) $('#read').onclick = () => readOneCard('input[name=card]');
    $('#f').onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const docs = [...e.target.querySelectorAll('fieldset.doc')].map((fs) => ({ type: fs.dataset.type,
        name: fs.querySelector('legend').textContent, issue: f.get('i_' + fs.dataset.type), expiry: f.get('e_' + fs.dataset.type) }));
      const half = docs.find((d) => !d.issue && d.expiry);
      if (half) return toast(`${half.name}: falta a data de emissão.`);
      const nif = String(f.get('nif') || '').replace(/\s/g, '');
      const dup = state.people.find((p) => p.tax_number === nif);
      if (dup) return offerExisting(dup);
      const btn = e.target.querySelector('.btn:not(.ghost)'); btn.disabled = true;
      const notes = String(f.get('notes') || '').trim();
      const { data, error } = await sb.rpc('mini_add_worker', {
        p_full_name: f.get('name'), p_tax_number: nif, p_employee_number: f.get('num'),
        p_card_uid: normUid(f.get('card')), p_project: $('#site') ? $('#site').value : null,
        p_statement: 'Identificação e contrato vistos em papel.' + (notes ? ' ' + notes : ''), p_job_title: f.get('job') });
      if (error) {
        btn.disabled = false;
        if (/tax_number/i.test(error.message || '')) { await loadBasics(); const d2 = state.people.find((p) => p.tax_number === nif); if (d2) return offerExisting(d2); }
        return toast(friendly(error));
      }
      let failed = 0;
      for (const d of docs.filter((x) => x.issue)) {
        const r = await sb.rpc('mini_add_document', { p_collab: data, p_type: d.type, p_issue: d.issue, p_expiry: d.expiry || null, p_number: null });
        if (r.error) { failed++; toast(d.name + ': ' + friendly(r.error)); }
      }
      btn.disabled = false;
      const missing = docs.filter((x) => !x.issue).length + failed;
      toast(missing ? 'Trabalhador guardado. Faltam documentos: regista-os na ficha.' : 'Trabalhador guardado, pronto para picar.');
      await loadBasics(); state.worker = data; go('ficha');
    };
  }
  const { data, error } = await sb.rpc('mini_workers');
  const el = $('#list'); if (!el) return;
  if (error) { el.innerHTML = `<p class="muted">${esc(friendly(error))}</p>`; return; }
  if (!data.length) { el.innerHTML = '<p class="muted">Ainda ninguém.</p>'; return; }
  const siteCodes = (ids) => ids.map((id) => (state.sites.find((s) => s.id === id) || {}).cost_center_code).filter(Boolean).join(', ');
  el.innerHTML = `<p class="small muted">Toca num nome para ver os documentos, o cartão e as obras.</p>
    <table><tr><th>Nome</th><th>Obras</th><th>Estado</th></tr>${data.map((w) => `<tr class="link" data-id="${esc(w.collaborator_id)}">
    <td><b>${esc(w.full_name)}</b><div class="small muted">${esc(w.employee_number || '')}${w.card_uid ? ' · cartão ' + esc(w.card_uid) : ' · sem cartão'}</div></td>
    <td>${esc(siteCodes(w.site_ids)) || '<span class="muted">nenhuma</span>'}</td>
    <td>${!w.is_active ? '<span class="pill">inativo</span>'
      : w.blocking_problems ? `<span class="pill bad">não entra: ${w.blocking_problems} doc.</span>`
      : !w.card_uid ? '<span class="pill warn">sem cartão</span>' : '<span class="pill ok">pode entrar</span>'}</td></tr>`).join('')}</table>`;
  el.querySelectorAll('tr.link').forEach((tr) => tr.onclick = () => { state.worker = tr.dataset.id; go('ficha'); });
}

// One worker: documents, card, sites, active.
async function viewWorker() {
  const id = state.worker; if (!id) return go('trabalhadores');
  app.innerHTML = `<p class="noprint"><button class="btn ghost" id="back">‹ Trabalhadores</button></p><div id="w"><p class="muted">A carregar…</p></div>`;
  $('#back').onclick = () => go('trabalhadores');
  const [ws, ds, us] = await Promise.all([sb.rpc('mini_workers'), sb.rpc('mini_worker_documents', { p_collab: id }),
    isAdmin() ? sb.rpc('mini_app_users') : Promise.resolve({ data: [] })]);
  const login = ((us && us.data) || []).find((u) => u.collaborator_id === id);
  const el = $('#w'); if (!el) return;
  if (ws.error || ds.error) { el.innerHTML = `<p>${esc(friendly(ws.error || ds.error))}</p>`; return; }
  const w = ws.data.find((x) => x.collaborator_id === id); if (!w) { el.innerHTML = '<p>Não encontrado.</p>'; return; }
  const docState = (d) => ({ ok: '<span class="pill ok">válido</span>', a_caducar: `<span class="pill warn">caduca em ${d.days_left} dia(s)</span>`,
    caducado: '<span class="pill bad">caducado</span>', em_falta: d.is_blocking ? '<span class="pill bad">em falta</span>' : '<span class="pill">não tem</span>' }[d.state]);
  el.innerHTML = `<h1>${esc(w.full_name)}</h1>
    <p class="muted">${esc(w.employee_number || '')} · ${esc(w.organization)} · ${w.is_active ? 'ativo' : '<b>inativo</b>'}</p>
    <div class="card"><h2 style="margin-top:0">Documentos e formação</h2>
      <table><tr><th>Documento</th><th>Validade</th><th>Estado</th></tr>${ds.data.map((d) => `<tr>
        <td>${esc(d.name)}${d.is_blocking ? ' <span class="small muted">(trava a entrada)</span>' : ''}
          ${d.document_number ? `<div class="small muted">nº ${esc(d.document_number)}</div>` : ''}</td>
        <td>${d.issue_date ? (d.expiration_date ? 'até ' + esc(fmtDate(d.expiration_date)) : 'sem validade') : ''}</td>
        <td>${docState(d)}</td></tr>`).join('')}</table>
      ${canDocs() ? `<h2>Registar ou renovar</h2>
      <form id="doc"><label>Documento</label><select name="type">${ds.data.map((d) => `<option value="${esc(d.type_id)}">${esc(d.name)}</option>`).join('')}</select>
        <div class="row"><div><label>Data de emissão *</label><input name="issue" type="date" required max="${isoDay(new Date())}"></div>
        <div><label>Válido até (vazio = não caduca)</label><input name="expiry" type="date"></div></div>
        <label>Número (opcional)</label><input name="num">
        <p class="small muted">Regista só o que viste em papel. Fica escrito que foste tu a verificar, e quando.</p>
        <p><button class="btn">Guardar documento</button></p></form>` : ''}
    </div>
    ${canPeople() ? `<div class="card"><h2 style="margin-top:0">Cartão</h2>
      <p>${w.card_uid ? 'Cartão atual: <b>' + esc(w.card_uid) + '</b>' : '<b>Sem cartão.</b> Não consegue picar.'}</p>
      <form id="card"><div class="row"><div><label>Cartão novo</label><input name="card" autocomplete="off" placeholder="Encosta o cartão ou escreve o número" required></div>
        ${'NDEFReader' in window ? '<div style="flex:0 0 auto"><button type="button" class="btn ghost" id="read">Ler cartão</button></div>' : ''}</div>
        <label>Porquê? *</label><input name="why" required placeholder="ex.: cartão perdido">
        <p class="small muted">O cartão antigo deixa de funcionar logo.</p>
        <p><button class="btn">Trocar cartão</button></p></form></div>` : ''}
    ${isAdmin() || (state.me && ['hr', 'project_manager'].includes(state.me.role)) ? `<div class="card"><h2 style="margin-top:0">Obras</h2>
      ${activeSites().map((s) => `<label class="check"><input type="checkbox" data-site="${esc(s.id)}" ${w.site_ids.includes(s.id) ? 'checked' : ''}>
        ${esc(s.title)} (${esc(s.cost_center_code)})</label>`).join('') || '<p class="muted">Sem obras abertas.</p>'}
      <p class="small muted">Só pode picar nas obras marcadas.</p></div>` : ''}
    ${isAdmin() ? `<div class="card"><h2 style="margin-top:0">Conta na app</h2>${login ? `
      <p>${esc(login.email)} · ${login.role === 'hse' ? 'Técnico de segurança' : 'Encarregado'} ·
        ${login.is_active ? '<span class="pill ok">ligada</span>' : '<span class="pill">desligada</span>'}</p>
      <p><button class="btn ghost" id="toggleLogin">${login.is_active ? 'Desligar a conta' : 'Ligar a conta'}</button></p>` : w.is_active ? `
      <p class="small muted">Dá a esta pessoa acesso à app para picar, ver quem está na obra e validar horas.</p>
      <form id="login"><label>Email *</label><input name="email" type="email" required autocomplete="off">
        <label>Papel</label><select name="role"><option value="supervisor">Encarregado</option><option value="hse">Técnico de segurança</option></select>
        <p><button class="btn">Criar conta</button></p></form><div id="newpw"></div>` : '<p class="muted">Pessoa inativa: sem conta.</p>'}</div>` : ''}
    ${canPeople() ? `<div class="card"><h2 style="margin-top:0">${w.is_active ? 'Desativar' : 'Reativar'}</h2>
      <form id="act"><label>Porquê? *</label><input name="why" required placeholder="${w.is_active ? 'ex.: terminou o contrato' : 'ex.: voltou a ser contratado'}">
      <p class="small muted">${w.is_active ? 'Deixa de poder entrar em qualquer obra e o cartão é anulado. O histórico fica guardado.' : 'Depois de reativar, dá-lhe um cartão.'}</p>
      <p><button class="btn ${w.is_active ? 'danger' : ''}">${w.is_active ? 'Desativar' : 'Reativar'}</button></p></form></div>` : ''}`;
  if ($('#doc')) $('#doc').onsubmit = async (e) => {
    e.preventDefault(); const f = new FormData(e.target);
    const { error } = await sb.rpc('mini_add_document', { p_collab: id, p_type: f.get('type'), p_issue: f.get('issue'),
      p_expiry: f.get('expiry') || null, p_number: f.get('num') || null });
    if (error) return toast(friendly(error));
    toast('Documento guardado.'); viewWorker();
  };
  if ($('#read')) $('#read').onclick = () => readOneCard('#card input[name=card]');
  if ($('#card')) $('#card').onsubmit = async (e) => {
    e.preventDefault(); const f = new FormData(e.target);
    const { error } = await sb.rpc('mini_set_card', { p_collab: id, p_card_uid: normUid(f.get('card')), p_reason: f.get('why') });
    if (error) return toast(friendly(error));
    toast('Cartão trocado.'); viewWorker();
  };
  app.querySelectorAll('input[data-site]').forEach((cb) => cb.onchange = async () => {
    const { data, error } = await sb.rpc('mini_assign_worker', { p_collab: id, p_project: cb.dataset.site, p_on: cb.checked });
    if (error) { cb.checked = !cb.checked; return toast(friendly(error)); }
    toast(cb.checked ? 'Pode picar nesta obra a partir de hoje.' : data === 'amanha'
      ? 'Foi posto nesta obra hoje: só deixa de poder picar a partir de amanhã.' : 'Já não pode picar nesta obra.');
  });
  if ($('#login')) $('#login').onsubmit = async (e) => {
    e.preventDefault(); const f = new FormData(e.target); const btn = e.target.querySelector('.btn'); btn.disabled = true;
    const { data, error } = await sb.functions.invoke('mini-criar-conta', { body: { email: f.get('email'), collaborator_id: id, role: f.get('role') } });
    btn.disabled = false;
    let msg = error && error.message;
    if (error && error.context && error.context.json) { try { msg = (await error.context.json()).error || msg; } catch (_) {} }
    if (error) return toast(friendly({ message: msg }));
    e.target.hidden = true;
    $('#newpw').innerHTML = `<div class="result warn"><b>${esc(data.password)}</b>Palavra-passe temporária de ${esc(data.email)}</div>
      <p><b>Dá-a à pessoa em mão ou diz-lha de viva voz.</b> Não a envies por mensagem nem email. Só aparece agora.
      No primeiro login, a pessoa escolhe a sua palavra-passe.</p><p><button class="btn ghost" id="pwdone">Já entreguei</button></p>`;
    $('#pwdone').onclick = () => viewWorker();
  };
  if ($('#toggleLogin')) $('#toggleLogin').onclick = async () => {
    const why = prompt(login.is_active ? 'Porque é que desligas esta conta?' : 'Porque é que ligas outra vez esta conta?');
    if (!why) return;
    const { error } = await sb.rpc('mini_set_user_active', { p_user: login.user_id, p_active: !login.is_active, p_reason: why });
    if (error) return toast(friendly(error));
    toast(login.is_active ? 'Conta desligada.' : 'Conta ligada.'); viewWorker();
  };
  if ($('#act')) $('#act').onsubmit = async (e) => {
    e.preventDefault(); const f = new FormData(e.target);
    if (w.is_active && !confirm(`Desativar ${w.full_name}? Deixa de poder entrar em qualquer obra.`)) return;
    const { error } = await sb.rpc('mini_set_worker_active', { p_collab: id, p_active: !w.is_active, p_reason: f.get('why') });
    if (error) return toast(friendly(error));
    toast(w.is_active ? 'Desativado.' : 'Reativado. Dá-lhe um cartão.'); await loadBasics(); viewWorker();
  };
}

// The person is already registered (same NIF): open their sheet instead of a dead-end error.
function offerExisting(p) {
  const card = $('#newcard'); if (!card) return;
  let box = $('#dup'); if (!box) { box = document.createElement('div'); box.id = 'dup'; card.prepend(box); }
  box.innerHTML = `<div class="result warn" style="font-size:16px"><b>Já existe</b>${esc(p.full_name)} já está registado com esse NIF.
    <p><button class="btn" id="opendup">Abrir a ficha de ${esc(p.full_name)}</button></p></div>`;
  $('#opendup').onclick = () => { state.worker = p.id; go('ficha'); };
  box.scrollIntoView({ behavior: 'smooth' });
}

async function readOneCard(sel) {
  try {
    const ctrl = new AbortController(); const reader = new NDEFReader();
    await reader.scan({ signal: ctrl.signal }); toast('Encosta o cartão ao telemóvel.');
    reader.onreading = (ev) => { app.querySelector(sel).value = normUid(ev.serialNumber); ctrl.abort(); toast('Cartão lido.'); };
    setTimeout(() => ctrl.abort(), 20000);
  } catch (err) { toast('O NFC não arrancou: ' + err.message); }
}

// ------------------------------------------------------------------ Segurança
function viewSafety() {
  app.innerHTML = `<h1>Segurança</h1>
    <div class="card"><div class="noprint">${siteSelect('site')}</div><div id="list"><p class="muted">A carregar…</p></div>
    <p class="noprint"><button class="btn ghost" id="print">Imprimir</button></p></div>
    ${isAdmin() ? `<h2 class="noprint">O que trava a entrada</h2><div class="card noprint" id="types"></div>` : ''}`;
  bindSiteSelect('site', loadSafety);
  $('#print').onclick = () => window.print();
  loadSafety();
  if (isAdmin()) showDocTypes();
}
async function loadSafety() {
  const el = $('#list'); const site = currentSite(); if (!el) return;
  if (!site) { el.innerHTML = ''; return; }
  const { data, error } = await sb.rpc('mini_safety_alerts', { p_project: site.id });
  if (error) { el.innerHTML = `<p>${esc(friendly(error))}</p>`; return; }
  const blocked = new Set(data.filter((r) => r.is_blocking && r.state !== 'a_caducar').map((r) => r.collaborator_id));
  if (!data.length) { el.innerHTML = `<p class="result ok" style="font-size:17px"><b>Tudo em dia</b>Ninguém atribuído a ${esc(site.title)} tem documentos em falta ou a caducar.</p>`; return; }
  const label = { em_falta: 'em falta', caducado: 'caducado', a_caducar: 'a caducar' };
  el.innerHTML = `<p><span class="big-count">${blocked.size}</span> pessoa(s) <b>não podem entrar</b> em ${esc(site.title)}</p>
    <table><tr><th>Quem</th><th>Documento</th><th>Estado</th></tr>${data.map((r) => `<tr class="link" data-id="${esc(r.collaborator_id)}">
    <td>${esc(r.full_name)}<div class="small muted">${esc(r.employee_number || '')}</div></td>
    <td>${esc(r.document)}${r.is_blocking ? '' : ' <span class="small muted">(não trava)</span>'}</td>
    <td><span class="pill ${r.state === 'a_caducar' || !r.is_blocking ? 'warn' : 'bad'}">${label[r.state]}${r.expiration_date ? ' ' + esc(fmtDate(r.expiration_date)) : ''}</span></td></tr>`).join('')}</table>
    <p class="small muted noprint">Toca numa pessoa para registar o documento.</p>`;
  el.querySelectorAll('tr.link').forEach((tr) => tr.onclick = () => { state.worker = tr.dataset.id; go('ficha'); });
}
function showDocTypes() {
  const el = $('#types'); if (!el) return;
  el.innerHTML = `<p class="small muted">Um documento que trava é obrigatório para todos: sem ele válido, a entrada é recusada.</p>
    ${state.docTypes.map((t) => `<label class="check"><input type="checkbox" data-type="${esc(t.id)}" ${t.is_blocking ? 'checked' : ''}> ${esc(t.name)}</label>`).join('')}`;
  el.querySelectorAll('input[data-type]').forEach((cb) => cb.onchange = async () => {
    const why = prompt(cb.checked ? 'Porque é que este documento passa a travar a entrada?' : 'Porque é que este documento deixa de travar a entrada?');
    if (!why) { cb.checked = !cb.checked; return; }
    const { error } = await sb.rpc('mini_set_document_blocking', { p_type: cb.dataset.type, p_blocking: cb.checked, p_reason: why });
    if (error) { cb.checked = !cb.checked; return toast(friendly(error)); }
    await loadBasics(); toast('Guardado.'); loadSafety();
  });
}

// ------------------------------------------------------------------ Horas
function monday(d) { const x = new Date(d); x.setHours(12, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
function viewHours() {
  if (!state.weekStart) state.weekStart = monday(new Date());
  const from = state.weekStart; const to = new Date(from); to.setDate(to.getDate() + 6);
  app.innerHTML = `<h1>Mapa de horas</h1>
    <div class="card"><div class="noprint">${siteSelect('site')}</div>
      <div class="row noprint" style="margin-top:10px"><div style="flex:0 0 auto"><button class="btn ghost" id="prev">‹ Semana anterior</button></div>
        <div style="flex:0 0 auto"><button class="btn ghost" id="next">Semana seguinte ›</button></div></div>
      <p><b>Semana de ${esc(fmtDate(isoDay(from)))} a ${esc(fmtDate(isoDay(to)))}</b></p>
      <div id="list"><p class="muted">A carregar…</p></div>
      <p class="noprint"><button class="btn" id="all" hidden>Validar todos os dias sem problemas</button>
        <button class="btn ghost" id="print">Imprimir</button></p></div>
    <div class="card noprint"><h2 style="margin-top:0">Picagem esquecida</h2>
      <form id="miss"><label>Trabalhador</label><select name="who" id="who"></select>
        <div class="row"><div><label>Entrada ou saída</label><select name="dir"><option value="in">Entrada</option><option value="out">Saída</option></select></div>
        <div><label>Dia e hora *</label><input name="at" type="datetime-local" required></div></div>
        <label>Porquê? *</label><input name="why" required placeholder="ex.: esqueceu-se de picar à saída, confirmado por mim">
        <p class="small muted">Fica marcada como acrescentada à mão, com o teu nome e o motivo. Não podes acrescentar picagens a ti próprio.</p>
        <p><button class="btn">Acrescentar</button></p></form></div>`;
  bindSiteSelect('site', viewHours);
  $('#prev').onclick = () => { state.weekStart.setDate(state.weekStart.getDate() - 7); viewHours(); };
  $('#next').onclick = () => { state.weekStart.setDate(state.weekStart.getDate() + 7); viewHours(); };
  $('#print').onclick = () => window.print();
  $('#miss').onsubmit = async (e) => {
    e.preventDefault(); const f = new FormData(e.target); const site = currentSite(); if (!site) return;
    const { error } = await sb.rpc('mini_add_missed_tap', { p_collab: f.get('who'), p_project: site.id, p_direction: f.get('dir'),
      p_time: new Date(f.get('at')).toISOString(), p_reason: f.get('why') });
    if (error) return toast(friendly(error));
    toast('Picagem acrescentada.'); viewHours();
  };
  fillWorkerSelect();
  loadHours(isoDay(from), isoDay(to));
}
async function fillWorkerSelect() {
  const sel = $('#who'); const site = currentSite(); if (!sel || !site) return;
  const { data } = await sb.rpc('mini_workers');
  const list = (data || []).filter((w) => w.is_active && w.site_ids.includes(site.id));
  sel.innerHTML = list.map((w) => `<option value="${esc(w.collaborator_id)}">${esc(w.full_name)}</option>`).join('')
    || '<option value="">Ninguém atribuído a esta obra</option>';
}
const ANOMALY = { double_in: 'duas entradas seguidas', out_without_in: 'saída sem entrada', missing_out: 'falta a saída' };
const DAY_STATUS = { registered: '<span class="pill">por validar</span>', supervisor_validated: '<span class="pill ok">validado</span>',
  hr_validated: '<span class="pill ok">validado RH</span>', sent_to_payroll: '<span class="pill ok">salários</span>' };
async function loadHours(from, to) {
  const el = $('#list'); const site = currentSite(); if (!el) return;
  if (!site) { el.innerHTML = ''; return; }
  const { data, error } = await sb.rpc('mini_hours', { p_project: site.id, p_from: from, p_to: to });
  if (error) { el.innerHTML = `<p>${esc(friendly(error))}</p>`; return; }
  if (!data.length) { el.innerHTML = '<p class="muted">Sem horas nesta semana.</p>'; return; }
  const byWorker = {};
  for (const r of data) (byWorker[r.collaborator_id] = byWorker[r.collaborator_id] || []).push(r);
  const me = state.me && state.me.collaborator_id;
  el.innerHTML = Object.values(byWorker).map((rows) => {
    const tot = rows.reduce((a, r) => ({ w: a.w + r.worked_minutes, o: a.o + r.overtime_minutes }), { w: 0, o: 0 });
    return `<h2>${esc(rows[0].full_name)} <span class="small muted">${esc(rows[0].employee_number || '')}</span></h2>
    <table><tr><th>Dia</th><th>Entrada</th><th>Saída</th><th>Horas</th><th>Estado</th></tr>${rows.map((r) => `<tr>
      <td>${esc(new Date(r.shift_date + 'T12:00:00').toLocaleDateString('pt-PT', { weekday: 'short', day: '2-digit', month: '2-digit' }))}</td>
      <td>${esc(fmtHour(r.first_in))}</td><td>${esc(fmtHour(r.last_out))}</td>
      <td>${esc(fmtMin(r.worked_minutes))}${r.overtime_minutes ? `<div class="small">${esc(fmtMin(r.overtime_minutes))} extra${r.overtime_approved === false ? ' (recusadas)' : ''}</div>` : ''}
        ${r.has_manual ? '<div class="small muted">tem picagem à mão</div>' : ''}</td>
      <td>${r.anomalies.length ? `<span class="pill bad">${esc(r.anomalies.map((a) => ANOMALY[a] || a).join(', '))}</span>` : DAY_STATUS[r.status] || esc(r.status)}
        ${r.status === 'registered' && r.collaborator_id !== me ? `<div class="noprint" style="margin-top:4px">${r.anomalies.length
          ? `<button class="btn ghost small" data-fix="${esc(r.collaborator_id)}" data-day="${esc(r.shift_date)}">Corrigir</button>`
          : r.overtime_minutes ? `<button class="btn small" data-ok="${esc(r.work_day_id)}" data-ot="1">Validar com extra</button>
              <button class="btn ghost small" data-ok="${esc(r.work_day_id)}" data-ot="0">Sem extra</button>`
          : `<button class="btn small" data-ok="${esc(r.work_day_id)}">Validar</button>`}</div>` : ''}</td></tr>`).join('')}
      <tr><td colspan="3"><b>Total da semana</b></td><td colspan="2"><b>${esc(fmtMin(tot.w))}</b>${tot.o ? ` <span class="small">(${esc(fmtMin(tot.o))} extra)</span>` : ''}</td></tr></table>`;
  }).join('') + '<p class="small muted print-only">Assinatura do encarregado: ______________________</p>';
  const easy = data.filter((r) => r.status === 'registered' && !r.anomalies.length && !r.overtime_minutes && r.collaborator_id !== me);
  const all = $('#all'); if (all) { all.hidden = !easy.length; all.onclick = () => validate(easy.map((r) => r.work_day_id), null); }
  el.querySelectorAll('button[data-ok]').forEach((b) => b.onclick = () =>
    validate([b.dataset.ok], b.dataset.ot === undefined ? null : b.dataset.ot === '1'));
  el.querySelectorAll('button[data-fix]').forEach((b) => b.onclick = () => fixDay(b.dataset.fix, b.dataset.day));
}
async function validate(ids, overtime) {
  const { data, error } = await sb.rpc('advance_work_days', { p_ids: ids, p_to: 'supervisor_validated', p_overtime_approved: overtime });
  if (error) return toast(friendly(error));
  toast(`${data} dia(s) validado(s).`); viewHours();
}
// Show the taps of the day and point the form at the missing one.
async function fixDay(collabId, day) {
  const site = currentSite(); if (!site) return;
  const { data, error } = await sb.rpc('mini_day_events', { p_collab: collabId, p_project: site.id, p_day: day });
  if (error) return toast(friendly(error));
  const taps = (data || []).filter((e) => e.effective_time.slice(0, 10) >= day).map((e) =>
    `${e.direction === 'in' ? 'Entrada' : e.direction === 'out' ? 'Saída' : e.direction} ${fmtTime(e.effective_time)}`).join(' · ');
  const f = $('#miss'); f.who.value = collabId;
  const hasIn = (data || []).some((e) => e.direction === 'in' && e.effective_time.slice(0, 10) === day);
  f.dir.value = hasIn ? 'out' : 'in';
  f.at.value = day + (hasIn ? 'T17:00' : 'T08:00');
  f.scrollIntoView({ behavior: 'smooth' });
  toast('Picagens deste dia: ' + (taps || 'nenhuma') + '. Acerta a hora e o motivo.');
}

// ------------------------------------------------------------------ Obras
function viewSites() {
  const label = { execution: '<span class="pill ok">em curso</span>', lead: '<span class="pill">rascunho</span>' };
  app.innerHTML = `<h1>Obras</h1>
    ${isAdmin() || (state.me && state.me.role === 'project_manager') ? `<div class="card"><h2 style="margin-top:0">Abrir obra</h2>
    <form id="f"><div class="row"><div><label>Cliente *</label><input name="client" required placeholder="ex.: Refinaria de Sines"></div>
      <div><label>Código *</label><input name="code" required placeholder="ex.: OB-001"></div></div>
      <label>Nome da obra *</label><input name="title" required placeholder="ex.: Paragem 2026, unidade 3">
      <label>Morada</label><input name="addr">
      <p class="small muted">A obra abre logo pronta para picar. Os trabalhadores têm de ser atribuídos a ela.</p>
      <p><button class="btn">Abrir obra</button></p></form></div>` : ''}
    <h2>Lista</h2><div class="card">${state.sites.length ? `<table><tr><th>Obra</th><th>Código</th><th>Estado</th></tr>${state.sites.map((s) => `<tr>
      <td>${esc(s.title)}<div class="small muted">${esc(s.address || '')}</div></td><td>${esc(s.cost_center_code)}</td>
      <td>${label[s.status] || `<span class="pill">${esc(s.status)}</span>`}</td></tr>`).join('')}</table>` : '<p class="muted">Ainda não há obras.</p>'}</div>`;
  if ($('#f')) $('#f').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const { data, error } = await sb.rpc('mini_open_site', { p_client: f.get('client'), p_title: f.get('title'),
      p_code: f.get('code'), p_address: f.get('addr') || null });
    if (error) return toast(friendly(error));
    store(SITE_KEY, data); toast('Obra aberta.');
    await loadBasics(); viewSites();
  };
}
