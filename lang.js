// GestNow · languages (v74, Diogo 2026-10-21: «qualquer pessoa ... escolher uma língua e a app traduzir»).
// The screens are written in Portuguese. lang/<code>.json maps each Portuguese text to its translation; this file swaps
// the texts on screen as they appear (text, placeholder, aria-label, title, alt), so every screen in the dictionary is
// translated without touching its code, and anything not yet translated stays in Portuguese (never blank).
//   «Exact text»            → exact match on the trimmed text
//   «Faltam {x} dias»       → pattern: {x} is any piece (a number, a name, a date); the translation uses {x} in the same
//                             order, or {1} {2} … to put them in another order
// Numbers alone are matched too: «3 dias» finds «{x} dias». Company content (induction videos, contracts, the safety bot)
// is not here: it is the company's text, in the company's language, and contracts are only valid in the legal language.
'use strict';
const LANGS = [
  { code: 'pt', name: 'Português', loc: 'pt-PT' },
  { code: 'fr', name: 'Français', loc: 'fr-FR' },
  { code: 'en', name: 'English', loc: 'en-GB' },
  { code: 'es', name: 'Español', loc: 'es-ES' },
  { code: 'ro', name: 'Română', loc: 'ro-RO' },
];
const LANG_KEY = 'gestnow.lang';
let LOC = 'pt-PT';   // the locale of dates and numbers on screen
const I18N = (() => {
  const st = { lang: 'pt', dict: null, pats: [], made: new Set(), missing: new Map(), collect: false };
  try { st.collect = localStorage.getItem('gestnow.i18n.collect') === '1'; } catch (_) {}
  const known = (c) => LANGS.some((l) => l.code === c);
  function pick() {
    let c = null; try { c = localStorage.getItem(LANG_KEY); } catch (_) {}
    if (known(c)) return c;
    for (const n of navigator.languages || [navigator.language || '']) { const b = String(n).slice(0, 2).toLowerCase(); if (known(b)) return b; }
    return 'pt';
  }
  const rx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function compile(dict) {
    // «{x} Sair da app»: when the {x} at an edge was an icon (an element, not text), the text node is just «Sair da app»
    for (const [k, v] of Object.entries(dict)) {
      let a = k, b = v;
      if (a.startsWith('{x}') && b.startsWith('{x}')) { a = a.slice(3).trimStart(); b = b.slice(3).trimStart(); }
      if (a.endsWith('{x}') && b.endsWith('{x}')) { a = a.slice(0, -3).trimEnd(); b = b.slice(0, -3).trimEnd(); }
      const n = (x) => (x.match(/\{(x|\d)\}/g) || []).length;
      if (a !== k && /\p{L}{2}/u.test(a) && n(a) === n(b) && !(a in dict)) dict[a] = b;
    }
    const pats = [];
    for (const [k, v] of Object.entries(dict)) {
      if (!/\{(x|\d)\}/.test(k)) continue;
      const parts = k.split(/\{x\}/);
      const lit = parts.reduce((a, b) => (b.length > a.length ? b : a), '');
      pats.push({ re: new RegExp('^' + parts.map(rx).join('([\\s\\S]+?)') + '$'), lit, v, n: parts.length - 1 });
    }
    return pats.sort((a, b) => b.lit.length - a.lit.length);   // the most specific first
  }
  const memo = new Map();   // text → translation (or null): a screen that refreshes asks the same texts again
  const fill = (v, vals) => { let i = 0; return v.replace(/\{(x|\d)\}/g, (_, d) => (d === 'x' ? vals[i++] : vals[+d - 1]) ?? ''); };
  // One text → its translation, or null. The pieces a pattern catches are translated too («falta a saída» inside a line).
  function find(core, depth = 0) {
    const d = st.dict; if (!d) return null;
    if (Object.prototype.hasOwnProperty.call(d, core)) return d[core];
    for (const p of st.pats) {
      if (p.lit && core.indexOf(p.lit) < 0) continue;
      const m = p.re.exec(core); if (!m) continue;
      const vals = m.slice(1).map((x) => (depth < 4 ? find(x.trim(), depth + 1) ?? x : x));
      return fill(p.v, vals);
    }
    if (depth > 3) return null;
    // «Passo 2 de 6 ·», «A obra inteira,»: the same text with its punctuation at the edges
    const e = /^([\s·•|,;:–—-]*)([\s\S]*?)([\s·•|,;:–—.-]*)$/.exec(core);
    if (e && (e[1] || e[3]) && e[2] && e[2] !== core) { const x = find(e[2], depth + 1); if (x != null) return e[1] + x + e[3]; }
    // «Horas (3)»: a count after the text
    const c = /^([\s\S]*?\p{L}[\s\S]*?)(\s*\(\d+\))$/u.exec(core);
    if (c) { const x = find(c[1], depth + 1); if (x != null) return x + c[2]; }
    // «Entrada · 12:53», «Ficha … em falta · Acolhimento … em falta»: each part on its own (names and numbers stay)
    if (core.includes(' · ')) {
      let any = false;
      const out = core.split(' · ').map((x) => { const y = find(x.trim(), depth + 1); if (y != null) { any = true; return y; } return x; });
      if (any) return out.join(' · ');
    }
    return null;
  }
  function tr(s) {
    if (st.lang === 'pt' && !st.collect) return s;
    const str = String(s ?? ''); const core = str.trim();
    if (!core || !/\p{L}{2}/u.test(core) || st.made.has(core)) return s;
    let out = memo.get(core);
    if (out === undefined) { out = find(core); if (memo.size > 20000) memo.clear(); memo.set(core, out); }
    if (out == null) { if (st.collect && !st.missing.has(core)) st.missing.set(core, (st.view || '') + ''); return s; }
    st.made.add(out.trim());
    return str.replace(core, out);
  }
  // For code that builds a line itself: t('Olá, {x}', name). Gives Portuguese when there is no translation.
  function t(key, ...vals) {
    const v = (st.dict && st.dict[key]) || key;
    const out = fill(v, vals.map((x) => String(x ?? '')));
    if (st.lang !== 'pt' || st.collect) st.made.add(out.trim());
    return out;
  }
  // ---- plurals (v79): the code writes «2 dia(s)», «1 pessoa(s)», «3 picagem(ns) guardada(s)»; the screen shows «2 dias»,
  // «1 pessoa», «3 picagens guardadas». Each marked word agrees with the last number before it in the same text, else
  // with the last number just before the text on screen («<b>2</b><span>obra(s) a decorrer</span>»), else plural.
  // «(a)» is gender, never touched. Unknown endings stay as written.
  const PL = /(\d[\d\u00a0\u202f .,]*\d|\d)|(\p{L}+)\((s|es|ns|m|aram|ões)\)/gu;
  const lastNum = (x) => { const m = String(x || '').match(/\d[\d\u00a0\u202f .,]*\d|\d/g); return m ? Number(m[m.length - 1].replace(/[^\d]/g, '')) : null; };
  function form(w, end, one) {
    if (one) return w;
    switch (end) {
      case 's': return w + 's';
      case 'es': return w === 'mês' ? 'meses' : w + 'es';
      case 'ns': return w.endsWith('m') ? w.slice(0, -1) + 'ns' : w + 'ns';
      case 'm': return w + 'm';
      case 'aram': return w.endsWith('ou') ? w.slice(0, -2) + 'aram' : w + 'aram';
      case 'ões': return w.endsWith('ão') ? w.slice(0, -2) + 'ões' : w + 'ões';
    }
    return w;
  }
  const singular = (n) => n != null && (n === 1 || (st.lang === 'fr' && n === 0));
  function plural(s, ctx) {
    if (!s || s.indexOf('(') < 0 || !/\p{L}\((s|es|ns|m|aram|ões)\)/u.test(s)) return s;
    let n = null; let first = true;
    return s.replace(PL, (all, num, w, end) => {
      if (num) { n = Number(num.replace(/[^\d]/g, '')); first = false; return all; }
      if (first && n == null) { n = ctx ? ctx() : null; first = false; }
      return form(w, end, singular(n));
    });
  }
  // the number on screen just before a text node: its earlier siblings, else its parent's earlier siblings
  function before(node) {
    for (let e = node, k = 0; e && k < 2; e = e.parentElement, k++) {
      let txt = ''; for (let p = e.previousSibling; p; p = p.previousSibling) txt = (p.textContent || '') + txt;
      const n = lastNum(txt); if (n != null) return n;
    }
    return null;
  }
  // ---- the screen
  const SKIP = new Set(['SCRIPT', 'STYLE', 'CODE', 'TEXTAREA', 'NOSCRIPT', 'svg', 'SVG']);
  const ATTRS = ['placeholder', 'aria-label', 'title', 'alt'];
  const seen = new WeakMap();   // text node → the text it got from the app and the text it now shows
  const skipEl = (el) => { for (let e = el; e && e !== document.body; e = e.parentElement) { if (SKIP.has(e.tagName) || (e.dataset && 'nt' in e.dataset) || e.isContentEditable) return true; } return false; };
  function doText(n) {
    const prev = seen.get(n);
    if (prev && n.data === prev.out) return;
    const src = n.data; const out = plural(tr(src), () => before(n));
    seen.set(n, { src, out });
    if (out !== src) n.data = out;
  }
  function doAttrs(el) {
    for (const a of ATTRS) {
      const v = el.getAttribute(a); if (!v) continue;
      const k = 'i18n' + a.replace(/-./g, (m) => m[1].toUpperCase());
      if (el[k] === v) continue;
      const out = plural(tr(v)); el[k] = out; if (out !== v) el.setAttribute(a, out);
    }
    if (el.tagName === 'INPUT' && (el.type === 'submit' || el.type === 'button') && el.value) { const out = tr(el.value); if (out !== el.value) el.value = out; }
  }
  function walk(root) {
    if (root.nodeType === 3) { if (!skipEl(root.parentElement)) doText(root); return; }
    if (root.nodeType !== 1 || skipEl(root)) return;
    doAttrs(root);
    const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.nodeType === 1 && (SKIP.has(n.tagName) || 'nt' in (n.dataset || {}) || n.isContentEditable) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
    for (let n = w.nextNode(); n; n = w.nextNode()) { if (n.nodeType === 3) doText(n); else doAttrs(n); }
  }
  let obs = null;
  function watch() {
    if (obs) return;
    obs = new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === 'characterData') { if (!skipEl(m.target.parentElement)) doText(m.target); }
        else if (m.type === 'attributes') { if (!skipEl(m.target)) doAttrs(m.target); }
        else m.addedNodes.forEach(walk);
      }
    });
    obs.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS.concat('value') });
    walk(document.body);
  }
  // Native boxes (confirm, alert, prompt) are not on the page: translate them line by line.
  for (const f of ['confirm', 'alert', 'prompt']) {
    const orig = window[f];
    window[f] = function (msg, ...rest) { return orig.call(window, String(msg ?? '').split('\n').map((l) => plural(tr(l))).join('\n'), ...rest); };
  }
  st.lang = pick();
  const meta = LANGS.find((l) => l.code === st.lang);
  LOC = meta.loc;
  document.documentElement.lang = meta.loc;
  const ready = (async () => {
    if (st.lang === 'pt') { st.dict = st.collect ? {} : null; watch(); return; }
    try {
      const r = await fetch(`lang/${st.lang}.json?v=106`);
      st.dict = r.ok ? await r.json() : {};
    } catch (_) { st.dict = {}; }
    st.pats = compile(st.dict);
    watch();
  })();
  // Choosing a language: kept on this phone at once and, with a login, on the account; the app starts again in it.
  function set(code, save) {
    if (!known(code)) return;
    try { localStorage.setItem(LANG_KEY, code); } catch (_) {}
    // a slow network never holds the change: the account is told within 2.5 s or on the next login
    Promise.race([Promise.resolve(save && save(code)), new Promise((r) => setTimeout(r, 2500))]).catch(() => {}).finally(() => location.reload());
  }
  // The account's language (from the database) wins over this phone's when they differ, once per login.
  function adopt(code) {
    if (!known(code) || code === st.lang) return false;
    try { if (sessionStorage.getItem('gestnow.lang.adopted') === code) return false; sessionStorage.setItem('gestnow.lang.adopted', code); localStorage.setItem(LANG_KEY, code); } catch (_) { return false; }
    location.reload(); return true;
  }
  return { ready, tr, t, plural, set, adopt, get lang() { return st.lang; }, missing: () => [...st.missing.keys()], st };
})();
const t = I18N.t;
