const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const crypto = require('crypto');
const APP = process.argv[2]; const OUT = process.argv[3];
const SECRET = 'local-test-secret-local-test-secret-0123456789';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const sign = (claims) => { const h = b64({ alg: 'HS256', typ: 'JWT' }), p = b64(claims);
  return h + '.' + p + '.' + crypto.createHmac('sha256', SECRET).update(h + '.' + p).digest('base64url'); };
const USERS = { admin: '11111111-1111-1111-1111-111111111111', enc: '22222222-2222-2222-2222-222222222222', novo: process.env.NOVO || '33333333-3333-3333-3333-333333333333',
  rh: '44444444-4444-4444-4444-444444444444', ana: '55555555-5555-5555-5555-555555555555' };
const { execFileSync } = require('child_process');
const FICHAS = '/mnt/project-files/mini/testes/fichas-ficticias/';
// Storage stand-in: the object row is written AS the logged-in user, so the real storage rules (RLS) decide.
const FILES = new Map();
const asUser = (claims, q) => {
  try {
    const out = execFileSync('psql', ['-h', '/var/lib/pgtest', '-p', '5433', '-U', 'postgres', '-d', process.env.PGDB || 'app', '-v', 'ON_ERROR_STOP=1', '-qAt', '-c',
      `begin; select set_config('request.jwt.claims', '${JSON.stringify(claims)}', true); set local role authenticated; ${q}; commit;`],
      { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim().split('\n');
    return { rows: out.slice(1) };
  } catch (e) { return { error: (e.stderr || '').toString() }; }
};
const lit = (v) => "'" + String(v).replace(/'/g, "''") + "'";
function multipartFile(buf, ctype) {
  const boundary = '--' + /boundary=(.+)$/.exec(ctype)[1];
  for (const part of buf.toString('latin1').split(boundary)) {
    const i = part.indexOf('\r\n\r\n'); if (i < 0 || !/filename=/.test(part.slice(0, i))) continue;
    const type = (/content-type:\s*([^\r\n]+)/i.exec(part.slice(0, i)) || [])[1] || '';
    return { type: type.trim(), buf: Buffer.from(part.slice(i + 4, part.length - 2), 'latin1') };
  }
  return null;
}
async function storageRoute(r, claims) {
  const u = new URL(r.request().url()); const m = r.request().method(); if (process.env.DBG) console.log('  storage', m, u.pathname.slice(0, 60));
  const json = (status, body) => r.fulfill({ status, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  let mm;
  if ((mm = /^\/storage\/v1\/object\/documentos\/(.+)$/.exec(u.pathname)) && m === 'POST') {
    const name = decodeURIComponent(mm[1]); const f = multipartFile(r.request().postDataBuffer(), r.request().headers()['content-type'] || '');
    if (!f) return json(400, { statusCode: '400', error: 'bad', message: 'no file' });
    if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(f.type)) return json(400, { statusCode: '415', error: 'invalid_mime_type', message: `mime type ${f.type} is not supported` });
    if (f.buf.length > 10485760) return json(400, { statusCode: '413', error: 'Payload too large', message: 'The object exceeded the maximum allowed size' });
    const q = asUser(claims, `insert into storage.objects (bucket_id, name, owner, owner_id) values ('documentos', ${lit(name)}, ${lit(claims.sub)}, ${lit(claims.sub)})`);
    if (q.error) return json(400, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' });
    FILES.set(name, f); globalThis.UPLOADS = (globalThis.UPLOADS || 0) + 1;
    return json(200, { Key: 'documentos/' + name, Id: crypto.randomUUID() });
  }
  if ((mm = /^\/storage\/v1\/object\/sign\/documentos\/(.+)$/.exec(u.pathname)) && m === 'POST') {
    const name = decodeURIComponent(mm[1]);
    const q = asUser(claims, `select count(*) from storage.objects where bucket_id = 'documentos' and name = ${lit(name)}`);
    if (q.error || q.rows[q.rows.length - 1] !== '1') return json(400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
    return json(200, { signedURL: '/object/sign/documentos/' + encodeURIComponent(name).replace(/%2F/g, '/') + '?token=t' });
  }
  if ((mm = /^\/storage\/v1\/object\/sign\/documentos\/(.+)$/.exec(u.pathname)) && m === 'GET') {
    const f = FILES.get(decodeURIComponent(mm[1])); if (!f) return json(404, {});
    globalThis.SERVED = f.type;
    return r.fulfill({ status: 200, headers: { 'content-type': f.type }, body: f.buf });
  }
  return json(404, { message: 'mock: unknown storage call' });
}
let fails = 0; const check = (name, ok, extra) => { console.log((ok ? 'OK   ' : 'FALHA') + ' ' + name + (ok ? '' : ' :: ' + (extra || ''))); if (!ok) fails++; };

async function session(who) {
  const sub = USERS[who];
  const claims = { sub, aud: 'authenticated', role: 'authenticated', aal: 'aal2', amr: [{ method: 'totp', timestamp: 1 }], exp: 4102444800, session_id: 's1' };
  const token = sign(claims);
  const meta = { must_change_password: who === 'novo' };
  const user = { id: sub, aud: 'authenticated', role: 'authenticated', email: who + '@teste.local', user_metadata: meta,
    factors: [{ id: 'f1', factor_type: 'totp', status: 'verified', friendly_name: 'x', created_at: '2026-01-01', updated_at: '2026-01-01' }] };
  const br = await chromium.launch(); const ctx = await br.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, locale: 'pt-PT', timezoneId: 'Europe/Lisbon' });
  const pg = await ctx.newPage(); pg.on('pageerror', (e) => { console.log('  ERRO JS:', e.message); fails++; });
  pg.on('dialog', (d) => d.accept(pg._answer || 'Motivo de teste automático'));
  await ctx.route('https://hnowcydpmrwlqwsggcqx.supabase.co/**', async (r) => {
    const u = r.request().url();
    if (u.includes('/auth/v1/user') && r.request().method() === 'PUT') {
      const b = JSON.parse(r.request().postData() || '{}'); globalThis.PW_CHANGED = b;
      user.user_metadata = { ...user.user_metadata, ...(b.data || {}) }; return r.fulfill({ json: user }); }
    if (u.includes('/auth/v1/user')) return r.fulfill({ json: user });
    if (u.includes('/functions/v1/mini-criar-conta')) {
      const resp = await fetch('http://127.0.0.1:8000/', { method: r.request().method(), headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', origin: 'https://gestnowhq.github.io' }, body: r.request().postData() || undefined });
      return r.fulfill({ status: resp.status, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body: await resp.text() });
    }
    if (u.includes('/auth/v1/')) return r.fulfill({ json: {} });
    if (u.includes('/storage/v1/')) return storageRoute(r, claims);
    const local = u.replace('https://hnowcydpmrwlqwsggcqx.supabase.co/rest/v1', (process.env.REST || 'http://127.0.0.1:3300'));
    const headers = { ...r.request().headers(), authorization: 'Bearer ' + token }; delete headers.apikey; delete headers.host;
    const resp = await fetch(local, { method: r.request().method(), headers, body: r.request().postData() || undefined });
    const body = Buffer.from(await resp.arrayBuffer());
    if (resp.status >= 400) console.log('  api', resp.status, local.slice(22, 80), body.toString().slice(0, 160));
    return r.fulfill({ status: resp.status, headers: { 'content-type': resp.headers.get('content-type') || 'application/json', 'content-range': resp.headers.get('content-range') || '' }, body });
  });
  await pg.addInitScript((s) => { localStorage.setItem('sb-hnowcydpmrwlqwsggcqx-auth-token', JSON.stringify(s)); localStorage.setItem('gestnow.lastActive', String(Date.now())); window.GESTNOW_TEST = true; },
    { access_token: token, refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: 4102444800, user });
  await pg.goto('file://' + APP + '/index.html'); await pg.waitForTimeout(2500);
  return { br, pg };
}

module.exports = { session, check, asUser, USERS, get fails() { return fails; } };
