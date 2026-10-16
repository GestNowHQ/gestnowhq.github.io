// GestNow Mini: picagem com cartão, obras, trabalhadores, quem está na obra, documentos e mapa de horas.
// Sem passo de compilação: ficheiros estáticos, publicáveis em qualquer alojamento com HTTPS.
'use strict';

const cfg = window.GESTNOW_CONFIG || {};
const app = document.getElementById('app');
const nav = document.getElementById('nav');
const PRIVILEGED = ['admin', 'hr', 'finance', 'hse', 'project_manager'];   // the database asks these roles for MFA (aal2)
const QUEUE_KEY = 'gestnow.queue';          // taps waiting for the network (each with its own id, p_client_event_id)
const REJECTED_KEY = 'gestnow.rejected';    // taps the server refused after the network came back: kept until someone deals with them
const SITE_KEY = 'gestnow.site';
const SITES_KEY = 'gestnow.sites';          // the site list, to open the app without network (no personal data)
const ME_KEY = 'gestnow.me';                // role and company of the last login, to open Picar without network
const CLOCK_KEY = 'gestnow.clock';          // difference between this phone's clock and the server's
const LASTDIR_KEY = 'gestnow.lastDir';      // last direction per card (hashed), for the automatic direction without network

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
  [/cannot record your own clock-in late/i, 'Não podes registar a tua própria picagem com atraso (ficou sem rede). Pede a outro encarregado ou ao escritório para a acrescentar como picagem esquecida.'],
  [/tap not found/i, 'Essa picagem já não existe ou já foi anulada.'],
  [/close a whole month/i, 'Só se fecha o mês inteiro, do dia 1 ao último dia.'],
  [/this month is already closed/i, 'Este mês já está fechado.'],
  [/close the whole month instead/i, 'Fecha o mês inteiro no Secretariado.'],
  [/cannot send back your own hours/i, 'Não podes devolver as tuas próprias horas.'],
  [/set the municipality of the site first/i, 'Escreve primeiro o concelho da obra e guarda.'],
  [/date and name are required/i, 'Escreve a data e o nome do feriado.'],
  [/country must be PT or ES/i, 'Escolhe Portugal ou Espanha.'],
  [/municipality name is too long/i, 'O nome do concelho é comprido demais.'],
  [/only an entry or an exit/i, 'Só se pode acrescentar uma entrada ou uma saída.'],
  [/project not found/i, 'Obra não encontrada, ou já não estás atribuído a ela.'],
  [/collaborator not found/i, 'Escolhe o trabalhador.'],
  [/attach the photo or PDF/i, 'Falta a foto ou o PDF do documento.'],
  [/file not allowed for this person|row-level security/i, 'Sem permissão para guardar este ficheiro. Confirma que entraste com a segunda verificação.'],
  [/file not found, send it again/i, 'O ficheiro não chegou ao servidor. Tenta outra vez.'],
  [/already used by another document/i, 'Esse ficheiro já está noutro documento.'],
  [/invalid file fingerprint/i, 'Não consegui ler o ficheiro. Tenta outra vez.'],
  [/mime type|invalid_mime_type/i, 'Só aceito fotos (JPG, PNG) ou PDF.'],
  [/maximum allowed size|payload too large|entity too large/i, 'O ficheiro é grande demais (máximo 10 MB).'],
  [/(\d+) day\(s\) still to approve/i, 'Ainda há dias por aprovar neste mês. Aprova ou devolve todos antes de fechar.'],
  [/period is not over yet/i, 'O mês ainda não acabou.'],
  [/nothing to close/i, 'Não há nada para fechar neste mês.'],
  [/cannot be sent back/i, 'Esse dia já está fechado para os salários.'],
  [/already sent to payroll|period is locked/i, 'Esse mês já foi fechado para os salários: já não se pode mudar.'],
  [/segregation of duties/i, 'Validaste este dia na obra: tem de ser outra pessoa a aprovar.'],
  [/only HR validates/i, 'Só o secretariado aprova.'],
  [/too far in the past/i, 'A hora da picagem é antiga demais. Acrescenta-a como picagem esquecida, com o motivo.'],
  [/more than 7 days old/i, 'Picagem guardada há mais de 7 dias: acrescenta-a como picagem esquecida, com o motivo.'],
  [/each type needs its own code/i, 'Dois tipos de hora têm o mesmo código do Primavera. Cada tipo precisa do seu código.'],
  [/invalid Primavera code/i, 'Um código do Primavera só pode ter letras, números, ponto, traço ou _ (até 10).'],
  [/invalid time padding/i, 'Escolhe zeros ou espaços para encher o tempo.'],
  [/this field is required/i, 'O funcionário, a data, o código e o tempo têm de ter tamanho maior que 0.'],
  [/two fields overlap/i, 'Dois campos ocupam as mesmas colunas do ficheiro. Acerta as posições.'],
  [/invalid position for/i, 'Uma posição não é válida.'],
  [/invalid marker/i, 'A letra tem de ser uma só letra ou número.'],
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

// dirOverride: null = automatic (the server decides from the person's state); 'in' / 'out' = forced for the next tap only.
// tapSeq: each tap gets a number; a slow answer for an older tap never overwrites the newer result (A5).
const state = { ready: false, me: null, sites: [], people: [], docTypes: [], view: 'picar', dirOverride: null, nfc: null, timer: null,
  worker: null, weekStart: null, tapSeq: 0, tapLog: [], offline: false, clockOffset: 0, prefill: null };

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
  // A missed entry for a person who was blocked at that time (inactive, documents): say why, in plain words.
  const blocked = /could not enter at that time:\s*(.*)$/i.exec(msg);
  if (blocked) return `Esta pessoa não podia entrar a essa hora: ${blocked[1].split(/,\s*/).map(reasonText).join(' · ')}. Resolve isso primeiro ou fala com o escritório.`;
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
// ---- Time zones: every time on screen and every time typed in is the SITE's time (BTA-01 is in Madrid), never the phone's.
const DEFAULT_TZ = 'Europe/Lisbon';
const siteTz = (id) => ((state.sites.find((s) => s.id === id) || {}).timezone) || DEFAULT_TZ;
const TZ_NAMES = { 'Europe/Lisbon': 'hora de Portugal continental', 'Europe/Madrid': 'hora de Espanha (Madrid)',
  'Atlantic/Azores': 'hora dos Açores', 'Atlantic/Madeira': 'hora da Madeira', 'Atlantic/Canary': 'hora das Canárias' };
const tzName = (tz) => TZ_NAMES[tz] || 'hora de ' + tz;
const tzFmt = {};
function tzParts(ms, tz) {
  const f = tzFmt[tz] || (tzFmt[tz] = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]));
  return p;
}
const tzOffset = (ms, tz) => { const p = tzParts(ms, tz); return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) - Math.floor(ms / 1000) * 1000; };
// "2026-10-16T08:00" typed as the site's time -> the real moment (ISO, UTC). In the October hour that repeats, the first one.
function zonedToUtc(local, tz) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local || ''); if (!m) return null;
  const base = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const o1 = tzOffset(base - 12 * 3600000, tz); const o2 = tzOffset(base + 12 * 3600000, tz);
  const cands = [base - o1, base - o2].filter((t) => tzOffset(t, tz) === base - t).sort((a, b) => a - b);
  return new Date(cands.length ? cands[0] : base - o1).toISOString();   // a time skipped by the spring change moves forward
}
const pad2 = (n) => String(n).padStart(2, '0');
// The site's date ("2026-10-16") and "date + time" for a datetime-local field, of a real moment.
const localDay = (iso, tz) => { const p = tzParts(new Date(iso).getTime(), tz || DEFAULT_TZ); return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`; };
const localInput = (iso, tz) => { const p = tzParts(new Date(iso).getTime(), tz || DEFAULT_TZ); return `${p.year}-${pad2(p.month)}-${pad2(p.day)}T${pad2(p.hour % 24)}:${pad2(p.minute)}`; };
const fmtTime = (iso, tz) => new Date(iso).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: tz || DEFAULT_TZ });
const fmtDate = (d) => d ? new Date(d + 'T12:00:00').toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
const fmtHour = (iso, tz) => iso ? new Date(iso).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit', timeZone: tz || DEFAULT_TZ }) : '';
// Every problem the hours engine can flag, in plain words. A shift still open today is not an error yet.
const ANOMALY = { double_in: 'duas entradas seguidas', out_without_in: 'saída sem entrada', missing_out: 'falta a saída',
  open_shift: 'ainda sem saída' };
const anomalyText = (code, day, tz) => (code === 'open_shift' && day < localDay(new Date().toISOString(), tz) ? 'falta a saída'
  : ANOMALY[code] || 'picagens a verificar');
const onlyOpenToday = (r, tz) => r.anomalies.length > 0 && r.anomalies.every((a) => a === 'open_shift') && r.shift_date >= localDay(new Date().toISOString(), tz);
// Every in/out period of a day, as the server wrote it in the site's time zone ("08:00–12:00 · 13:00–17:00").
const periodList = (p) => (p ? p.split(' · ') : []);
async function dayPeriods(from, to, project) {
  const { data } = await sb.rpc('mini_day_periods', project ? { p_from: from, p_to: to, p_project: project } : { p_from: from, p_to: to });
  return Object.fromEntries((data || []).map((r) => [r.work_day_id, r.periods]));
}
const fmtMin = (m) => { m = m || 0; return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`; };
const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const isAdmin = () => state.me && state.me.role === 'admin';
const canPeople = () => state.me && ['admin', 'hr'].includes(state.me.role);
const canDocs = () => state.me && ['admin', 'hr', 'hse'].includes(state.me.role);

// ------------------------------------------------------------------ Comprovativos (foto ou PDF de cada documento)
// Private bucket: only admin, HR and safety send or open files, and a file is never replaced or deleted.
const FILE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
const FILE_MAX = 10 * 1024 * 1024;
const FILE_ACCEPT = Object.keys(FILE_TYPES).join(',');
function fileProblem(file) {
  if (!file || !file.size) return 'Falta a foto ou o PDF do documento.';
  if (!FILE_TYPES[file.type]) return 'Só aceito fotos (JPG, PNG) ou PDF.';
  if (file.size > FILE_MAX) return 'O ficheiro é grande demais (máximo 10 MB). Tira a foto com menos qualidade.';
  return null;
}
async function sha256Hex(file) {
  const buf = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
// Send the file, then register the document pointing to it. Returns { error } like an rpc.
async function addDocument(collab, type, issue, expiry, number, file) {
  const bad = fileProblem(file); if (bad) return { error: { message: bad } };
  const path = `${state.me.tenant_id}/${collab}/${crypto.randomUUID()}.${FILE_TYPES[file.type]}`;
  const sha = await sha256Hex(file);
  const up = await sb.storage.from('documentos').upload(path, file, { contentType: file.type, upsert: false });
  if (up.error) return { error: up.error };
  return sb.rpc('mini_add_document', { p_collab: collab, p_type: type, p_issue: issue, p_expiry: expiry || null,
    p_number: number || null, p_file: path, p_sha256: sha });
}
// Open a file with a link that only works for 2 minutes.
async function openDocFile(path) {
  const win = window.open('', '_blank');
  if (win) win.opener = null;
  const { data, error } = await sb.storage.from('documentos').createSignedUrl(path, 120);
  if (error || !data) { if (win) win.close(); return toast(friendly(error || 'sem link')); }
  if (win) win.location = data.signedUrl; else location.href = data.signedUrl;
}
const normUid = (v) => String(v || '').replace(/[\s:\-]/g, '').toUpperCase();
function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
// Returns false when the phone would not save (storage full or blocked): the caller must say so (B4).
function store(key, val) {
  try { val === undefined ? localStorage.removeItem(key) : localStorage.setItem(key, JSON.stringify(val)); return true; } catch (_) { return false; }
}
function load(key, dflt) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : dflt; } catch (_) { return dflt; } }
// true: short high beep (accepted). false: long low buzz (refused or error). 'neutral': two medium beeps (saved, not checked yet).
function beep(ok) {
  const neutral = ok === 'neutral';
  try { navigator.vibrate && navigator.vibrate(neutral ? [60, 90, 60] : ok ? 120 : [80, 60, 80, 60, 200]); } catch (_) {}
  try {
    const a = new (window.AudioContext || window.webkitAudioContext)(); const g = a.createGain(); g.connect(a.destination); g.gain.value = 0.15;
    const tone = (f, at, len) => { const o = a.createOscillator(); o.frequency.value = f; o.connect(g); o.start(a.currentTime + at); o.stop(a.currentTime + at + len); };
    if (neutral) { tone(520, 0, 0.1); tone(520, 0.2, 0.1); } else tone(ok ? 880 : 220, 0, ok ? 0.15 : 0.5);
  } catch (_) {}
}
// A short, stable fingerprint of a card number, so the last direction can be remembered without keeping the number.
function cardKey(uid) { let h = 0x811c9dc5; for (const ch of String(uid)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36); }

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
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (state.ready && state.me && idleTooLong(state.me.role)) return idleOut();
  checkSession();
});

// Inactivity lock: a phone left open (lost, lent, on a table) must not stay logged in.
// Short for the roles that see personal and health data, a full shift for the site roles.
const ACTIVE_KEY = 'gestnow.lastActive';
const IDLE_MIN = (role) => (['admin', 'hr', 'hse', 'finance', 'project_manager'].includes(role) ? 15 : 12 * 60);
function touch() { try { localStorage.setItem(ACTIVE_KEY, String(Date.now())); } catch (_) {} }
function idleTooLong(role) {
  let t = 0; try { t = Number(localStorage.getItem(ACTIVE_KEY)) || 0; } catch (_) {}
  return Date.now() - t > IDLE_MIN(role) * 60000;
}
async function idleOut() { state.idleOut = true; stopNfc(); state.ready = false; nav.hidden = true; await sb.auth.signOut({ scope: 'local' }); }
let lastTouch = 0;
['pointerdown', 'keydown'].forEach((ev) => document.addEventListener(ev, () => {
  if (state.ready && Date.now() - lastTouch > 15000) { lastTouch = Date.now(); touch(); }
}, { passive: true }));
setInterval(() => { if (state.ready && state.me && idleTooLong(state.me.role)) idleOut(); }, 30000);
// Saved taps are retried every minute too: the "online" event alone is not reliable on Android.
setInterval(() => { if (state.ready && queue().length) flushQueue(); }, 60000);
setInterval(() => { if (state.ready && !state.offline) syncClock(); }, 10 * 60000);
window.addEventListener('online', () => {
  if (!state.ready || state.offline) return boot();   // the network-error screen, or Picar opened without network
  flushQueue(); syncClock();
});
window.addEventListener('offline', () => { showQueue(); });
// The app shell (these files, never the Supabase data or the login) is kept on the phone, so Picar opens without network.
// Service workers only run on https:// (and on localhost for the tests); opened from a file there is none.
if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
const isNetErr = (e, status) => status === 0 || /fetch|network|Load failed|timeout|aborted|ERR_/i.test((e && (e.message || e.name)) || String(e || ''));
function storedSessionExists() { try { return Object.keys(localStorage).some((k) => /^sb-.*-auth-token$/.test(k)); } catch (_) { return false; } }

state.clockOffset = (load(CLOCK_KEY, null) || {}).off || 0;
boot();

