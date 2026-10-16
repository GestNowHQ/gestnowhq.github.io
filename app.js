// GestNow Mini: picagem com cartão, obras, trabalhadores e quem está na obra.
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
  [/at least 10 characters/i, 'Escreve o que foi verificado em papel (pelo menos 10 letras).'],
  [/required/i, 'Falta preencher um campo obrigatório.'],
  [/Invalid login credentials/i, 'Email ou palavra-passe errados.'],
  [/Failed to fetch|NetworkError|network/i, 'Sem rede. Tenta outra vez.'],
];

const state = { ready: false, me: null, sites: [], people: [], view: 'picar', direction: 'in', nfc: null, timer: null };

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
  for (const p in REASON_PREFIX) if (code.startsWith(p)) return REASON_PREFIX[p] + code.slice(p.length);
  return code;
}
const fmtTime = (iso) => new Date(iso).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
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
  state.me = { ...me, email: session.user.email };
  const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  if (PRIVILEGED.includes(me.role) && aal.currentLevel !== 'aal2') {
    return aal.nextLevel === 'aal2' ? showMfaVerify() : showMfaEnroll();
  }
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
  nav.querySelectorAll('button[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
  ({ picar: viewClock, naobra: viewOnSite, trabalhadores: viewPeople, obras: viewSites }[view] || viewClock)();
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
  if (d.status === 'accepted') { showResult('ok', who, `${word} aceite`); beep(true); }
  else if (d.status === 'duplicate') { showResult('warn', who, 'Já picou há instantes'); beep(true); }
  else { showResult('bad', `${who}: NÃO ENTRA`, (d.reasons || []).map(reasonText).join(' · ')); beep(false); }
  loadRecent();
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
function viewPeople() {
  const status = (p) => !p.is_active ? '<span class="pill">saiu</span>'
    : p.onboarding_status === 'active' ? '<span class="pill ok">ativo</span>' : '<span class="pill warn">acolhimento</span>';
  app.innerHTML = `<h1>Trabalhadores</h1>
    <div class="card"><h2 style="margin-top:0">Novo trabalhador</h2>
    <form id="f"><div class="row"><div><label>Nome completo *</label><input name="name" required></div>
      <div><label>NIF *</label><input name="nif" inputmode="numeric" required></div></div>
      <div class="row"><div><label>Nº de trabalhador</label><input name="num"></div>
      <div><label>Função</label><input name="job" placeholder="ex.: Serralheiro"></div></div>
      <div class="row"><div><label>Cartão</label><input name="card" autocomplete="off" placeholder="Encosta o cartão ou escreve o número"></div>
      ${'NDEFReader' in window ? '<div style="flex:0 0 auto"><button type="button" class="btn ghost" id="read">Ler cartão</button></div>' : ''}</div>
      ${siteSelect('site')}
      <label>O que verificaste em papel? *</label>
      <textarea name="stmt" required placeholder="ex.: Acolhimento de segurança feito a 12/10, ficha médica válida até 03/2027, contrato na CPS."></textarea>
      <p class="small muted">Fica guardado como prova do acolhimento. Escreve só o que viste mesmo.</p>
      <p><button class="btn">Guardar</button></p></form></div>
    <h2>Lista (${state.people.length})</h2>
    <div class="card">${state.people.length ? `<table><tr><th>Nome</th><th>Nº</th><th>Função</th><th>Estado</th></tr>${state.people.map((p) => `<tr>
      <td>${esc(p.full_name)}</td><td>${esc(p.employee_number || '')}</td><td>${esc(p.job_title || '')}</td><td>${status(p)}</td></tr>`).join('')}</table>`
      : '<p class="muted">Ainda ninguém.</p>'}</div>`;
  bindSiteSelect('site');
  if ($('#read')) $('#read').onclick = readOneCard;
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target); const btn = e.target.querySelector('.btn:not(.ghost)'); btn.disabled = true;
    const { error } = await sb.rpc('mini_add_worker', {
      p_full_name: f.get('name'), p_tax_number: f.get('nif'), p_employee_number: f.get('num'),
      p_card_uid: normUid(f.get('card')), p_project: $('#site') ? $('#site').value : null,
      p_statement: f.get('stmt'), p_job_title: f.get('job') });
    btn.disabled = false;
    if (error) return toast(friendly(error));
    toast('Trabalhador guardado e ativo.');
    await loadBasics(); viewPeople();
  };
}
async function readOneCard() {
  try {
    const ctrl = new AbortController(); const reader = new NDEFReader();
    await reader.scan({ signal: ctrl.signal }); toast('Encosta o cartão ao telemóvel.');
    reader.onreading = (ev) => { app.querySelector('input[name=card]').value = normUid(ev.serialNumber); ctrl.abort(); toast('Cartão lido.'); };
    setTimeout(() => ctrl.abort(), 20000);
  } catch (err) { toast('O NFC não arrancou: ' + err.message); }
}

// ------------------------------------------------------------------ Obras
function viewSites() {
  const label = { execution: '<span class="pill ok">em curso</span>', lead: '<span class="pill">rascunho</span>' };
  app.innerHTML = `<h1>Obras</h1>
    <div class="card"><h2 style="margin-top:0">Abrir obra</h2>
    <form id="f"><div class="row"><div><label>Cliente *</label><input name="client" required placeholder="ex.: Refinaria de Sines"></div>
      <div><label>Código *</label><input name="code" required placeholder="ex.: OB-001"></div></div>
      <label>Nome da obra *</label><input name="title" required placeholder="ex.: Paragem 2026, unidade 3">
      <label>Morada</label><input name="addr">
      <p class="small muted">A obra abre logo pronta para picar. Os trabalhadores têm de ser atribuídos a ela.</p>
      <p><button class="btn">Abrir obra</button></p></form></div>
    <h2>Lista</h2><div class="card">${state.sites.length ? `<table><tr><th>Obra</th><th>Código</th><th>Estado</th></tr>${state.sites.map((s) => `<tr>
      <td>${esc(s.title)}<div class="small muted">${esc(s.address || '')}</div></td><td>${esc(s.cost_center_code)}</td>
      <td>${label[s.status] || `<span class="pill">${esc(s.status)}</span>`}</td></tr>`).join('')}</table>` : '<p class="muted">Ainda não há obras.</p>'}</div>`;
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const { data, error } = await sb.rpc('mini_open_site', { p_client: f.get('client'), p_title: f.get('title'),
      p_code: f.get('code'), p_address: f.get('addr') || null });
    if (error) return toast(friendly(error));
    store(SITE_KEY, data); toast('Obra aberta.');
    await loadBasics(); viewSites();
  };
}