async function boot() {
  stopNfc(); clearInterval(state.timer);
  state.ready = false; state.offline = false; nav.hidden = true; document.getElementById('whoami').hidden = true;
  let session = null; let sErr = null;
  try { const r = await sb.auth.getSession(); session = r.data.session; sErr = r.error; } catch (e) { sErr = e; }
  if (!session) return (sErr && isNetErr(sErr)) || (navigator.onLine === false && storedSessionExists()) ? showNetworkError() : showLogin();
  let me = null; let error = null;
  try {
    ({ data: me, error } = await core().from('app_users')
      .select('role, tenant_id, organization_id, collaborator_id, is_active').eq('user_id', session.user.id).maybeSingle().retry(false));   // no network: say so at once
  } catch (e) { error = e; }
  // No network is not "no access": open Picar with the last known login of THIS user (taps are queued), or say "no network".
  if (error && (isNetErr(error) || navigator.onLine === false)) {
    const cached = load(ME_KEY, null);
    if (!cached || cached.user_id !== session.user.id) return showNetworkError();
    me = cached; state.offline = true;
  } else if (error || !me) {
    return showMessage('Sem acesso', 'Este utilizador ainda não está ligado a nenhuma empresa. Corre o primeiro-admin.sql com este email.', true);
  }
  if (!me.is_active) return showMessage('Conta desligada', 'A tua conta está desligada. Fala com o administrador.', true);
  if (idleTooLong(me.role)) return idleOut();   // nothing is shown before this check
  state.me = { role: me.role, tenant_id: me.tenant_id, organization_id: me.organization_id, collaborator_id: me.collaborator_id,
    is_active: me.is_active, email: session.user.email, user_id: session.user.id };
  const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  if (PRIVILEGED.includes(me.role) && (!aal || aal.currentLevel !== 'aal2')) {
    if (state.offline) return showNetworkError();
    return aal && aal.nextLevel === 'aal2' ? showMfaVerify() : showMfaEnroll();
  }
  // A login made by the admin comes with a temporary password: the person chooses their own first.
  if (session.user.user_metadata && session.user.user_metadata.must_change_password) return state.offline ? showNetworkError() : showNewPassword();
  if (!state.offline) store(ME_KEY, { ...state.me });
  state.ready = true; touch();
  nav.hidden = false;
  nav.querySelector('[data-view=secretariado]').hidden = !canPeople();
  await loadBasics();
  showWho();
  if (state.offline) { go('picar'); return; }
  syncClock();
  flushQueue();
  const other = queue().filter((x) => x._u && x._u !== state.me.user_id);
  if (other.length) toast(`Há ${other.length} picagem(ns) de outra conta neste telemóvel, ainda por enviar.`);
  go(state.view);
}
// No network at all (and nothing to open offline): say it plainly, never "no access", and try again by itself.
function showNetworkError() {
  nav.hidden = true;
  const n = queue().length;
  app.innerHTML = `<div class="card" style="max-width:460px;margin:30px auto"><h1>Sem ligação</h1>
    <p>Não consegui falar com o servidor. Confirma que o telemóvel tem rede (dados móveis ou Wi-Fi) e toca em <b>Tentar outra vez</b>.</p>
    ${n ? `<p class="small">${n} picagem(ns) guardada(s) neste telemóvel. Não se perdem: são enviadas quando a rede voltar.</p>` : ''}
    <p><button class="btn" id="retry">Tentar outra vez</button></p></div>`;
  $('#retry').onclick = () => boot();
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

async function signOut() { stopNfc(); state.ready = false; nav.hidden = true; store(ME_KEY, undefined); await sb.auth.signOut(); }

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
    <h1>Entrar</h1>${state.idleOut ? '<p class="small muted">Saíste automaticamente por estares sem mexer na app. Entra outra vez.</p>' : ''}
    <form id="f"><label>Email</label><input name="email" type="email" autocomplete="username" required>
    <label>Palavra-passe</label><input name="password" type="password" autocomplete="current-password" required>
    <p><button class="btn" style="width:100%">Entrar</button></p></form></div>`;
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const { error } = await sb.auth.signInWithPassword({ email: f.get('email'), password: f.get('password') });
    if (error) return toast(friendly(error));
    state.idleOut = false; touch(); boot();
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
// Always show who is logged in and with which role, so nobody mistakes one account for another.
const ROLE_NAMES = { admin: 'Administrador', hr: 'Secretariado / RH', hse: 'Técnico de segurança', finance: 'Finanças',
  project_manager: 'Diretor de obra', supervisor: 'Encarregado' };
function showWho() {
  const me = state.me; const p = me.collaborator_id && state.people.find((x) => x.id === me.collaborator_id);
  const el = document.getElementById('whoami'); el.textContent = `${p ? p.full_name : me.email} · ${ROLE_NAMES[me.role] || me.role}`;
  el.className = 'who' + (PRIVILEGED.includes(me.role) ? ' strong' : ''); el.hidden = false;
}
async function loadBasics() {
  const [s, p] = await Promise.all([
    core().from('projects').select('id, title, cost_center_code, status, address, timezone, country, municipality').order('title').retry(!state.offline),
    core().from('collaborators').select('id, full_name, employee_number, job_title, onboarding_status, is_active, organization_id').order('full_name').retry(!state.offline),
  ]);
  // Without network the site list comes from the phone (sites only: no names of people are kept).
  const cached = load(SITES_KEY, null);
  const usable = cached && cached.tenant_id === state.me.tenant_id;
  if (s.error && !(state.offline && usable)) toast(friendly(s.error));
  if (p.error && !state.offline) toast(friendly(p.error));
  state.sites = s.data || (usable ? cached.sites : []);
  if (s.data) store(SITES_KEY, { tenant_id: state.me.tenant_id, sites: s.data.map(({ id, title, cost_center_code, status, timezone }) => ({ id, title, cost_center_code, status, timezone })) });
  state.people = p.data || [];
  if (state.offline) { state.docTypes = []; return; }
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
  if (state.offline && view !== 'picar') { toast('Sem rede: por agora só podes picar.'); view = 'picar'; }
  stopNfc(); clearInterval(state.timer);
  state.view = view;
  const tab = view === 'ficha' ? 'trabalhadores' : view;
  nav.querySelectorAll('button[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === tab));
  ({ picar: viewClock, naobra: viewOnSite, horas: viewHours, seguranca: viewSafety, trabalhadores: viewPeople,
     ficha: viewWorker, obras: viewSites, secretariado: viewOffice }[view] || viewClock)();
}

// ------------------------------------------------------------------ Picar
function viewClock() {
  const nfcOk = 'NDEFReader' in window;
  app.innerHTML = `<h1>Picar</h1>
    ${state.offline ? '<div class="result warn" style="font-size:16px"><b>Sem rede</b>Só podes picar. As picagens ficam guardadas neste telemóvel e são enviadas quando a rede voltar.</div>' : ''}
    <div id="clockwarn"></div>
    <div class="card">${siteSelect('site')}
      <div class="dir"><button class="auto" data-d="auto">AUTOMÁTICO</button>
      <button class="in" data-d="in">ENTRADA</button>
      <button class="out" data-d="out">SAÍDA</button></div>
      <p class="small muted" id="dirhelp"></p>
      ${nfcOk ? '<button class="btn" id="nfc" style="width:100%;padding:16px">Começar a ler cartões</button>'
              : '<p class="small muted">Este aparelho não lê cartões pelo browser (só o Chrome em Android lê). Usa o leitor USB ou escreve o número do cartão.</p>'}
      <form id="manual" class="row" style="margin-top:10px"><div><label>Número do cartão (ou leitor USB)</label>
        <input name="uid" autocomplete="off" placeholder="ex.: 04:A1:B2:C3"></div>
        <div style="flex:0 0 auto"><button class="btn ghost">Picar</button></div></form>
      <div id="result"></div><div id="taplog" class="taplog"></div><p id="queue" class="small muted"></p>
    </div>
    <div id="rejected"></div>
    <h2>Últimas picagens nesta obra</h2><div class="card" id="recent"><p class="muted">A carregar…</p></div>`;
  bindSiteSelect('site', loadRecent);
  app.querySelectorAll('.dir button').forEach((b) => b.onclick = () => {
    state.dirOverride = b.dataset.d === 'auto' ? null : b.dataset.d; renderDir();
  });
  $('#manual').onsubmit = (e) => {
    e.preventDefault(); const input = e.target.uid;
    if (normUid(input.value)) clock(input.value); input.value = ''; input.focus();
  };
  if (nfcOk) $('#nfc').onclick = toggleNfc;
  renderDir(); renderTapLog(); showQueue(); showRejected(); showClockWarn(); loadRecent();
}
// Automatic by default: the server knows if the person is inside. A forced ENTRADA or SAÍDA is for the next tap only.
function renderDir() {
  const d = state.dirOverride || 'auto';
  app.querySelectorAll('.dir button').forEach((x) => x.classList.toggle('on', x.dataset.d === d));
  const help = $('#dirhelp'); if (!help) return;
  help.textContent = d === 'auto' ? 'Automático: entra quem está fora e sai quem está dentro. Toca em ENTRADA ou SAÍDA só para forçar a próxima picagem.'
    : `A próxima picagem fica como ${d === 'in' ? 'ENTRADA' : 'SAÍDA'}. Depois volta ao automático.`;
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
      if (!uid) { beep(false); return showResult('bad', 'Cartão sem número', 'Este cartão não mostra o número. Usa outro tipo de cartão.'); }
      if (uid === last.uid && Date.now() - last.at < 3000) return;   // the same tap read twice
      last = { uid, at: Date.now() }; clock(uid);
    };
    // A failed read must never sound like a tap: error buzz and a red box (B2).
    reader.onreadingerror = () => { beep(false); showResult('bad', 'NÃO LIDO', 'Não consegui ler o cartão. Encosta outra vez, devagar.'); };
  } catch (err) {
    toast(err.name === 'NotAllowedError' ? 'Dá permissão ao NFC no Chrome.' : 'O NFC não arrancou: ' + err.message);
  }
}
function stopNfc() { if (state.nfc) { state.nfc.abort(); state.nfc = null; } }

// ---- the phone's clock: taps use the server's time (M5)
const serverNow = () => new Date(Date.now() + (state.clockOffset || 0));
async function syncClock() {
  try {
    const t0 = Date.now(); const { data, error } = await sb.rpc('mini_server_time'); const t1 = Date.now();
    if (error || !data || t1 - t0 > 10000) return;
    state.clockOffset = new Date(data).getTime() - (t0 + t1) / 2;
    store(CLOCK_KEY, { off: state.clockOffset, at: t1 });
    showClockWarn();
  } catch (_) { /* no network: keep the last known difference */ }
}
function showClockWarn() {
  const el = $('#clockwarn'); if (!el) return;
  const off = state.clockOffset || 0;
  el.innerHTML = Math.abs(off) > 120000 ? `<div class="result warn" style="font-size:16px"><b>Acerta a hora do telemóvel</b>
    O relógio deste telemóvel está ${Math.round(Math.abs(off) / 60000)} min ${off > 0 ? 'atrasado' : 'adiantado'}. As picagens usam a hora certa do servidor,
    mas acerta-o em Definições › Data e hora › Automática.</div>` : '';
}

// ---- direction: the server decides; without network, the last direction this phone saw for the card (M7)
function lastDirLocal(raw, at) {
  const m = load(LASTDIR_KEY, {}); const x = m[cardKey(raw)];
  return x && x.d === 'in' && at - x.t < 16 * 3600000 ? 'out' : 'in';
}
function rememberDir(raw, dir, at) {
  const m = load(LASTDIR_KEY, {}); const now = Date.now();
  for (const k of Object.keys(m)) if (now - m[k].t > 24 * 3600000) delete m[k];   // only the last day is useful
  m[cardKey(raw)] = { d: dir, t: at }; store(LASTDIR_KEY, m);
}
async function nextDirection(project, raw, at) {
  if (!state.offline && navigator.onLine !== false) {
    try {
      const { data, error } = await sb.rpc('mini_next_direction', { p_project: project, p_capture: 'card_on_supervisor_phone', p_raw: raw, p_at: at.toISOString() });
      if (!error && (data === 'in' || data === 'out')) return { dir: data };
    } catch (_) { /* falls back below */ }
  }
  return { dir: lastDirLocal(raw, at.getTime()), guessed: true };
}

async function clock(rawUid) {
  const site = currentSite(); if (!site) return toast('Escolhe uma obra.');
  const seq = ++state.tapSeq;
  const raw = normUid(rawUid); const at = serverNow();
  let dir = state.dirOverride; let guessed = false;
  state.dirOverride = null; renderDir();
  if (!dir) ({ dir, guessed } = await nextDirection(site.id, raw, at));
  const ev = { p_project: site.id, p_capture: 'card_on_supervisor_phone', p_raw: raw, p_direction: dir,
    p_event_time: at.toISOString(), p_client_event_id: uuid(), p_device_time: new Date().toISOString() };
  const word = dir === 'in' ? 'ENTRADA' : 'SAÍDA';   // always the direction that was sent (B1)
  const r = await sendEvent(ev);
  if (seq === state.tapSeq) state.resultId = ev.p_client_event_id;   // the box below now belongs to this tap
  if (r.notSaved) { showResult('bad', 'PICAGEM NÃO GUARDADA', `${word} do cartão …${raw.slice(-4)}: sem rede e o telemóvel não deixou guardar. Anota a hora e acrescenta-a depois como picagem esquecida.`, seq); beep(false); return; }
  if (r.authLost) { showResult('warn', 'Picagem guardada', `${word} guardada. A sessão terminou: entra outra vez e ela é enviada.`, seq); beep('neutral'); checkSession(); return; }
  if (r.queued) {
    rememberDir(raw, dir, at.getTime());
    // Not checked by anyone yet: a different sound and colour from "accepted" (A3). The verdict comes when it is sent.
    showResult('warn', `${word} NÃO VERIFICADA`, `Cartão …${raw.slice(-4)} guardado sem rede${guessed ? ' (sentido pela última picagem neste telemóvel)' : ''}. Vai ser enviado quando a rede voltar e o resultado aparece aqui.`, seq);
    beep('neutral'); return;
  }
  if (r.error) { showResult('bad', 'Erro', friendly(r.error), seq); beep(false); return; }
  const d = r.data; const who = d.name || 'Cartão ' + ev.p_raw;
  if (d.status === 'accepted') {
    rememberDir(raw, dir, at.getTime());
    showResult('ok', who, `${word} aceite`, seq); beep(true);
    if (dir === 'in' && d.collaborator_id) warnExpiring(d.collaborator_id, who, word, seq);
  } else if (d.status === 'duplicate') { showResult('warn', who, `Já picou há instantes (${word})`, seq); beep(true); }
  else { showResult('bad', `${who}: NÃO ENTRA`, (d.reasons || []).map(reasonText).join(' · '), seq); beep(false); }
  loadRecent();
}
// After an accepted entry: say which documents are about to expire (the entry itself is never held up by this).
// Only if the screen still shows this tap: a slow answer never covers the result of the next person (A5).
async function warnExpiring(collabId, who, word, seq) {
  const { data, error } = await sb.rpc('mini_worker_documents', { p_collab: collabId });
  if (error || !data) return;
  const soon = data.filter((x) => x.state === 'a_caducar');
  if (!soon.length) return;
  const note = 'Atenção: ' + soon.map((x) => `${x.name} caduca ${x.days_left === 0 ? 'hoje' : `daqui a ${x.days_left} dia(s)`}`).join(' · ');
  const line = state.tapLog.find((x) => x.seq === seq); if (line) { line.note = note; renderTapLog(); }
  if (seq !== state.tapSeq) return;
  const el = $('#result'); if (!el) return;
  el.innerHTML = `<div class="result warn"><b>${esc(who)}</b>${esc(word)} aceite<div class="small" style="margin-top:6px">${esc(note)}</div></div>`;
}

// ---- the offline queue (C2): each tap has its own id; items leave the queue one by one, by id, only when the server answered.
// A tap the server refuses is moved to the "refused" list with the reason, never thrown away.
const queue = () => load(QUEUE_KEY, []);
function enqueue(item) {
  const q = queue(); q.push(item);
  return store(QUEUE_KEY, q) && queue().some((x) => x.p_client_event_id === item.p_client_event_id);
}
function dequeue(id) { const q = queue().filter((x) => x.p_client_event_id !== id); return store(QUEUE_KEY, q.length ? q : undefined); }
function addRejected(item, reason, name) {
  const list = load(REJECTED_KEY, []);
  if (list.some((x) => x.id === item.p_client_event_id)) return true;
  list.push({ id: item.p_client_event_id, at: item.p_event_time, dir: item.p_direction, project: item.p_project, uid: item.p_raw,
    name: name || null, collab: item._collab || null, reason, _u: item._u || null, _e: item._e || null, seen: new Date().toISOString() });
  return store(REJECTED_KEY, list);
}
// What to do with an answer: 'ok' (the server decided), 'retry' (no network, server down, login to renew) or 'refused'.
async function verdict(r) {
  if (!r.error) return 'ok';
  const msg = r.error.message || String(r.error);
  if (isNetErr(r.error, r.status) || r.status >= 500 || r.status === 408 || r.status === 429) return 'retry';
  if (r.status === 401 || /JWT|not authenticated/i.test(msg)) return 'retry';
  if (AUTH_LOST.test(msg) && await sessionGone()) return 'retry';
  return 'refused';
}
async function sendEvent(ev) {
  let r;
  try { r = await sb.rpc('clock_event', ev); } catch (e) { r = { error: e, status: 0 }; }
  const v = await verdict(r);
  if (v === 'ok') return { data: r.data };
  if (v === 'refused') return { error: r.error };
  // Never lose a tap because of the network or the login: keep it and send it later (after the next login if needed).
  const lost = AUTH_LOST.test((r.error && r.error.message) || '') && await sessionGone();
  const ok = enqueue({ ...ev, p_was_offline: true, _u: state.me && state.me.user_id, _e: state.me && state.me.email });
  showQueue();
  if (!ok) return { notSaved: true };
  return lost ? { authLost: true } : { queued: true };
}
let flushing = null;
function flushQueue() {   // one at a time: a second call waits for the running one
  if (!flushing) flushing = doFlush().finally(() => { flushing = null; });
  return flushing;
}
async function doFlush() {
  if (!state.ready || !state.me || state.offline) return;   // only send saved taps when logged in, or they would be refused
  // A tap saved under another login waits for that person: never sent with someone else's account (M6).
  const mine = queue().filter((x) => !x._u || x._u === state.me.user_id);
  if (!mine.length) { showQueue(); return; }
  let accepted = 0; let refused = 0; let kept = 0;
  for (const item of mine) {
    const { _u, _e, _collab, ...ev } = item; void _u; void _e; void _collab;
    let r;
    try { r = await sb.rpc('clock_event', ev); } catch (e) { r = { error: e, status: 0 }; }
    const v = await verdict(r);
    if (v === 'retry') { kept = queue().filter((x) => !x._u || x._u === state.me.user_id).length; break; }   // still no network: try later
    const word = ev.p_direction === 'in' ? 'ENTRADA' : 'SAÍDA';
    const when = fmtTime(ev.p_event_time, siteTz(ev.p_project));
    if (v === 'refused') {
      // Saved in the refused list first, then taken out of the queue: never lost in between.
      if (!addRejected(item, friendly(r.error))) { kept++; continue; }
      refused++; logTap('bad', `Cartão …${String(ev.p_raw).slice(-4)}: ${word} de ${when} recusada`, friendly(r.error));
      verdictBox(ev, 'bad', `${word} RECUSADA`, friendly(r.error));
    } else {
      const d = r.data || {}; const who = d.name || `Cartão …${String(ev.p_raw).slice(-4)}`;
      if (d.status === 'rejected') {
        if (!addRejected({ ...item, _collab: d.collaborator_id }, (d.reasons || []).map(reasonText).join(' · ') || 'recusada', d.name)) { kept++; continue; }
        refused++; logTap('bad', `${who}: ${word} de ${when} NÃO ENTROU`, (d.reasons || []).map(reasonText).join(' · '));
        verdictBox(ev, 'bad', `${who}: NÃO ENTRA`, (d.reasons || []).map(reasonText).join(' · ') + ' (verificado agora, ao enviar)');
      } else {
        accepted++; logTap(d.status === 'duplicate' ? 'warn' : 'ok', `${who}: ${word} de ${when} ${d.status === 'duplicate' ? 'repetida' : 'aceite'}`, 'enviada depois (estava sem rede)');
        verdictBox(ev, d.status === 'duplicate' ? 'warn' : 'ok', who, `${word} de ${when} ${d.status === 'duplicate' ? 'repetida' : 'aceite'} (enviada agora)`);
      }
    }
    dequeue(ev.p_client_event_id);
  }
  showQueue(); showRejected();
  if (accepted || refused) {
    // The server's verdict on the saved taps, shown where the supervisor looks (A3).
    toast(`Picagens guardadas enviadas: ${accepted} aceite(s)${refused ? `, ${refused} recusada(s): vê a lista no ecrã Picar` : ''}.`);
    if (refused) beep(false);
    loadRecent();
  } else if (kept) showQueue();
}
function showQueue() {
  const el = $('#queue'); if (!el) return;
  const q = queue(); const me = state.me && state.me.user_id;
  const mine = q.filter((x) => !x._u || x._u === me).length; const other = q.filter((x) => x._u && x._u !== me);
  const accounts = [...new Set(other.map((x) => x._e || 'outra conta'))].join(', ');
  el.innerHTML = [mine ? `<span class="pill warn">${mine} picagem(ns) à espera de rede</span>${navigator.onLine !== false && !state.offline ? ' <button class="btn ghost small" id="flushNow">Enviar agora</button>' : ''}` : '',
    other.length ? `<span class="pill warn">${other.length} picagem(ns) de outra conta (${esc(accounts)}), ainda não enviadas</span> Só são enviadas quando essa pessoa voltar a entrar neste telemóvel.` : '']
    .filter(Boolean).join('<br>');
  const b = $('#flushNow'); if (b) b.onclick = () => flushQueue();
}
// The taps the server refused after the network came back: who, when, why, and what to do (C2, A3).
function showRejected() {
  const el = $('#rejected'); if (!el) return;
  const me = state.me && state.me.user_id;
  const list = load(REJECTED_KEY, []).filter((x) => !x._u || x._u === me);
  if (!list.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<h2>Picagens recusadas depois de enviadas (${list.length})</h2><div class="card">
    <p class="small muted">Estas picagens foram feitas sem rede e o servidor recusou-as quando a rede voltou. Ficam aqui até as tratares:
      se a pessoa trabalhou mesmo, acrescenta a picagem à mão (com o motivo).</p>
    <table><tr><th>Quando</th><th>Quem</th><th>Porquê</th><th></th></tr>${list.map((x) => `<tr>
      <td>${esc(fmtTime(x.at, siteTz(x.project)))}<div class="small muted">${x.dir === 'in' ? 'Entrada' : 'Saída'} · ${esc((state.sites.find((s) => s.id === x.project) || {}).cost_center_code || '')}</div></td>
      <td>${esc(x.name || 'Cartão …' + String(x.uid || '').slice(-4))}</td><td>${esc(x.reason)}</td>
      <td><button class="btn small ghost" data-addrej="${esc(x.id)}">Acrescentar à mão</button>
        <button class="btn small ghost" data-donerej="${esc(x.id)}">Já tratei</button></td></tr>`).join('')}</table></div>`;
  el.querySelectorAll('[data-addrej]').forEach((b) => b.onclick = () => {
    const x = list.find((y) => y.id === b.dataset.addrej); if (!x) return;
    store(SITE_KEY, x.project);
    state.prefill = { who: x.collab, dir: x.dir, at: localInput(x.at, siteTz(x.project)), why: `Picagem sem rede recusada ao enviar (${x.reason}). ` };
    state.weekStart = monday(new Date(localDay(x.at, siteTz(x.project)) + 'T12:00:00'));
    go('horas');
  });
  el.querySelectorAll('[data-donerej]').forEach((b) => b.onclick = () => {
    if (!confirm('Tirar esta picagem da lista? Faz isto só depois de a teres acrescentado à mão ou confirmado que não conta.')) return;
    store(REJECTED_KEY, load(REJECTED_KEY, []).filter((y) => y.id !== b.dataset.donerej)); showRejected();
  });
}
// The big box shows the newest tap only; every tap also gets a line in the list below it.
function logTap(kind, title, text, seq) {
  state.tapLog.unshift({ kind, title, text, seq, at: new Date() });
  state.tapLog = state.tapLog.slice(0, 6); renderTapLog();
}
function renderTapLog() {
  const el = $('#taplog'); if (!el) return;
  el.innerHTML = state.tapLog.map((x) => `<div class="tl ${x.kind}"><span class="small muted">${esc(x.at.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit', second: '2-digit' }))}</span>
    <b>${esc(x.title)}</b> ${esc(x.text || '')}${x.note ? ` <span class="small">${esc(x.note)}</span>` : ''}</div>`).join('');
}
// The big box still shows a tap that was waiting for the network: replace "NÃO VERIFICADA" with the server's verdict.
function verdictBox(ev, kind, title, text) { if (state.resultId === ev.p_client_event_id) showResult(kind, title, text); }
function showResult(kind, title, text, seq) {
  if (seq !== undefined) logTap(kind, title, text, seq);
  if (seq !== undefined && seq !== state.tapSeq) return;   // an older tap answering late: only its line in the list
  const el = $('#result'); if (!el) return toast(title + ': ' + text);
  el.innerHTML = `<div class="result ${kind}"><b>${esc(title)}</b>${esc(text)}</div>`;
}
async function loadRecent() {
  const el = $('#recent'); const site = currentSite(); if (!el) return;
  if (!site) { el.innerHTML = '<p class="muted">Sem obra.</p>'; return; }
  if (state.offline) { el.innerHTML = '<p class="muted">Sem rede: as últimas picagens aparecem quando a rede voltar.</p>'; return; }
  const { data, error } = await core().from('time_events')
    .select('id, event_time, direction, status, reasons, collaborator_id, raw_uid')
    .eq('project_id', site.id).order('event_time', { ascending: false }).limit(15);
  if (error) { el.innerHTML = `<p class="muted">${esc(friendly(error))}</p>`; return; }
  if (!data.length) { el.innerHTML = '<p class="muted">Ainda não há picagens.</p>'; return; }
  const name = (id) => (state.people.find((p) => p.id === id) || {}).full_name;
  el.innerHTML = `<p class="small muted">Horas: ${esc(tzName(site.timezone || DEFAULT_TZ))}.</p><table><tr><th>Hora</th><th>Quem</th><th></th><th>Resultado</th></tr>${data.map((e) => `<tr>
    <td>${esc(fmtTime(e.event_time, site.timezone))}</td><td>${esc(name(e.collaborator_id) || 'Cartão ' + (e.raw_uid || '?'))}</td>
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
      <td>${esc(r.full_name)}</td><td>${esc(r.employee_number || '')}</td><td>${esc(r.organization)}</td><td>${esc(fmtTime(r.since, site.timezone))}</td></tr>`).join('')}</table>` : ''}`;
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
      <p class="small muted">Copia as datas do papel e tira uma foto ao documento (ou escolhe o PDF). Sem estes dois válidos, a pessoa não entra na obra. Se ainda não os tens, deixa em branco e regista depois na ficha.</p>
      ${state.docTypes.filter((t) => t.is_blocking).map((t) => `<fieldset class="doc" data-type="${esc(t.id)}"><legend>${esc(t.name)}</legend>
        <div class="row"><div><label>Data de emissão</label><input name="i_${esc(t.id)}" type="date" max="${isoDay(new Date())}"></div>
        <div><label>Válido até (vazio = não caduca)</label><input name="e_${esc(t.id)}" type="date"></div></div>
        <label>Foto ou PDF do documento</label><input name="f_${esc(t.id)}" type="file" accept="${FILE_ACCEPT}"></fieldset>`).join('')}
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
        name: fs.querySelector('legend').textContent, issue: f.get('i_' + fs.dataset.type), expiry: f.get('e_' + fs.dataset.type),
        file: fs.querySelector('input[type=file]').files[0] }));
      const half = docs.find((d) => !d.issue && (d.expiry || d.file));
      if (half) return toast(`${half.name}: falta a data de emissão.`);
      for (const d of docs.filter((x) => x.issue)) { const bad = fileProblem(d.file); if (bad) return toast(`${d.name}: ${bad}`); }
      const nif = String(f.get('nif') || '').replace(/\s/g, '');
      const dup = await findByNif(nif);
      if (dup) return offerExisting(dup);
      const btn = e.target.querySelector('.btn:not(.ghost)'); btn.disabled = true;
      const notes = String(f.get('notes') || '').trim();
      const { data, error } = await sb.rpc('mini_add_worker', {
        p_full_name: f.get('name'), p_tax_number: nif, p_employee_number: f.get('num'),
        p_card_uid: normUid(f.get('card')), p_project: $('#site') ? $('#site').value : null,
        p_statement: 'Identificação e contrato vistos em papel.' + (notes ? ' ' + notes : ''), p_job_title: f.get('job') });
      if (error) {
        btn.disabled = false;
        if (/tax_number/i.test(error.message || '')) { const d2 = await findByNif(nif); if (d2) return offerExisting(d2); }
        return toast(friendly(error));
      }
      let failed = 0;
      for (const d of docs.filter((x) => x.issue)) {
        const r = await addDocument(data, d.type, d.issue, d.expiry, null, d.file);
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
  const [ws, ds, us, fs] = await Promise.all([sb.rpc('mini_workers'), sb.rpc('mini_worker_documents', { p_collab: id }),
    isAdmin() ? sb.rpc('mini_app_users') : Promise.resolve({ data: [] }),
    canDocs() ? sb.rpc('mini_document_files', { p_collab: id }) : Promise.resolve({ data: [] })]);
  const files = (fs && fs.data) || [];
  const current = (typeId) => files.find((x) => x.type_id === typeId && x.is_current);
  const older = files.filter((x) => !x.is_current);
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
        <td>${docState(d)}${canDocs() && d.issue_date ? (current(d.type_id) && current(d.type_id).file_path
          ? `<div><button class="btn small ghost" data-file="${esc(current(d.type_id).file_path)}">Ver comprovativo</button></div>`
          : '<div><span class="pill warn">sem comprovativo</span></div>') : ''}</td></tr>`).join('')}</table>
      ${canDocs() && older.length ? `<details><summary class="small">Versões antigas (${older.length})</summary>
        <table>${older.map((x) => `<tr><td>${esc(x.type_name)}<div class="small muted">registado ${esc(fmtDate(x.registered_at))}${x.registered_by ? ' por ' + esc(x.registered_by) : ''}</div></td>
          <td>${x.expiration_date ? 'até ' + esc(fmtDate(x.expiration_date)) : 'sem validade'}</td>
          <td>${x.file_path ? `<button class="btn small ghost" data-file="${esc(x.file_path)}">Ver</button>` : '<span class="small muted">só em papel</span>'}</td></tr>`).join('')}</table></details>` : ''}
      ${canDocs() ? `<h2>Registar ou renovar</h2>
      <form id="doc"><label>Documento *</label><select name="type" required><option value="">Escolhe o documento…</option>${ds.data.map((d) => `<option value="${esc(d.type_id)}">${esc(d.name)}</option>`).join('')}</select>
        <div class="row"><div><label>Data de emissão *</label><input name="issue" type="date" required max="${isoDay(new Date())}"></div>
        <div><label>Válido até (vazio = não caduca)</label><input name="expiry" type="date"></div></div>
        <label>Número (opcional)</label><input name="num">
        <label>Foto ou PDF do documento *</label><input name="file" type="file" accept="${FILE_ACCEPT}" required>
        <p class="small muted">Tira uma foto nítida ao documento ou escolhe o PDF (até 10 MB). Fica guardado em privado, nunca se apaga,
          e só o administrador, o RH e a segurança o podem abrir. Fica escrito que foste tu a verificar, e quando.</p>
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
      <p>${esc(login.email)} · ${esc(ROLE_NAMES[login.role] || login.role)} ·
        ${login.is_active ? '<span class="pill ok">ligada</span>' : '<span class="pill">desligada</span>'}</p>
      <p><button class="btn ghost" id="toggleLogin">${login.is_active ? 'Desligar a conta' : 'Ligar a conta'}</button></p>` : w.is_active ? `
      <p class="small muted">Dá a esta pessoa acesso à app para picar, ver quem está na obra e validar horas.</p>
      <form id="login"><label>Email *</label><input name="email" type="email" required autocomplete="off">
        <label>Papel</label><select name="role"><option value="supervisor">Encarregado</option><option value="hse">Técnico de segurança</option><option value="hr">Secretariado / RH</option></select>
        <p class="small muted">O secretariado vê os NIFs, os documentos e as horas de todas as obras, e tem de usar a app de códigos.</p>
        <p><button class="btn">Criar conta</button></p></form><div id="newpw"></div>` : '<p class="muted">Pessoa inativa: sem conta.</p>'}</div>` : ''}
    ${canPeople() ? `<div class="card"><h2 style="margin-top:0">${w.is_active ? 'Desativar' : 'Reativar'}</h2>
      <form id="act"><label>Porquê? *</label><input name="why" required placeholder="${w.is_active ? 'ex.: terminou o contrato' : 'ex.: voltou a ser contratado'}">
      <p class="small muted">${w.is_active ? 'Deixa de poder entrar em qualquer obra e o cartão é anulado. O histórico fica guardado.' : 'Depois de reativar, dá-lhe um cartão.'}</p>
      <p><button class="btn ${w.is_active ? 'danger' : ''}">${w.is_active ? 'Desativar' : 'Reativar'}</button></p></form></div>` : ''}`;
  if ($('#doc')) $('#doc').onsubmit = async (e) => {
    e.preventDefault(); const f = new FormData(e.target); const btn = e.target.querySelector('.btn'); btn.disabled = true;
    btn.textContent = 'A enviar…';
    const { error } = await addDocument(id, f.get('type'), f.get('issue'), f.get('expiry'), f.get('num'), f.get('file'));
    btn.disabled = false; btn.textContent = 'Guardar documento';
    if (error) return toast(friendly(error));
    toast('Documento guardado com o comprovativo.'); viewWorker();
  };
  app.querySelectorAll('[data-file]').forEach((b) => b.onclick = () => openDocFile(b.dataset.file));
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

// Who already has this NIF? Only admin and HR can ask: the NIF is never sent to the app in lists.
async function findByNif(nif) {
  if (!nif) return null;
  const { data } = await sb.rpc('mini_find_by_nif', { p_nif: nif });
  return data && data[0] ? { id: data[0].collaborator_id, full_name: data[0].full_name } : null;
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
    ${canDocs() ? '<p class="small muted noprint">Toca numa pessoa para registar o documento.</p>' : ''}`;
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
  const site = currentSite(); const tz = site ? siteTz(site.id) : DEFAULT_TZ;
  app.innerHTML = `<h1>Mapa de horas</h1>
    <div class="card"><div class="noprint">${siteSelect('site')}</div>
      <div class="row noprint" style="margin-top:10px"><div style="flex:0 0 auto"><button class="btn ghost" id="prev">‹ Semana anterior</button></div>
        <div style="flex:0 0 auto"><button class="btn ghost" id="next">Semana seguinte ›</button></div></div>
      <p><b>Semana de ${esc(fmtDate(isoDay(from)))} a ${esc(fmtDate(isoDay(to)))}</b> <span class="small muted">· ${esc(tzName(tz))}</span></p>
      <div id="list"><p class="muted">A carregar…</p></div>
      <p class="noprint"><button class="btn" id="all" hidden>Validar todos os dias sem problemas</button>
        <button class="btn ghost" id="print">Imprimir</button></p></div>
    <div class="card noprint" id="fix" hidden></div>
    <div class="card noprint"><h2 style="margin-top:0">Picagem esquecida</h2>
      <form id="miss"><label>Trabalhador</label><select name="who" id="who"></select>
        <div class="row"><div><label>Entrada ou saída</label><select name="dir"><option value="in">Entrada</option><option value="out">Saída</option></select></div>
        <div><label>Dia e hora * <span class="small">(${esc(tzName(tz))})</span></label><input name="at" type="datetime-local" required></div></div>
        <label>Porquê? *</label><input name="why" required placeholder="ex.: esqueceu-se de picar à saída, confirmado por mim">
        <p class="small muted">Escreve a hora como se vê no relógio da obra. Fica marcada como acrescentada à mão, com o teu nome e o motivo.
          Não podes acrescentar picagens a ti próprio. Uma entrada só é aceite se a pessoa podia entrar a essa hora (ativa, com os documentos).</p>
        <p><button class="btn">Acrescentar</button></p></form></div>`;
  bindSiteSelect('site', viewHours);
  $('#prev').onclick = () => { state.weekStart.setDate(state.weekStart.getDate() - 7); viewHours(); };
  $('#next').onclick = () => { state.weekStart.setDate(state.weekStart.getDate() + 7); viewHours(); };
  $('#print').onclick = () => window.print();
  $('#miss').onsubmit = async (e) => {
    e.preventDefault(); const f = new FormData(e.target); const s = currentSite(); if (!s) return;
    if (!f.get('who')) return toast('Escolhe o trabalhador.');
    // The time typed is the site's time (A6): 08:00 in a Madrid site is 08:00 in Madrid, whatever the phone's zone.
    const at = zonedToUtc(String(f.get('at') || ''), siteTz(s.id)); if (!at) return toast('Escreve o dia e a hora.');
    const { error } = await sb.rpc('mini_add_missed_tap', { p_collab: f.get('who'), p_project: s.id, p_direction: f.get('dir'),
      p_time: at, p_reason: f.get('why') });
    if (error) return toast(friendly(error));
    toast('Picagem acrescentada.'); viewHours();
  };
  const pre = state.prefill; state.prefill = null;
  loadHours(isoDay(from), isoDay(to)).then((rows) => fillWorkerSelect(rows || []).then(() => {
    if (!pre) return;
    const f = $('#miss'); if (!f) return;
    if (pre.who) setWorker(pre.who, pre.name); f.dir.value = pre.dir; f.at.value = pre.at; f.why.value = pre.why || '';
    f.scrollIntoView({ behavior: 'smooth' });
  }));
}
// Everyone on the site today, plus whoever has hours this week (someone who left the site or was deactivated
// still needs their days corrected, M8).
async function fillWorkerSelect(rows) {
  const sel = document.getElementById('who'); const site = currentSite(); if (!sel || !site) return;
  const { data } = await sb.rpc('mini_workers');
  const list = (data || []).filter((w) => w.is_active && w.site_ids.includes(site.id)).map((w) => ({ id: w.collaborator_id, name: w.full_name }));
  for (const r of rows) if (!list.some((x) => x.id === r.collaborator_id)) list.push({ id: r.collaborator_id, name: r.full_name + ' (já não está na obra)' });
  if (!document.getElementById('who')) return;
  const keep = sel.value; const keepName = keep && sel.selectedOptions[0] ? sel.selectedOptions[0].textContent : '';
  sel.innerHTML = list.length ? '<option value="">Escolhe…</option>' + list.map((w) => `<option value="${esc(w.id)}">${esc(w.name)}</option>`).join('')
    : '<option value="">Ninguém atribuído a esta obra</option>';
  if (keep) setWorker(keep, keepName);   // a day being corrected keeps its person
}
function setWorker(id, name) {
  const sel = document.getElementById('who'); if (!sel) return;
  if (![...sel.options].some((o) => o.value === id)) sel.add(new Option(name || 'Trabalhador', id));
  sel.value = id;
}
// One period: entry and exit in their columns. Several: each period on its own line across both columns.
function inOutCells(r, periods, tz) {
  const list = periodList(periods);
  if (list.length > 1) return `<td colspan="2">${list.map((p) => `<div>${esc(p)}</div>`).join('')}<div class="small muted">${list.length} períodos</div></td>`;
  if (list.length === 1) { const [a, b] = list[0].split('–'); return `<td>${esc(a)}</td><td>${esc(b)}</td>`; }
  return `<td>${esc(fmtHour(r.first_in, tz))}</td><td>${esc(fmtHour(r.last_out, tz))}</td>`;
}
const DAY_STATUS = { registered: '<span class="pill">por validar</span>', supervisor_validated: '<span class="pill ok">validado</span>',
  hr_validated: '<span class="pill ok">validado RH</span>', sent_to_payroll: '<span class="pill ok">salários</span>' };
let hoursSeq = 0;
async function loadHours(from, to) {
  const el = $('#list'); const site = currentSite(); if (!el) return [];
  if (!site) { el.innerHTML = ''; return []; }
  const seq = ++hoursSeq; const tz = siteTz(site.id);
  const [{ data, error }, back, per] = await Promise.all([sb.rpc('mini_hours', { p_project: site.id, p_from: from, p_to: to }),
    sb.rpc('mini_returned_days', { p_project: site.id, p_from: from, p_to: to }), dayPeriods(from, to, site.id)]);
  if (seq !== hoursSeq || !$('#list')) return [];   // a newer week or site was asked meanwhile
  if (error) { el.innerHTML = `<p>${esc(friendly(error))}</p>`; return []; }
  const returned = Object.fromEntries(((back && back.data) || []).map((b) => [b.work_day_id, b.reason]));
  if (!data.length) { el.innerHTML = '<p class="muted">Sem horas nesta semana.</p>'; return []; }
  const byWorker = {};
  for (const r of data) (byWorker[r.collaborator_id] = byWorker[r.collaborator_id] || []).push(r);
  const me = state.me && state.me.collaborator_id;
  const day = (r) => esc(new Date(r.shift_date + 'T12:00:00').toLocaleDateString('pt-PT', { weekday: 'short', day: '2-digit', month: '2-digit' }));
  const fixBtn = (r, label, cls) => `<button class="btn ${cls} small" data-${label === 'Corrigir' ? 'fix' : 'taps'}="${esc(r.collaborator_id)}" data-day="${esc(r.shift_date)}" data-name="${esc(r.full_name)}">${label}</button>`;
  el.innerHTML = Object.values(byWorker).map((rows) => {
    const tot = rows.reduce((a, r) => ({ w: a.w + r.worked_minutes, o: a.o + r.overtime_minutes }), { w: 0, o: 0 });
    return `<h2>${esc(rows[0].full_name)} <span class="small muted">${esc(rows[0].employee_number || '')}</span></h2>
    <table><tr><th>Dia</th><th>Entrada</th><th>Saída</th><th>Horas</th><th>Estado</th></tr>${rows.map((r) => `<tr>
      <td>${day(r)}</td>
      ${inOutCells(r, per[r.work_day_id], tz)}
      <td>${esc(fmtMin(r.worked_minutes))}${r.overtime_minutes ? `<div class="small">${esc(fmtMin(r.overtime_minutes))} extra${r.overtime_approved === false ? ' (recusadas)' : ''}</div>` : ''}
        ${r.has_manual ? '<div class="small muted">tem picagem à mão</div>' : ''}</td>
      <td>${r.anomalies.length ? `<span class="pill ${onlyOpenToday(r, tz) ? 'warn' : 'bad'}">${esc(r.anomalies.map((a) => anomalyText(a, r.shift_date, tz)).join(', '))}</span>` : DAY_STATUS[r.status] || esc(r.status)}
        ${returned[r.work_day_id] ? `<div class="small"><span class="pill warn">devolvido pelo secretariado</span> ${esc(returned[r.work_day_id])}</div>` : ''}
        ${['registered', 'supervisor_validated'].includes(r.status) && r.collaborator_id !== me ? `<div class="noprint" style="margin-top:4px">${r.status !== 'registered' ? fixBtn(r, 'Picagens', 'ghost')
          : onlyOpenToday(r, tz) ? fixBtn(r, 'Picagens', 'ghost')
          : r.anomalies.length ? fixBtn(r, 'Corrigir', 'ghost')
          : (r.overtime_minutes ? `<button class="btn small" data-ok="${esc(r.work_day_id)}" data-ot="1">Validar com extra</button>
              <button class="btn ghost small" data-ok="${esc(r.work_day_id)}" data-ot="0">Sem extra</button>`
          : `<button class="btn small" data-ok="${esc(r.work_day_id)}">Validar</button>`) + ' ' + fixBtn(r, 'Picagens', 'ghost')}</div>` : ''}</td></tr>`).join('')}
      <tr><td colspan="3"><b>Total da semana</b></td><td colspan="2"><b>${esc(fmtMin(tot.w))}</b>${tot.o ? ` <span class="small">(${esc(fmtMin(tot.o))} extra)</span>` : ''}</td></tr></table>`;
  }).join('') + '<p class="small muted print-only">Assinatura do encarregado: ______________________</p>';
  // Bulk validation only for plain days: no problem, no overtime, not one's own, and never a day the office sent back (M4).
  const easy = data.filter((r) => r.status === 'registered' && !r.anomalies.length && !r.overtime_minutes && r.collaborator_id !== me && !returned[r.work_day_id]);
  const all = $('#all'); if (all) { all.hidden = !easy.length; all.onclick = () => validate(easy.map((r) => r.work_day_id), null); }
  el.querySelectorAll('button[data-ok]').forEach((b) => b.onclick = () =>
    validate([b.dataset.ok], b.dataset.ot === undefined ? null : b.dataset.ot === '1'));
  el.querySelectorAll('button[data-fix], button[data-taps]').forEach((b) => b.onclick = () => fixDay(b.dataset.fix || b.dataset.taps, b.dataset.day, b.dataset.name));
  return data;
}
async function validate(ids, overtime) {
  const { data, error } = await sb.rpc('advance_work_days', { p_ids: ids, p_to: 'supervisor_validated', p_overtime_approved: overtime });
  if (error) return toast(friendly(error));
  toast(`${data} dia(s) validado(s).`); viewHours();
}
// The taps of the day (and the days around it), each one with "Anular"; and the form pointed at the missing one (M8, A2).
async function fixDay(collabId, day, name) {
  const site = currentSite(); if (!site) return; const tz = siteTz(site.id);
  const { data, error } = await sb.rpc('mini_day_events', { p_collab: collabId, p_project: site.id, p_day: day });
  if (error) return toast(friendly(error));
  const taps = data || [];
  const box = $('#fix'); if (!box) return;
  box.hidden = false;
  box.innerHTML = `<h2 style="margin-top:0">Picagens de ${esc(name || '')}, ${esc(fmtDate(day))}</h2>
    <p class="small muted">Inclui o dia antes e o dia depois. Horas: ${esc(tzName(tz))}. Uma picagem errada (por exemplo uma ENTRADA picada em vez de SAÍDA)
      anula-se aqui, com o motivo: fica no registo como anulada e as horas são recalculadas.</p>
    ${taps.length ? `<table><tr><th>Dia e hora</th><th></th><th></th></tr>${taps.map((e) => `<tr${localDay(e.effective_time, tz) === day ? '' : ' class="muted"'}>
      <td>${esc(fmtTime(e.effective_time, tz))}</td>
      <td>${e.direction === 'in' ? 'Entrada' : e.direction === 'out' ? 'Saída' : esc(e.direction)}${e.manual ? `<div class="small muted">à mão: ${esc(e.manual_reason || '')}</div>` : ''}</td>
      <td><button class="btn small ghost" data-void="${esc(e.event_id)}">Anular</button></td></tr>`).join('')}</table>` : '<p class="muted">Sem picagens.</p>'}
    <p><button class="btn ghost small" id="fixclose">Fechar</button></p>`;
  $('#fixclose').onclick = () => { box.hidden = true; };
  box.querySelectorAll('button[data-void]').forEach((b) => b.onclick = () => voidTap(b.dataset.void, collabId, day, name));
  const f = $('#miss'); setWorker(collabId, name);
  // The site's date, not the UTC one: a Madrid night-shift entry at 00:30 belongs to its own day (B3).
  const hasIn = taps.some((e) => e.direction === 'in' && localDay(e.effective_time, tz) === day);
  f.dir.value = hasIn ? 'out' : 'in';
  f.at.value = day + (hasIn ? 'T17:00' : 'T08:00');
  box.scrollIntoView({ behavior: 'smooth' });
}
async function voidTap(eventId, collabId, day, name) {
  const why = prompt('Porque é que anulas esta picagem? (pelo menos 10 letras; fica no registo com o teu nome)');
  if (why === null) return;
  if (String(why).trim().length < 10) return toast('Escreve o motivo (pelo menos 10 letras).');
  const { error } = await sb.rpc('mini_void_tap', { p_event: eventId, p_reason: String(why).trim() });
  if (error) return toast(friendly(error));
  toast('Picagem anulada. As horas do dia foram recalculadas.');
  viewHours(); fixDay(collabId, day, name);
}

// ------------------------------------------------------------------ Secretariado (RH): todas as obras, aprovar, fechar o mês
// The site validates, the office approves or sends a day back, and closes the month for payroll.
// After closing, nobody can change those days (the database refuses).
const OFFICE_STATUS = { registered: '<span class="pill warn">na obra: por validar</span>',
  supervisor_validated: '<span class="pill">validado na obra</span>', hr_validated: '<span class="pill ok">aprovado</span>',
  sent_to_payroll: '<span class="pill ok">fechado: salários</span>' };
function monthRange(ym) {
  const [y, m] = ym.split('-').map(Number);
  return { from: `${ym}-01`, to: isoDay(new Date(y, m, 0, 12)) };
}
function viewOffice() {
  if (!canPeople()) return viewClock();   // code guard as well as the database's
  if (!state.officeMonth) state.officeMonth = isoDay(new Date()).slice(0, 7);
  const { from, to } = monthRange(state.officeMonth);
  const sites = state.sites;
  app.innerHTML = `<h1>Secretariado</h1>
    <div class="card noprint"><div class="row"><div><label>Mês</label><input type="month" id="month" value="${esc(state.officeMonth)}"></div></div>
      <p class="small muted">Todas as obras. O encarregado valida na obra, tu aprovas aqui, e no fim do mês fechas para os salários.
        Olha com atenção para as picagens marcadas «à mão», «sem rede, chegou tarde» e «próprio cartão».</p>
      <div id="sum"></div></div>
    <div class="card" id="list"><p class="muted">A carregar…</p></div>
    <div class="card noprint"><h2 style="margin-top:0">Salários</h2>
      <p class="small muted">A folha tem uma linha por pessoa e obra, com as horas normais, as extra aprovadas, as noturnas e as de descanso ou feriado, mais um resumo por pessoa. Abre no Excel, no Google Sheets ou no telemóvel.</p>
      <p><button class="btn ghost" id="sheet">Descarregar a folha do mês (Excel)</button></p>
      <p><button class="btn ghost" id="prim">Ficheiro para o Primavera (Relógio de Ponto)</button></p>
      <p class="small muted">Horas extra aprovadas, uma linha por pessoa, dia e tipo (1.ª hora, seguintes, descanso, feriado, e os mesmos acima das 100 h do ano). As noturnas não vão neste ficheiro. No Primavera: Recursos Humanos › Alterações Mensais › Relógio de Ponto. O "Nº de trabalhador" tem de ser o número do funcionário no Primavera.</p>
      <details id="primcfg"><summary>Configurar o ficheiro do Primavera</summary><div id="primform"><p class="muted">A carregar…</p></div></details>
      <div id="close"></div></div>
    <div class="card noprint"><h2 style="margin-top:0">Registo de tempos (ACT)</h2>
      <p class="small muted">O registo legal das entradas e saídas de uma obra (Código do Trabalho, art. 202). Guarda-o 5 anos e mostra-o se a inspeção pedir.</p>
      <label>Obra</label><select id="actsite">${sites.map((s) => `<option value="${esc(s.id)}">${esc(s.title)} (${esc(s.cost_center_code)})</option>`).join('')}</select>
      <p><button class="btn ghost" id="act">Descarregar o registo do mês (Excel)</button></p></div>`;
  $('#month').onchange = (e) => { if (e.target.value) { state.officeMonth = e.target.value; viewOffice(); } };
  $('#sheet').onclick = () => downloadPayroll(from, to);
  $('#prim').onclick = () => downloadPrimavera(from, to);
  $('#primcfg').ontoggle = () => { if ($('#primcfg').open) showPrimaveraSettings(); };
  $('#act').onclick = () => downloadAct($('#actsite').value, from, to);
  loadOffice(from, to);
}
// What the office must look at: taps added by hand, taps that arrived late from a phone without network, and
// supervisors' own taps (mini_manual_taps gives the reason; these two texts come from the server as written).
const tapKind = (reason) => (/^sem rede/.test(reason || '') ? 'sem rede, chegou tarde' : reason === 'picou o próprio cartão' ? 'próprio cartão' : 'à mão');
async function loadOffice(from, to) {
  const el = $('#list'); if (!el) return;
  const [{ data, error }, man, per] = await Promise.all([sb.rpc('mini_hours_office', { p_from: from, p_to: to }),
    sb.rpc('mini_manual_taps', { p_from: from, p_to: to }), dayPeriods(from, to)]);
  if (error) { el.innerHTML = `<p>${esc(friendly(error))}</p>`; return; }
  const manual = {};
  for (const m of (man && man.data) || []) (manual[m.work_day_id] = manual[m.work_day_id] || []).push(m);
  const n = (st) => data.filter((r) => r.status === st).length;
  $('#sum').innerHTML = `<p>${n('registered')} por validar na obra · <b>${n('supervisor_validated')} à tua espera</b> · ${n('hr_validated')} aprovados · ${n('sent_to_payroll')} fechados</p>
    ${n('supervisor_validated') ? '<p><button class="btn" id="approveAll">Aprovar todos os dias validados na obra</button></p>' : ''}`;
  if (!data.length) el.innerHTML = '<p class="muted">Sem horas neste mês.</p>';
  else {
    const byWorker = {};
    for (const r of data) (byWorker[r.collaborator_id] = byWorker[r.collaborator_id] || []).push(r);
    const me = state.me && state.me.collaborator_id;
    el.innerHTML = Object.values(byWorker).map((rows) => {
      const tot = rows.reduce((a, r) => a + r.worked_minutes, 0);
      return `<h2>${esc(rows[0].full_name)} <span class="small muted">${esc(rows[0].employee_number || '')} · ${esc(fmtMin(tot))} no mês</span></h2>
      <table><tr><th>Dia</th><th>Obra</th><th>Entrada / saída</th><th>Horas</th><th>Estado</th></tr>${rows.map((r) => `<tr>
        <td>${esc(new Date(r.shift_date + 'T12:00:00').toLocaleDateString('pt-PT', { weekday: 'short', day: '2-digit', month: '2-digit' }))}</td>
        <td>${esc(r.project_code)}</td>
        <td>${periodList(per[r.work_day_id]).map((p) => `<div>${esc(p)}</div>`).join('') || `${esc(fmtHour(r.first_in, siteTz(r.project_id)))} – ${esc(fmtHour(r.last_out, siteTz(r.project_id)))}`}</td>
        <td>${esc(fmtMin(r.worked_minutes))}${r.overtime_minutes ? `<div class="small">${esc(fmtMin(r.overtime_minutes))} extra ${r.overtime_approved ? 'aprovadas' : r.overtime_approved === false ? 'recusadas' : 'por decidir'}</div>` : ''}</td>
        <td>${r.anomalies.length ? `<span class="pill bad">${esc(r.anomalies.map((a) => anomalyText(a, r.shift_date, siteTz(r.project_id))).join(', '))}</span>` : OFFICE_STATUS[r.status] || esc(r.status)}
          ${r.supervisor_name && r.status !== 'registered' ? `<div class="small muted">por ${esc(r.supervisor_name)}</div>` : ''}
          ${r.returned_reason ? `<div class="small">Devolvido: ${esc(r.returned_reason)}</div>` : ''}
          ${(manual[r.work_day_id] || []).map((m) => `<div class="small"><span class="pill warn">${esc(tapKind(m.reason))}</span> ${m.direction === 'in' ? 'Entrada' : 'Saída'} ${esc(fmtHour(m.effective_time, siteTz(r.project_id)))}, por ${esc(m.added_by || '?')}: ${esc(m.reason || '')}</div>`).join('')}
          ${['supervisor_validated', 'hr_validated'].includes(r.status) && r.collaborator_id !== me ? `<div class="noprint" style="margin-top:4px">
            ${r.status === 'supervisor_validated' ? `<button class="btn small" data-approve="${esc(r.work_day_id)}">Aprovar</button>` : ''}
            <button class="btn ghost small" data-back="${esc(r.work_day_id)}">Devolver</button></div>` : ''}</td></tr>`).join('')}</table>`;
    }).join('');
  }
  const ready = data.filter((r) => r.status === 'supervisor_validated' && r.collaborator_id !== (state.me && state.me.collaborator_id));
  if ($('#approveAll')) $('#approveAll').onclick = () => approveDays(ready.map((r) => r.work_day_id));
  el.querySelectorAll('button[data-approve]').forEach((b) => b.onclick = () => approveDays([b.dataset.approve]));
  el.querySelectorAll('button[data-back]').forEach((b) => b.onclick = () => returnDay(b.dataset.back));
  // Closing: only a month that is over, with every day approved.
  const box = $('#close'); if (!box) return;
  const pending = data.filter((r) => ['registered', 'supervisor_validated'].includes(r.status)).length;
  const toClose = data.filter((r) => r.status === 'hr_validated').length;
  if (to >= isoDay(new Date())) box.innerHTML = '<p class="small muted">O mês ainda não acabou: só se fecha depois do último dia.</p>';
  else if (pending) box.innerHTML = `<p class="small"><span class="pill warn">${pending} dia(s) por aprovar</span> Aprova ou devolve todos antes de fechar.</p>`;
  else if (!toClose) box.innerHTML = data.length ? '<p class="small"><span class="pill ok">Mês fechado</span> Estas horas já seguiram para os salários.</p>' : '';
  else {
    box.innerHTML = `<p><button class="btn" id="closeMonth">Fechar o mês para os salários</button></p>
      <p class="small muted">Depois de fechar, ninguém pode mudar as horas deste mês.</p>`;
    $('#closeMonth').onclick = async () => {
      if (!confirm('Fechar o mês? Depois disto ninguém pode mudar as horas deste mês.')) return;
      const { data: n, error: e } = await sb.rpc('mini_close_period', { p_from: from, p_to: to });
      if (e) return toast(friendly(e));
      toast(`Mês fechado: ${n} dia(s) seguiram para os salários.`); viewOffice();
    };
  }
}
async function approveDays(ids) {
  if (!ids.length) return;
  const { data, error } = await sb.rpc('advance_work_days', { p_ids: ids, p_to: 'hr_validated' });
  if (error) return toast(friendly(error));
  toast(`${data} dia(s) aprovado(s).`); viewOffice();
}
async function returnDay(id) {
  const why = prompt('Porque é que devolves este dia ao encarregado? (ele vai ver o motivo)');
  if (!why) return;
  const { error } = await sb.rpc('mini_return_days', { p_ids: [id], p_reason: why });
  if (error) return toast(friendly(error));
  toast('Dia devolvido ao encarregado.'); viewOffice();
}
// ------------------------------------------------------------------ Primavera: Relógio de Ponto (fixed-width text)
// Each company sets the codes and positions in its Primavera; GestNow copies the same values here.
// Overtime above 100 hours in the year has its own codes (art. 268.º, n.º 2): Primavera pays the higher rate.
const PRIM_CATS = [['ot_first', '1.ª hora extra (dia útil)'], ['ot_next', 'Horas extra seguintes (dia útil)'],
  ['rest_day', 'Trabalho em dia de descanso'], ['holiday', 'Trabalho em feriado'],
  ['ot_first_100', '1.ª hora extra, acima das 100 h do ano'], ['ot_next_100', 'Horas extra seguintes, acima das 100 h do ano'],
  ['rest_day_100', 'Dia de descanso, acima das 100 h do ano'], ['holiday_100', 'Feriado, acima das 100 h do ano']];
const PRIM_FIELDS = [['employee', 'Funcionário'], ['date', 'Data'], ['kind', 'Falta ou hora extra'], ['code', 'Código'],
  ['time', 'Tempo'], ['unit', 'Horas ou dias'], ['exclude_proc', 'Exclui processamento'], ['exclude_stat', 'Exclui estatística'],
  ['meal', 'Subsídio de alimentação'], ['shift', 'Turno']];
const PRIM_DATES = ['dd-mm-yyyy', 'dd/mm/yyyy', 'ddmmyyyy', 'yyyy-mm-dd', 'yyyymmdd'];
function primDate(iso, f) {
  const [y, m, d] = iso.split('-');
  return { 'dd-mm-yyyy': `${d}-${m}-${y}`, 'dd/mm/yyyy': `${d}/${m}/${y}`, ddmmyyyy: d + m + y, 'yyyy-mm-dd': iso, yyyymmdd: y + m + d }[f];
}
// Hours as a decimal number (1,50 = hora e meia), with the company's separator, or with 2 implied decimals (150).
function primTime(minutes, c) {
  const t = (minutes / 60).toFixed(2);
  return c.implied_decimals ? t.replace('.', '') : t.replace('.', c.decimal);
}
async function showPrimaveraSettings() {
  const box = $('#primform'); if (!box) return;
  const { data: c, error } = await sb.rpc('mini_payroll_settings');
  if (error) { box.innerHTML = `<p>${esc(friendly(error))}</p>`; return; }
  const sel = (name, opts, cur) => `<select name="${name}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  box.innerHTML = `<form id="primf">
    <p class="small warn">Copia estes valores do ecrã do Primavera da tua empresa (Recursos Humanos › Tabelas › Horas Extra, e a configuração do Relógio de Ponto). Os códigos são inventados por cada empresa: o GestNow não adivinha nenhum.</p>
    <h2>Códigos de horas extra da empresa</h2>
    ${PRIM_CATS.map(([k, label]) => `<label>${esc(label)}</label><input name="c_${k}" value="${esc(c.codes[k] || '')}" maxlength="10" autocapitalize="characters">`).join('')}
    <p class="small muted">Um tipo sem código não sai no ficheiro: o GestNow avisa e não o deixa tirar enquanto houver horas desse tipo.</p>
    <h2>Formato</h2>
    <div class="row"><div><label>Data</label>${sel('date_format', PRIM_DATES.map((f) => [f, f]), c.date_format)}</div>
      <div><label>Decimais</label>${sel('decimal', [[',', 'vírgula (1,50)'], ['.', 'ponto (1.50)']], c.decimal)}</div></div>
    <div class="row"><div><label>Tempo: encher à esquerda com</label>${sel('time_pad', [['zeros', 'zeros (001,50)'], ['spaces', 'espaços (  1,50)']], c.time_pad)}</div>
      <div><label><input type="checkbox" name="implied_decimals" ${c.implied_decimals ? 'checked' : ''}> Sem separador (150 = 1,50)</label></div></div>
    <div class="row"><div><label>Letra de hora extra</label><input name="overtime_marker" value="${esc(c.overtime_marker)}" maxlength="1"></div>
      <div><label>Letra de horas</label><input name="unit_marker" value="${esc(c.unit_marker)}" maxlength="1"></div></div>
    <h2>Posições no ficheiro (coluna inicial e tamanho; tamanho 0 = não usa)</h2>
    <table><tr><th>Campo</th><th>Início</th><th>Tamanho</th></tr>${PRIM_FIELDS.map(([k, label]) => `<tr><td>${esc(label)}</td>
      <td><input name="p_${k}" type="number" min="1" max="199" value="${esc(c.fields[k][0])}"></td>
      <td><input name="l_${k}" type="number" min="0" max="50" value="${esc(c.fields[k][1])}"></td></tr>`).join('')}</table>
    <p><button class="btn">Guardar a configuração</button></p></form>`;
  $('#primf').onsubmit = async (e) => {
    e.preventDefault(); const f = new FormData(e.target);
    const settings = { codes: Object.fromEntries(PRIM_CATS.map(([k]) => [k, String(f.get('c_' + k) || '').trim().toUpperCase()])),
      date_format: f.get('date_format'), decimal: f.get('decimal'), time_pad: f.get('time_pad'), implied_decimals: f.get('implied_decimals') === 'on',
      overtime_marker: String(f.get('overtime_marker') || '').trim(), unit_marker: String(f.get('unit_marker') || '').trim(),
      fields: Object.fromEntries(PRIM_FIELDS.map(([k]) => [k, [Number(f.get('p_' + k)), Number(f.get('l_' + k))]])) };
    const { error: e2 } = await sb.rpc('mini_set_payroll_settings', { p_settings: settings });
    if (e2) return toast(friendly(e2));
    toast('Configuração do Primavera guardada.');
  };
}
async function downloadPrimavera(from, to) {
  const [{ data: c, error: e1 }, { data: rows, error: e2 }] = await Promise.all([sb.rpc('mini_payroll_settings'),
    sb.rpc('mini_primavera_lines', { p_from: from, p_to: to })]);
  if (e1 || e2) return toast(friendly(e1 || e2));
  if (!rows.length) return toast('Sem horas extra aprovadas neste mês.');
  const noNumber = [...new Set(rows.filter((r) => !r.employee_number).map((r) => r.full_name))];
  if (noNumber.length) return toast(`Falta o Nº de trabalhador (código do Primavera) de: ${noNumber.join(', ')}.`);
  const badNumber = [...new Set(rows.filter((r) => !/^[\x20-\x7e]+$/.test(r.employee_number)).map((r) => r.full_name))];
  if (badNumber.length) return toast(`O Nº de trabalhador só pode ter letras sem acento, números e sinais simples: ${badNumber.join(', ')}.`);
  const labels = Object.fromEntries(PRIM_CATS);
  const noCode = [...new Set(rows.filter((r) => !c.codes[r.category]).map((r) => labels[r.category] || r.category))];
  if (noCode.length) return toast(`Falta o código do Primavera para: ${noCode.join('; ')}. Põe-no em "Configurar o ficheiro do Primavera".`);
  const width = Math.max(...Object.values(c.fields).map(([p, l]) => p + l - 1));
  const put = (line, key, value, right) => {
    const [p, l] = c.fields[key]; if (!l) return true;
    const v = String(value);
    if (v.length > l) return false;
    const txt = right ? v.padStart(l, c.time_pad === 'spaces' ? ' ' : '0') : v.padEnd(l, ' ');
    for (let i = 0; i < l; i++) line[p - 1 + i] = txt[i];
    return true;
  };
  const lines = []; const tooLong = new Set();
  for (const r of rows) {
    const line = new Array(width).fill(' ');
    const ok = [put(line, 'employee', r.employee_number), put(line, 'date', primDate(r.shift_date, c.date_format)),
      put(line, 'kind', c.overtime_marker), put(line, 'code', c.codes[r.category]),
      put(line, 'time', primTime(r.minutes, c), true), put(line, 'unit', c.unit_marker),
      put(line, 'exclude_proc', '0'), put(line, 'exclude_stat', '0'), put(line, 'meal', '0'), put(line, 'shift', '0')];
    if (ok.includes(false)) { tooLong.add(r.full_name); continue; }
    lines.push(line.join(''));                       // every line the full width of the layout
  }
  if (tooLong.size) return toast(`Um valor não cabe nas posições configuradas (${[...tooLong].join(', ')}). Aumenta o tamanho do campo.`);
  const closed = rows.every((r) => r.all_closed);
  const a = document.createElement('a');
  const text = lines.join('\r\n') + '\r\n';            // only plain ASCII: the same bytes in Windows-1252 and UTF-8
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  a.download = `gestnow-primavera-${from.slice(0, 7)}${closed ? '' : '-provisorio'}.txt`;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  if (globalThis.GESTNOW_TEST) globalThis.LAST_CSV = { name: a.download, text };
  const over = rows.filter((r) => /_100$/.test(r.category)).length;
  toast((closed ? `Ficheiro do Primavera: ${lines.length} linha(s).` : `Ficheiro provisório: o mês ainda não está fechado (${lines.length} linha(s)).`)
    + (over ? ` ${over} linha(s) já acima das 100 h do ano.` : ''));
}

// ------------------------------------------------------------------ Excel (.xlsx): folha para salários e registo de tempos (ACT)
// Real Excel files, built on the phone. ExcelJS (MIT, in vendor/) is about 1 MB, so it is fetched only when someone taps
// a download button, from this same site (the page's CSP allows scripts only from 'self'; ExcelJS needs no eval).
// Every value from the database goes in as plain text, a number or a date: a name that starts with "=" stays text.
// The only formulas are the totals, built here from column letters and row numbers, never from data.
const XLSX_LIB = 'vendor/exceljs-4.4.0.min.js';
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
let xlsxLib = null; let xlsxBusy = false;
function loadExcel() {
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
  if (!xlsxLib) {
    xlsxLib = new Promise((resolve, reject) => {
      const s = document.createElement('script'); let timer = null;
      const done = (err) => {
        clearTimeout(timer);
        if (!err && window.ExcelJS) return resolve(window.ExcelJS);
        s.remove(); xlsxLib = null; reject(err || new Error('ExcelJS'));   // the next tap tries again
      };
      timer = setTimeout(() => done(new Error('timeout')), 60000);
      s.src = XLSX_LIB; s.onload = () => done(); s.onerror = () => done(new Error('load'));
      document.head.appendChild(s);
    });
  }
  return xlsxLib;
}
// One export at a time: fetch the rows while ExcelJS loads, build the workbook, hand the file to the phone.
async function excelExport(fetchRows, build) {
  if (xlsxBusy) return;
  xlsxBusy = true;
  try {
    if (!window.ExcelJS) toast('A preparar o Excel…');
    const lib = loadExcel(); lib.catch(() => {});
    const rows = await fetchRows(); if (!rows) return;   // no rows: the user was already told why
    let X;
    try { X = await lib; } catch (e) { return toast('Não consegui preparar o Excel. Verifica a rede e toca outra vez no botão.'); }
    const out = build(X, rows);
    const buf = await out.wb.xlsx.writeBuffer();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([buf], { type: XLSX_TYPE }));
    a.download = out.name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    if (globalThis.GESTNOW_TEST) {   // only in the automatic tests: payroll holds NIFs
      const u = new Uint8Array(buf); let bin = '';
      for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
      globalThis.LAST_XLSX = { name: out.name, base64: btoa(bin) };
    }
    toast(out.msg);
  } catch (e) { toast(friendly(e)); } finally { xlsxBusy = false; }
}

const XL = { brand: 'FF0F3D3E', soft: 'FFE7F0EF', mid: 'FFCFE1DF', ink: 'FF142322', muted: 'FF5D6B6A', line: 'FFC9D5D3',
  warnBg: 'FFFFF2D6', warn: 'FF8A5A00', ok: 'FF1F7A3A', grey: 'FF8C9796', rest: 'FFE9EFF7', white: 'FFFFFFFF' };
const XF = { text: '@', h: '0.00;-0.00;"–"', hm: '[h]:mm;-[h]:mm;"–"', n: '0;-0;"–"', date: 'dd/mm/yyyy', time: 'hh:mm' };
const XFONT = 'Calibri';
// XML cannot hold control characters: a pasted name with one would make the whole file unreadable.
const xs = (v) => String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '');
const xlDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const xlTime = (t) => { const m = /^(\d{1,2}):(\d{2})$/.exec(t || ''); return m ? (Number(m[1]) * 60 + Number(m[2])) / 1440 : null; };
const xlH = (min) => (min || 0) / 60;
const WEEKDAY = ['dom.', 'seg.', 'ter.', 'qua.', 'qui.', 'sex.', 'sáb.'];
const xlBorder = (argb) => { const s = { style: 'thin', color: { argb } }; return { top: s, left: s, bottom: s, right: s }; };
const xlFill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const exportedBy = () => { const me = state.me || {}; const p = me.collaborator_id && state.people.find((x) => x.id === me.collaborator_id);
  return p ? p.full_name : me.email || ''; };
function periodLabel(from, to) {
  const [y, m] = from.split('-').map(Number);
  const whole = from.endsWith('-01') && to === monthRange(from.slice(0, 7)).to;
  const name = new Date(y, m - 1, 15).toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' });
  return `${whole ? name + ' (' : ''}${fmtDate(from)} a ${fmtDate(to)}${whole ? ')' : ''}`;
}
function xlBook(X, doc) {
  const wb = new X.Workbook();
  wb.creator = 'GestNow'; wb.lastModifiedBy = 'GestNow'; wb.created = wb.modified = new Date();
  wb.title = doc.title; wb.subject = doc.scope; wb.company = doc.company; wb.category = 'GestNow Mini';
  wb.calcProperties.fullCalcOnLoad = true;
  return wb;
}
// Title block, the PROVISÓRIO banner, a two-level header (groups over columns), frozen header, filter and A4 landscape print.
// cols: { h: header, t: text|n|h|hm|date|time, w: min width, max: max width (text grows to fit) }.
function xlSheet(wb, name, doc, cols, groups) {
  const n = cols.length;
  const ws = wb.addWorksheet(name, { properties: { defaultRowHeight: 15 } });
  cols.forEach((c, i) => { ws.getColumn(i + 1).width = c.w; });
  const line = (r, text, font) => { const c = ws.getCell(r, 1); c.value = xs(text); c.font = { name: XFONT, ...font }; };
  line(1, doc.company, { size: 14, bold: true, color: { argb: XL.brand } });
  line(2, doc.title, { size: 12, bold: true, color: { argb: XL.ink } });
  line(3, doc.scope, { size: 10, color: { argb: XL.ink } });
  line(4, doc.generated, { size: 9, italic: true, color: { argb: XL.muted } });
  ws.getRow(1).height = 20; ws.getRow(2).height = 17;
  let r = 5;
  if (doc.provisional) {
    ws.mergeCells(r, 1, r, n);
    const c = ws.getCell(r, 1);
    c.value = 'PROVISÓRIO – mês ainda não fechado' + (doc.provisional === true ? '' : ': ' + doc.provisional);
    c.font = { name: XFONT, size: 11, bold: true, color: { argb: XL.warn } };
    c.fill = xlFill(XL.warnBg); c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    c.border = xlBorder('FFE9C46A'); ws.getRow(r).height = 22; r++;
  }
  r++;
  const groupRow = groups ? r++ : null;
  if (groups) {
    for (const g of groups) {
      if (g.to > g.from) ws.mergeCells(groupRow, g.from, groupRow, g.to);
      const c = ws.getCell(groupRow, g.from);
      c.value = g.label;
      c.font = { name: XFONT, size: 9, bold: true, color: { argb: XL.brand } };
      c.fill = xlFill(XL.mid); c.alignment = { horizontal: 'center', vertical: 'middle' };
      for (let i = g.from; i <= g.to; i++) ws.getCell(groupRow, i).border = xlBorder(XL.white);
    }
    ws.getRow(groupRow).height = 16;
  }
  const head = r;
  cols.forEach((col, i) => {
    const c = ws.getCell(head, i + 1);
    c.value = col.h;
    c.font = { name: XFONT, size: 10, bold: true, color: { argb: XL.white } };
    c.fill = xlFill(XL.brand); c.border = xlBorder(XL.white);
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: head, topLeftCell: `A${head + 1}`, activeCell: `A${head + 1}`, showGridLines: false }];
  ws.autoFilter = { from: { row: head, column: 1 }, to: { row: head, column: n } };
  ws.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true,
    margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.6, header: 0.25, footer: 0.3 }, printTitlesRow: `${groupRow || head}:${head}` };
  // "&" starts a code in Excel's header and footer: a site called "A&B" must print as written.
  const hf = (s) => xs(s).slice(0, 90).replace(/&/g, '&&');
  ws.headerFooter = { oddFooter: `&L&8GestNow · ${hf(doc.title)} · ${hf(doc.scope)}&R&8Página &P de &N` };
  return { ws, head, cols };
}
// One table row. vals[i]: number, Date, text, null, or { formula, result } built by this file only.
function xlRow(t, r, vals, opt = {}) {
  const row = t.ws.getRow(r);
  t.cols.forEach((col, i) => {
    const c = row.getCell(i + 1); const v = vals[i];
    const own = opt.cell && opt.cell[i];
    if (v && typeof v === 'object' && !(v instanceof Date) && 'formula' in v) c.value = { formula: v.formula, result: v.result };
    else if (v == null || v === '') c.value = null;
    else if (col.t === 'text' || typeof v === 'string') c.value = xs(v);
    else c.value = v;
    const isText = col.t === 'text' || typeof v === 'string';
    c.numFmt = isText ? XF.text : XF[col.t];
    c.font = { name: XFONT, size: 10, bold: !!opt.bold, color: { argb: XL.ink }, ...(col.font || {}), ...((own && own.font) || {}) };
    const horizontal = col.al || (col.t === 'text' ? 'left' : ['date', 'time'].includes(col.t) || isText ? 'center' : 'right');
    c.alignment = { vertical: 'middle', horizontal, indent: horizontal === 'center' ? 0 : 1 };
    c.border = xlBorder(XL.line);
    const fill = (own && own.fill) || opt.fill;
    if (fill) c.fill = xlFill(fill);
  });
  if (opt.top) row.eachCell({ includeEmpty: true }, (c) => { c.border = { ...c.border, top: { style: 'medium', color: { argb: XL.brand } } }; });
  if (opt.height) row.height = opt.height;
}
// Totals with SUBTOTAL(109): they follow the filter, and a grand total skips the subtotals inside it.
const xlSum = (t, i, first, last, result) => { const L = t.ws.getColumn(i + 1).letter;
  return { formula: `SUBTOTAL(109,${L}${first}:${L}${last})`, result }; };
// Text columns grow to fit their longest value; the header wraps and its row grows to fit.
function xlFit(t, first, last) {
  t.cols.forEach((col, i) => {
    const word = Math.max(...col.h.split(' ').map((x) => x.length));   // a header word is never cut in two
    let len = 0;
    if (col.max) for (let r = first; r <= last; r++) { const v = t.ws.getCell(r, i + 1).value; if (typeof v === 'string') len = Math.max(len, v.length); }
    t.ws.getColumn(i + 1).width = Math.max(Math.ceil(word * 1.15) + 2, Math.min(col.max || col.w, Math.max(col.w, Math.ceil(len * 1.05) + 3)));
  });
  let lines = 1;
  t.cols.forEach((col, i) => {
    const w = t.ws.getColumn(i + 1).width - 1; let n = 1; let cur = 0;
    for (const word of col.h.split(' ')) { if (cur && cur + 1 + word.length > w) { n++; cur = word.length; } else cur += (cur ? 1 : 0) + word.length; }
    lines = Math.max(lines, n);
  });
  t.ws.getRow(t.head).height = 13 * lines + 5;
}
// Page breaks between blocks (one person's month, the notes), so a block does not start at the foot of a page.
// An estimate for A4 landscape fitted to the width; a block longer than a page simply flows on.
function xlBreaks(t, blocks) {
  const ws = t.ws; const h = (r) => ws.getRow(r).height || 15;
  let px = 0; t.cols.forEach((c, i) => { px += ws.getColumn(i + 1).width * 7 + 5; });
  const scale = Math.min(1, ((11.69 - 0.8) * 96) / px);
  const page = ((8.27 - 1.1) * 72 / scale) * 0.9;   // points of sheet per printed page, with a safety margin
  const header = h(t.head) + (t.head > 1 ? h(t.head - 1) : 0);
  let used = 0; for (let r = 1; r <= t.head; r++) used += h(r);
  for (const [a, b] of blocks) {
    let bh = 0; for (let r = a; r <= b; r++) bh += h(r);
    if (used + bh > page && used > header + 1) { ws.getRow(a - 1).addPageBreak(); used = header; }
    used += bh; while (used > page) used -= page - header;
  }
}
// A plain paragraph under the table (notes, signature lines): text overflows to the right, nothing else on the row.
function xlNote(ws, r, text, font = {}) {
  const c = ws.getCell(r, 1); c.value = xs(text);
  c.font = { name: XFONT, size: 9, color: { argb: XL.muted }, ...font };
  c.alignment = { vertical: 'middle' };
}
function xlDoc(rowsOrgs, title, scope, provisional) {
  const orgs = [...new Set(rowsOrgs.filter(Boolean))];
  const now = new Date();
  return { company: orgs.length > 3 ? orgs.slice(0, 3).join(' · ') + ` e mais ${orgs.length - 3}` : orgs.join(' · ') || 'GestNow',
    title, scope, provisional,
    generated: `Gerado em ${now.toLocaleDateString('pt-PT')} às ${now.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}`
      + `${exportedBy() ? ' por ' + exportedBy() : ''} · GestNow` };
}

// ---- Folha para salários: "Por obra" (pessoa × obra), "Resumo por pessoa" e "Como ler"
const PAY_HOURS = [['normal_minutes', 'Horas normais'], ['overtime_approved_minutes', 'Extra aprovadas'],
  ['overtime_refused_minutes', 'Extra recusadas'], ['overtime_undecided_minutes', 'Extra por decidir'],
  ['rest_day_minutes', 'Em dia de descanso'], ['holiday_minutes', 'Em feriado']];
const PAY_HELP = [
  ['Nº', 'Número do trabalhador na empresa (é também o código do funcionário no Primavera).'],
  ['Nome, NIF, Empresa', 'Dados da ficha do trabalhador. A empresa é a entidade patronal (pode ser um subempreiteiro).'],
  ['Obra, Nome da obra', 'Onde as horas foram picadas. Quem trabalhou em várias obras tem uma linha por obra na folha «Por obra» e uma só linha na folha «Resumo por pessoa».'],
  ['Obras', 'No resumo: os códigos de todas as obras onde a pessoa trabalhou no período.'],
  ['Dias', 'Dias com horas trabalhadas. Na folha «Por obra» são os dias nessa obra. No resumo por pessoa cada dia conta uma vez, mesmo que a pessoa tenha passado por duas obras nesse dia.'],
  ['Horas normais', 'Horas em dias úteis até ao limite diário normal.'],
  ['Extra aprovadas', 'Horas em dias úteis acima do limite diário, aprovadas. São as que seguem para o Primavera como trabalho suplementar.'],
  ['Extra recusadas', 'Horas acima do limite diário que o encarregado recusou. Aparecem a cinzento: não contam como trabalho suplementar.'],
  ['Extra por decidir', 'Horas acima do limite diário que ainda ninguém aprovou nem recusou. A amarelo quando há alguma: decide-as antes de pagar. Num mês fechado ficam a zero.'],
  ['Em dia de descanso', 'Todas as horas feitas ao sábado ou ao domingo.'],
  ['Em feriado', 'Todas as horas feitas em dia feriado.'],
  ['Total trabalhado (h)', 'Normais + extra aprovadas + extra recusadas + extra por decidir + descanso + feriado. É o tempo picado, já sem a pausa descontada.'],
  ['Total (h:mm)', 'O mesmo total em horas e minutos: 7:30 são sete horas e meia.'],
  ['Das quais noturnas (h)', 'A parte do total feita de noite (por defeito entre as 22:00 e as 7:00). Já está contada nas colunas anteriores: não somar outra vez.'],
  ['Dias por aprovar', 'Dias que o secretariado ainda não aprovou. A amarelo quando há algum.'],
  ['Estado', '«Fechado»: o mês foi fechado para os salários e já não muda. «Provisório»: ainda pode mudar.'],
];
const PAY_NOTES = [
  'As horas estão em número decimal: 7,50 são 7 horas e 30 minutos; 0,25 são 15 minutos. Um traço (–) quer dizer zero.',
  'As linhas de total usam a função SUBTOTAL: se filtrares a tabela, o total passa a somar só as linhas visíveis.',
  'Enquanto o mês não for fechado no GestNow (Secretariado › Fechar o mês), a folha diz PROVISÓRIO e os números ainda podem mudar.',
];
function payCols(first) {
  return [{ h: 'Nº', t: 'text', w: 8, max: 14 }, { h: 'Nome', t: 'text', w: 20, max: 38 }, { h: 'NIF', t: 'text', w: 11, max: 14 },
    { h: 'Empresa', t: 'text', w: 12, max: 30 }, ...first,
    { h: 'Dias', t: 'n', w: 6 },
    ...PAY_HOURS.map(([k, h]) => ({ h, t: 'h', w: 10, font: k === 'overtime_refused_minutes' ? { color: { argb: XL.grey }, italic: true } : undefined })),
    { h: 'Total trabalhado (h)', t: 'h', w: 11, font: { bold: true } }, { h: 'Total (h:mm)', t: 'hm', w: 9 },
    { h: 'Das quais noturnas (h)', t: 'h', w: 10 }, { h: 'Dias por aprovar', t: 'n', w: 9 }, { h: 'Estado', t: 'text', w: 11, al: 'center' }];
}
// Writes the person rows and the grand total; returns the next free row.
function payTable(t, list, firstCol, labelTotal) {
  const D = firstCol; const H = D + 1; const TOT = H + PAY_HOURS.length;   // column indexes (0-based)
  const L = (i) => t.ws.getColumn(i + 1).letter;
  const first = t.head + 1; let r = first;
  const sum = new Array(t.cols.length).fill(0);
  for (const x of list) {
    const hours = PAY_HOURS.map(([k]) => xlH(x[k]));
    const total = hours.reduce((a, b) => a + b, 0);
    const vals = [...x.lead, x.days_worked, ...hours,
      { formula: `SUM(${L(H)}${r}:${L(TOT - 1)}${r})`, result: total }, { formula: `${L(TOT)}${r}/24`, result: total / 24 },
      xlH(x.night_minutes), x.days_pending, x.all_closed ? 'Fechado' : 'Provisório'];
    const cell = {};
    const U = H + PAY_HOURS.findIndex(([k]) => k === 'overtime_undecided_minutes');   // undecided overtime: a flag the office cannot miss
    if (x.overtime_undecided_minutes) cell[U] = { fill: XL.warnBg, font: { bold: true, color: { argb: XL.warn } } };
    if (x.days_pending) cell[TOT + 3] = { fill: XL.warnBg, font: { bold: true, color: { argb: XL.warn } } };
    cell[TOT + 4] = x.all_closed ? { font: { color: { argb: XL.ok } } } : { fill: XL.warnBg, font: { color: { argb: XL.warn } } };
    xlRow(t, r, vals, { cell });
    [x.days_worked, ...hours, total, total / 24, xlH(x.night_minutes), x.days_pending].forEach((v, k) => { sum[D + k] += v; });
    r++;
  }
  const last = r - 1;
  const totals = t.cols.map((c, i) => (i < D ? null : i <= TOT + 3 ? xlSum(t, i, first, last, sum[i]) : null));
  totals[1] = labelTotal;
  xlRow(t, r, totals, { bold: true, fill: XL.soft, top: true, height: 18 });
  xlFit(t, first, last);
  return r + 1;
}
async function downloadPayroll(from, to) {
  await excelExport(async () => {
    const { data, error } = await sb.rpc('mini_payroll_lines', { p_from: from, p_to: to });
    if (error) return void toast(friendly(error));
    if (!data.length) return void toast('Sem horas neste mês.');
    return data;
  }, (X, data) => {
    const closed = data.every((r) => r.all_closed);
    const pending = data.reduce((a, r) => a + r.days_pending, 0);
    const undecided = data.reduce((a, r) => a + (r.overtime_undecided_minutes || 0), 0);
    const title = 'Folha de horas para salários';
    const doc = xlDoc(data.map((r) => r.organization), title, `Todas as obras · Período: ${periodLabel(from, to)}`,
      closed ? null : pending ? `${pending} dia(s) ainda por aprovar` : 'tudo aprovado, falta fechar o mês');
    const wb = xlBook(X, doc);
    const groups = (n) => [...(n === 2 ? [{ label: 'Trabalhador', from: 1, to: 4 }, { label: 'Obra', from: 5, to: 6 }] : [{ label: 'Trabalhador', from: 1, to: 5 }]),
      { label: 'Tempo trabalhado (horas em decimal: 7,50 = 7h30)', from: 5 + n, to: 14 + n }, { label: 'Fecho do mês', from: 15 + n, to: 16 + n }];
    // 1. one row per person and site
    const t1 = xlSheet(wb, 'Por obra', doc, payCols([{ h: 'Obra', t: 'text', w: 8, max: 14 }, { h: 'Nome da obra', t: 'text', w: 16, max: 34 }]), groups(2));
    let r = payTable(t1, data.map((x) => ({ ...x, lead: [x.employee_number, x.full_name, x.tax_number, x.organization, x.project_code, x.project_title] })),
      6, `Total (${data.length} linha${data.length === 1 ? '' : 's'})`);
    PAY_NOTES.slice(0, 1).concat('Explicação de cada coluna na folha «Como ler».').forEach((s) => { r++; xlNote(t1.ws, r, s); });
    // 2. one row per person (by id, never by name), all sites added up; a day spent on two sites counts once
    const people = new Map();
    for (const x of data) {
      const k = x.collaborator_id;
      const p = people.get(k) || { lead: [x.employee_number, x.full_name, x.tax_number, x.organization], sites: [], days_worked: x.person_days || 0, night_minutes: 0,
        days_pending: 0, all_closed: true, ...Object.fromEntries(PAY_HOURS.map(([h]) => [h, 0])) };
      p.sites.push(x.project_code); p.night_minutes += x.night_minutes; p.days_pending += x.days_pending;
      p.all_closed = p.all_closed && x.all_closed; for (const [h] of PAY_HOURS) p[h] += x[h];
      people.set(k, p);
    }
    const t2 = xlSheet(wb, 'Resumo por pessoa', doc, payCols([{ h: 'Obras', t: 'text', w: 10, max: 30 }]), groups(1));
    r = payTable(t2, [...people.values()].map((p) => ({ ...p, lead: [...p.lead, p.sites.join(', ')] })),
      5, `Total (${people.size} pessoa${people.size === 1 ? '' : 's'})`);
    PAY_NOTES.slice(0, 1).forEach((s) => { r++; xlNote(t2.ws, r, s); });
    // 3. what each column means
    const ws = wb.addWorksheet('Como ler', { views: [{ showGridLines: false }] });
    ws.getColumn(1).width = 26; ws.getColumn(2).width = 100;
    const put = (row, a, b, f = {}) => { const c1 = ws.getCell(row, 1); const c2 = ws.getCell(row, 2);
      c1.value = a; c2.value = b; c1.font = { name: XFONT, size: 10, bold: true, color: { argb: XL.ink }, ...f };
      c2.font = { name: XFONT, size: 10, color: { argb: XL.ink }, ...f }; c2.alignment = { wrapText: true, vertical: 'top' };
      c1.alignment = { vertical: 'top' }; };
    ws.getCell(1, 1).value = 'Como ler a folha de horas para salários';
    ws.getCell(1, 1).font = { name: XFONT, size: 14, bold: true, color: { argb: XL.brand } };
    ws.getCell(2, 1).value = xs(doc.scope); ws.getCell(2, 1).font = { name: XFONT, size: 10, color: { argb: XL.muted } };
    put(4, 'Coluna', 'O que quer dizer', { color: { argb: XL.white } });
    [1, 2].forEach((i) => { ws.getCell(4, i).fill = xlFill(XL.brand); });
    PAY_HELP.forEach(([a, b], i) => {
      put(5 + i, a, b); [1, 2].forEach((k) => { ws.getCell(5 + i, k).border = { bottom: { style: 'thin', color: { argb: XL.line } } }; });
      ws.getRow(5 + i).height = 15 * Math.ceil(b.length / 105);
    });
    r = 6 + PAY_HELP.length;
    put(r, 'Notas', ''); ws.getCell(r, 1).font = { name: XFONT, size: 11, bold: true, color: { argb: XL.brand } };
    PAY_NOTES.forEach((s, i) => { put(r + 1 + i, '', '• ' + s, { bold: false }); ws.getRow(r + 1 + i).height = 15 * Math.ceil((s.length + 2) / 105); });
    ws.pageSetup = { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 } };
    ws.headerFooter = { oddFooter: '&L&8GestNow · Como ler&R&8Página &P de &N' };
    return { wb, name: `gestnow-salarios-${from.slice(0, 7)}${closed ? '' : '-provisorio'}.xlsx`,
      msg: (pending ? `Folha provisória: ainda há ${pending} dia(s) por aprovar.` : closed ? 'Folha descarregada.' : 'Folha provisória: o mês ainda não foi fechado.')
        + (undecided ? ` Há ${fmtMin(undecided)} de horas extra por decidir (coluna a amarelo).` : '') };
  });
}

// ---- Registo de tempos de trabalho (Código do Trabalho, art. 202.º): uma linha por pessoa e dia, com cada período
const ACT_STATUS = { registered: 'Por validar', supervisor_validated: 'Validado na obra', hr_validated: 'Aprovado', sent_to_payroll: 'Fechado' };
async function downloadAct(site, from, to) {
  if (!site) return toast('Escolhe a obra.');
  const s = state.sites.find((x) => x.id === site) || {};
  await excelExport(async () => {
    // The legal record shows every period of the day, in the site's time zone; each row is one work day and carries
    // its own periods (never joined by name, number or date: two people can share a name and have no number).
    const { data, error } = await sb.rpc('mini_time_record', { p_project: site, p_from: from, p_to: to });
    if (error) return void toast(friendly(error));
    if (!data.length) return void toast('Sem picagens nesta obra neste mês.');
    return data;
  }, (X, data) => {
    const days = data.map((r) => {
      let list = periodList(r.periods);
      if (!list.length && (r.first_in_local || r.last_out_local)) list = [`${r.first_in_local || '?'}–${r.last_out_local || '?'}`];
      return { ...r, periods: list.map((p) => p.split('–')) };
    });
    const K = Math.max(1, ...days.map((d) => d.periods.length));
    const open = data.filter((r) => r.status !== 'sent_to_payroll');
    const pending = data.filter((r) => ['registered', 'supervisor_validated'].includes(r.status)).length;
    const title = 'Registo de tempos de trabalho (art. 202.º do Código do Trabalho)';
    const doc = xlDoc(data.map((r) => r.organization), title,
      `Obra: ${s.cost_center_code || ''} – ${s.title || ''}${s.address ? ' · ' + s.address : ''} · Período: ${periodLabel(from, to)}`,
      open.length ? (pending ? `${pending} dia(s) ainda por aprovar` : 'tudo aprovado, falta fechar o mês') : null);
    const wb = xlBook(X, doc);
    const per2 = [];
    for (let k = 1; k <= K; k++) per2.push({ h: 'Entrada', t: 'time', w: 7.5 }, { h: 'Saída', t: 'time', w: 7.5 });
    const cols = [{ h: 'Nº', t: 'text', w: 8, max: 14 }, { h: 'Nome', t: 'text', w: 20, max: 38 }, { h: 'NIF', t: 'text', w: 11, max: 14 },
      { h: 'Empresa', t: 'text', w: 12, max: 28 }, { h: 'Data', t: 'date', w: 10.5 }, { h: 'Dia da semana', t: 'text', w: 7, al: 'center' }, ...per2,
      { h: 'Pausa descontada (h)', t: 'h', w: 9 }, { h: 'Horas trabalhadas (h)', t: 'h', w: 10, font: { bold: true } },
      { h: 'Horas trabalhadas (h:mm)', t: 'hm', w: 10 }, { h: 'Das quais extra (h)', t: 'h', w: 9 }, { h: 'Das quais noturnas (h)', t: 'h', w: 9 },
      { h: 'Descanso', t: 'text', w: 9, al: 'center' }, { h: 'Feriado', t: 'text', w: 8, al: 'center' }, { h: 'Estado', t: 'text', w: 15, al: 'center' }];
    const P0 = 6; const T0 = P0 + 2 * K;   // first period column, first time column (0-based)
    const groups = [{ label: 'Trabalhador', from: 1, to: 4 }, { label: 'Dia', from: 5, to: 6 }];
    for (let k = 1; k <= K; k++) groups.push({ label: `${k}.º período`, from: P0 + 2 * k - 1, to: P0 + 2 * k });
    groups.push({ label: 'Tempo do dia (horas em decimal: 7,50 = 7h30)', from: T0 + 1, to: T0 + 5 }, { label: 'Tipo de dia', from: T0 + 6, to: T0 + 7 },
      { label: 'Validação', from: T0 + 8, to: T0 + 8 });
    const t = xlSheet(wb, 'Registo de tempos', doc, cols, groups);
    const L = (i) => t.ws.getColumn(i + 1).letter;
    const first = t.head + 1; let r = first; const grand = [0, 0, 0, 0, 0]; let people = 0; const blocks = [];
    for (let i = 0; i < days.length;) {
      const key = (d) => d.collaborator_id;
      const group = []; const k0 = key(days[i]);
      while (i < days.length && key(days[i]) === k0) group.push(days[i++]);
      const g0 = r; const sum = [0, 0, 0, 0, 0]; people++;
      for (const d of group) {
        const date = xlDate(d.shift_date); const cell = {};
        const pv = [];
        for (let k = 0; k < K; k++) {
          const p = d.periods[k] || [];
          for (const j of [0, 1]) {
            const v = p.length ? (xlTime(p[j]) ?? 'falta') : null;
            if (v === 'falta') cell[P0 + 2 * k + j] = { fill: XL.warnBg, font: { bold: true, color: { argb: XL.warn } } };
            pv.push(v);
          }
        }
        const nums = [d.break_minutes, d.worked_minutes, d.worked_minutes, d.overtime_minutes, d.night_minutes].map(xlH);
        nums[2] = nums[1] / 24;
        nums.forEach((v, k) => { sum[k] += v; });
        if (['registered', 'supervisor_validated'].includes(d.status)) cell[T0 + 7] = { fill: XL.warnBg, font: { color: { argb: XL.warn }, bold: true } };
        else if (d.status === 'sent_to_payroll') cell[T0 + 7] = { font: { color: { argb: XL.ok } } };
        xlRow(t, r, [d.employee_number, d.full_name, d.tax_number, d.organization, date, WEEKDAY[date.getUTCDay()], ...pv,
          nums[0], nums[1], { formula: `${L(T0 + 1)}${r}/24`, result: nums[2] }, nums[3], nums[4],
          d.rest_day ? 'Sim' : '', d.holiday ? d.holiday_name || 'Sim' : '',
          (ACT_STATUS[d.status] || d.status) + ((d.anomalies || []).length ? ' – ' + d.anomalies.map((a) => anomalyText(a, d.shift_date, d.site_timezone)).join(', ') : '')],
        { fill: d.rest_day || d.holiday ? XL.rest : null, cell });
        r++;
      }
      const tot = cols.map(() => null);
      tot[1] = `Total – ${group[0].full_name}`; tot[4] = `${group.length} dia${group.length === 1 ? '' : 's'}`;
      for (let k = 0; k < 5; k++) { tot[T0 + k] = xlSum(t, T0 + k, g0, r - 1, sum[k]); grand[k] += sum[k]; }
      xlRow(t, r, tot, { bold: true, fill: XL.soft });
      blocks.push([g0, r]); r++;
    }
    const last = r - 1;
    const tot = cols.map(() => null);
    tot[1] = `Total da obra – ${people} trabalhador${people === 1 ? '' : 'es'}`; tot[4] = `${data.length} dia${data.length === 1 ? '' : 's'}`;
    for (let k = 0; k < 5; k++) tot[T0 + k] = xlSum(t, T0 + k, first, last, grand[k]);
    xlRow(t, r, tot, { bold: true, fill: XL.mid, top: true, height: 18 });
    xlFit(t, first, r);
    blocks[blocks.length - 1][1] = r;   // the site total stays with the last person
    // Notes and signature: the record is printed, signed and kept for 5 years.
    r += 2; const notes = r;
    xlNote(t.ws, r++, 'Registo do início e do fim de cada período de trabalho, com as pausas (Código do Trabalho, art. 202.º). Guardar durante 5 anos e mostrar à ACT quando pedido.');
    xlNote(t.ws, r++, `Horas no fuso horário da obra (${tzName(data[0].site_timezone || DEFAULT_TZ)}). Horas em decimal: 7,50 são 7 horas e 30 minutos. «falta» = picagem em falta nesse período. Linhas a azul-claro: sábado, domingo ou feriado.`);
    r++;
    xlNote(t.ws, r, 'Observações:', { size: 10, bold: true, color: { argb: XL.ink } });
    for (let k = 0; k < 2; k++) {
      r++; t.ws.mergeCells(r, 1, r, cols.length);
      t.ws.getCell(r, 1).border = { bottom: { style: 'thin', color: { argb: XL.muted } } }; t.ws.getRow(r).height = 20;
    }
    r += 2;
    xlNote(t.ws, r, 'Responsável pelo registo: ________________________________________     Assinatura: ________________________________________     Data: ____/____/________',
      { size: 10, color: { argb: XL.ink } });
    t.ws.getRow(r).height = 24;
    xlBreaks(t, [...blocks, [notes - 1, r]]);
    const code = String(s.cost_center_code || 'obra').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'obra';
    return { wb, name: `gestnow-registo-tempos-${code}-${from.slice(0, 7)}.xlsx`,
      msg: open.length ? 'Registo descarregado (provisório: o mês ainda não está fechado).' : 'Registo descarregado.' };
  });
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
      <td>${esc(s.title)}<div class="small muted">${esc(s.address || '')}${s.municipality ? ' · concelho ' + esc(s.municipality) : ''} · ${s.country === 'ES' ? 'Espanha' : 'Portugal'}</div></td><td>${esc(s.cost_center_code)}</td>
      <td>${label[s.status] || `<span class="pill">${esc(s.status)}</span>`}</td></tr>`).join('')}</table>` : '<p class="muted">Ainda não há obras.</p>'}</div>
    ${canSiteDetails() && state.sites.length ? `<h2>País, concelho e feriados da obra</h2><div class="card" id="sitecfg">
      <p class="small muted">O país decide os feriados nacionais e a hora da obra (Portugal: hora de Lisboa; Espanha: hora de Madrid). O concelho decide o feriado municipal.</p>
      <label>Obra</label><select id="cfgsite">${state.sites.map((s) => `<option value="${esc(s.id)}" ${currentSite() && currentSite().id === s.id ? 'selected' : ''}>${esc(s.title)} (${esc(s.cost_center_code)})</option>`).join('')}</select>
      <div id="cfgbody"><p class="muted">A carregar…</p></div></div>` : ''}`;
  if ($('#cfgsite')) { $('#cfgsite').onchange = () => loadSiteDetails($('#cfgsite').value); loadSiteDetails($('#cfgsite').value); }
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
// Who sees the section (the database checks the same): admin and project manager set country and municipality,
// admin and HR add or remove the site's own holidays, the supervisor only reads.
const canSiteDetails = () => state.me && ['admin', 'hr', 'project_manager', 'supervisor'].includes(state.me.role);
const canSetSite = () => state.me && ['admin', 'project_manager'].includes(state.me.role);
const canHolidays = () => state.me && ['admin', 'hr'].includes(state.me.role);
let siteCfgSeq = 0;
async function loadSiteDetails(id) {
  const box = $('#cfgbody'); if (!box || !canSiteDetails()) return;
  const seq = ++siteCfgSeq;
  const { data: d, error } = await sb.rpc('mini_site_details', { p_project: id });
  if (seq !== siteCfgSeq || !$('#cfgbody')) return;
  if (error) { box.innerHTML = `<p>${esc(friendly(error))}</p>`; return; }
  const hol = d.holidays || [];
  box.innerHTML = `<p>País: <b>${d.country === 'ES' ? 'Espanha' : 'Portugal'}</b> · Concelho: <b>${esc(d.municipality || 'por escrever')}</b>
      <span class="small muted">· ${esc(tzName(d.timezone))}</span></p>
    ${canSetSite() ? `<form id="cfgf"><div class="row"><div><label>País</label><select name="country">
        <option value="PT" ${d.country !== 'ES' ? 'selected' : ''}>Portugal</option><option value="ES" ${d.country === 'ES' ? 'selected' : ''}>Espanha</option></select></div>
      <div><label>Concelho (município)</label><input name="mun" maxlength="128" value="${esc(d.municipality || '')}" placeholder="ex.: Sines"></div></div>
      <p><button class="btn">Guardar país e concelho</button></p></form>` : ''}
    <h3>Feriados municipais e regionais</h3>
    ${hol.length ? `<table><tr><th>Dia</th><th>Feriado</th><th></th></tr>${hol.map((h) => `<tr><td>${esc(fmtDate(h.date))}</td><td>${esc(h.name)}</td>
      <td>${canHolidays() ? `<button class="btn small ghost" data-delhol="${esc(h.id)}">Tirar</button>` : ''}</td></tr>`).join('')}</table>`
      : '<p class="muted small">Nenhum. Os feriados nacionais (de Portugal ou de Espanha) já contam sozinhos.</p>'}
    ${canHolidays() ? (d.municipality ? `<form id="holf"><div class="row"><div><label>Dia</label><input name="date" type="date" required></div>
      <div><label>Nome</label><input name="name" required minlength="3" placeholder="ex.: Dia do Município"></div></div>
      <p class="small muted">Vale para todas as obras deste concelho. As horas já picadas nesse dia são recalculadas (dia feriado).</p>
      <p><button class="btn ghost">Acrescentar feriado</button></p></form>`
      : '<p class="small muted">Para acrescentar o feriado municipal, escreve primeiro o concelho da obra.</p>') : ''}`;
  if ($('#cfgf')) $('#cfgf').onsubmit = async (e) => {
    e.preventDefault(); const f = new FormData(e.target);
    const { error: e2 } = await sb.rpc('mini_set_site_details', { p_project: id, p_country: f.get('country'), p_municipality: String(f.get('mun') || '').trim() });
    if (e2) return toast(friendly(e2));
    toast('País e concelho guardados.'); await loadBasics(); loadSiteDetails(id);
  };
  if ($('#holf')) $('#holf').onsubmit = async (e) => {
    e.preventDefault(); const f = new FormData(e.target);
    const { error: e2 } = await sb.rpc('mini_add_site_holiday', { p_project: id, p_date: f.get('date'), p_name: String(f.get('name') || '').trim() });
    if (e2) return toast(friendly(e2));
    toast('Feriado acrescentado.'); loadSiteDetails(id);
  };
  box.querySelectorAll('[data-delhol]').forEach((b) => b.onclick = async () => {
    if (!confirm('Tirar este feriado? As horas desse dia passam a contar como dia normal.')) return;
    const { error: e2 } = await sb.rpc('mini_remove_site_holiday', { p_holiday: b.dataset.delhol });
    if (e2) return toast(friendly(e2));
    toast('Feriado tirado.'); loadSiteDetails(id);
  });
}
