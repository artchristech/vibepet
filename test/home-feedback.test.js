// node --test test/home-feedback.test.js — the renderer's feedback on Home: a jump that fails says why in its row (Home and the
// pill) and leaves the queue alone, one that lands marks only its own row seen, an empty queue answers the key, one label
// everywhere, and the CSS that keeps bubbles above the panel. The real renderer/app.js runs in a vm context on a small fake
// DOM (no deps); markup is read back as strings.
const test = require('node:test');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'renderer', 'app.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'renderer', 'style.css'), 'utf8');

// ---------- CSS ----------
// rules as { media, sel: [selectors], decl: { prop: value } }; @media blocks one level deep
function rules(css) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  const walk = (s, media) => {
    let i = 0;
    while (i < s.length) {
      const open = s.indexOf('{', i); if (open < 0) break;
      const head = s.slice(i, open).trim();
      let depth = 1, j = open + 1;
      for (; j < s.length && depth; j++) depth += s[j] === '{' ? 1 : s[j] === '}' ? -1 : 0;
      const body = s.slice(open + 1, j - 1);
      if (head.startsWith('@media')) walk(body, head);
      else if (!head.startsWith('@')) out.push({ media: media || '', sel: head.split(',').map(x => x.trim()),
        decl: Object.fromEntries(body.split(';').map(d => d.split(/:(.*)/s).map(x => x && x.trim())).filter(d => d[0] && d[1] != null)) });
      i = j;
    }
  };
  walk(css);
  return out;
}
const R_ = rules(CSS), LIGHT = '@media (prefers-color-scheme: light)';
const value = (sel, prop, theme) => {   // the cascade's last word for one exact selector in a theme (light falls back to the base)
  const hit = R_.filter(r => r.sel.includes(sel) && prop in r.decl && (r.media === '' || (theme === 'light' && r.media === LIGHT)));
  return hit.length ? hit[hit.length - 1].decl[prop] : null;
};
const rgba = s => { const h = s.match(/^#([0-9a-f]{6})$/i); if (h) return [0, 2, 4].map(i => parseInt(h[1].slice(i, i + 2), 16)).concat(1);
  const m = s.match(/rgba?\(([^)]+)\)/); const p = m[1].split(',').map(Number); return [p[0], p[1], p[2], p[3] ?? 1]; };
const over = (fg, bg) => fg.slice(0, 3).map((c, i) => c * fg[3] + bg[i] * (1 - fg[3])).concat(1);
const lum = c => { const l = c.slice(0, 3).map(v => (v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2]; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('with Home open the bubble is a toast over the panel, pinned to its top edge and out of the flow', () => {
  const chatZ = +value('#chat', 'z-index');
  const toast = R_.find(r => r.sel.some(s => /#chat:not\(\.hidden\)\s*~\s*#bubble$/.test(s)) && r.decl.position);
  assert.ok(toast, 'a rule places the bubble while Home is open');
  assert.strictEqual(toast.decl.position, 'absolute');
  assert.ok(+toast.decl['z-index'] > chatZ, `toast z-index ${toast.decl['z-index']} over #chat's ${chatZ}`);
  assert.match(toast.decl.top, /anchor\(top\)/, 'pinned to the panel top');
});

// ---------- a fake page: every element exists, holds what's written to it, and does nothing else ----------
function fakeEl(id) {
  const cls = new Set();
  return {
    id, value: '', textContent: '', innerHTML: '', hidden: false, disabled: false, children: [], dataset: {},
    width: 224, height: 208, offsetTop: 0, offsetLeft: 0, offsetWidth: 0, offsetHeight: 0,
    style: { setProperty() {}, getPropertyValue: () => '' },
    classList: { add: (...c) => c.forEach(x => cls.add(x)), remove: (...c) => c.forEach(x => cls.delete(x)), contains: c => cls.has(c),
      toggle: (c, on = !cls.has(c)) => (on ? cls.add(c) : cls.delete(c), on) },
    get className() { return [...cls].join(' '); }, set className(v) { cls.clear(); String(v).split(/\s+/).filter(Boolean).forEach(x => cls.add(x)); },
    addEventListener() {}, removeEventListener() {}, setPointerCapture() {}, focus() {}, select() {}, contains: () => false, closest: () => null,
    querySelector: () => null, querySelectorAll: () => [], insertAdjacentHTML(_, h) { this.innerHTML += h; },
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }),
    getContext: () => new Proxy({}, { get: () => () => ({ data: [0, 0, 0, 0] }) }),
  };
}
function renderer({ jump } = {}) {
  const els = new Map(), on = {}, calls = { jump: [] };
  const document = { getElementById: id => els.get(id) || (els.set(id, fakeEl(id)), els.get(id)), addEventListener() {}, activeElement: null,
    documentElement: { style: { setProperty() {}, getPropertyValue: () => '' } }, createElement: () => fakeEl(), elementFromPoint: () => null };
  const api = new Proxy({
    on: (ch, fn) => (on[ch] ||= []).push(fn),
    jump: async id => { calls.jump.push(id); return jump ? jump(id) : { ok: false }; },
    theater() {},
  }, { get: (t, k) => k in t ? t[k] : () => undefined });
  const unref = f => (...a) => { const t = f(...a); t?.unref?.(); return t; };
  const ctx = vm.createContext({
    document, console, performance, Date, Math, JSON, Map, Set, Promise, Proxy, Symbol, Array, Object, String, Number, RegExp,
    setTimeout: unref(setTimeout), setInterval: unref(setInterval), clearTimeout, clearInterval,
    requestAnimationFrame: () => 0, matchMedia: () => ({ matches: false, addEventListener() {} }), addEventListener() {},
    OUT: '#1b1f2e', status: () => ({ h: '#fff', glow: false }),   // site/sprites.js globals app.js reads at load
  });
  ctx.window = ctx; ctx.window.pet = api;
  vm.runInContext(APP, ctx, { filename: 'renderer/app.js' });
  vm.runInContext('globalThis.__shown = []; { const s = show; show = o => { __shown.push(o); s(o); }; }', ctx);
  const R = {
    els, calls, ctx,
    run: code => vm.runInContext(code, ctx),
    emit: (ch, d) => (on[ch] || []).forEach(f => f(d)),
    shown: () => vm.runInContext('__shown', ctx),
    pending: () => vm.runInContext('pending().map(a => a.name)', ctx),
    tick: agents => R.emit('tick', { agents, setupDone: true, name: 'Net', level: 1, xp: 0, xpLo: 0, xpHi: 100, fuel: 80, mood: 80, muted: true, rec: {}, servers: [] }),
    home: () => { R.run('chatOpen = true; renderHome()'); return els.get('now').innerHTML; },
  };
  return R;
}
// one row's markup out of Home (#now) or the pill (#roster), and its text
const homeRow = (html, id) => (html.split('<div class="nr ').find(r => r.includes(`data-id="${id}"`)) || '');
const pillRow = (html, id) => (html.split('<button ').find(r => r.startsWith(`data-id="${id}"`)) || '');
const text = h => h.replace(/^[^<]*>/, '').replace(/<[^>]*>/g, ' ').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const first = (h, re) => (h.match(re) || [, null])[1];

const M = 60e3, now = Date.now();
const FLEET = () => [   // the fixture fleet as it holds: two need you, three are done (delta after a 3-subagent fan-out), one is untitled
  { id: 'k', name: 'kestrel', title: 'Deploy.sh dry run', phase: 'stalled', kind: 'approval', since: now - 38 * M, ask: 'Bash: ./deploy.sh --dry-run', goal: { text: 'Run the dry run', auto: true } },
  { id: 'b', name: 'beacon', title: 'Beacon database choice', phase: 'waiting', kind: 'question', since: now - 20 * M, ask: 'Which database? (SQLite / Postgres / Redis)' },
  { id: 'd', name: 'delta', title: 'Reconcile three shards', phase: 'ready', kind: 'done', since: now - 9 * M,
    fanout: { total: 3, done: 3, open: 0, stuck: 0, oldestOpenAt: null, items: [{ desc: 'shard-1', open: false }, { desc: 'shard-2', open: false }, { desc: 'shard-3', open: false }] } },
  { id: 'a', name: 'atlas', title: 'Run build.sh', phase: 'ready', kind: 'done', since: now - 7 * M },
  { id: 'v', name: 'vibepet', phase: 'ready', kind: 'done', since: now - 3 * M, goal: { text: 'Say what this project is', auto: true } },
];

test('a jump that fails leaves the queue as it was and says why in its row, in the pill and in the bubble', async () => {
  const R = renderer({ jump: () => ({ ok: false, why: 'no terminal is attached to tmux session vp-kestrel', attach: 'tmux attach -t vp-kestrel' }) });
  R.tick(FLEET());
  R.home();
  const before = R.pending();
  assert.deepStrictEqual(before, ['kestrel', 'beacon', 'delta', 'atlas', 'vibepet']);
  await R.run("jumpTo(snap.agents.find(a => a.name === 'kestrel'))");
  assert.deepStrictEqual(R.calls.jump, ['k']);
  assert.deepStrictEqual(R.pending(), before, 'a failed jump marks nothing seen: the done rows stay in the jump walk');
  const why = 'no terminal is attached to tmux session vp-kestrel — tmux attach -t vp-kestrel';
  assert.strictEqual(first(homeRow(R.els.get('now').innerHTML, 'k'), /<small class="nnote err">([^<]*)<\/small>/), why, 'the reason shows in its Home row');
  assert.strictEqual(first(pillRow(R.els.get('roster').innerHTML, 'k'), /<small class="nnote err">([^<]*)<\/small>/), why, 'and in its pill row');
  assert.ok(!homeRow(R.els.get('now').innerHTML, 'b').includes('nnote'), 'only in that row');
  const last = R.shown().at(-1);
  assert.strictEqual(last.text, 'Deploy.sh dry run · kestrel: no terminal is attached to tmux session vp-kestrel', 'the bubble names it by the one label');
  assert.strictEqual(last.quiet, true);
  // the note goes when its time is up (6 s; here: its deadline moved into the past, then a redraw)
  R.run("notes.get('k').until = Date.now() - 1; renderHome(); renderRoster()");
  assert.ok(!R.els.get('now').innerHTML.includes('nnote') && !R.els.get('roster').innerHTML.includes('nnote'));
});

test("a jump that lands marks only that session seen; an exited session's resume command is said as main says it", async () => {
  const R = renderer({ jump: id => id === 'v' ? { ok: false, cmd: 'cd x && claude --resume v', why: 'vibepet has exited: resume command copied' } : { ok: true, level: 'pane' } });
  R.tick(FLEET());
  await R.run("jumpTo(snap.agents.find(a => a.name === 'delta'))");
  assert.deepStrictEqual(R.pending(), ['kestrel', 'beacon', 'atlas', 'vibepet'], 'delta seen; atlas and vibepet still unread');
  await R.run("jumpTo(snap.agents.find(a => a.name === 'vibepet'))");
  assert.strictEqual(R.shown().at(-1).text, 'vibepet: vibepet has exited: resume command copied', 'an untitled session is its folder, once');
  assert.deepStrictEqual(R.pending(), ['kestrel', 'beacon', 'atlas', 'vibepet']);
});

test("the jump key with nobody waiting answers once per press, quietly; with someone waiting it jumps there", async () => {
  const R = renderer({ jump: () => ({ ok: true }) });
  R.tick([{ id: 'w', name: 'ember', phase: 'working', kind: 'running', since: now - M }]);
  assert.deepStrictEqual(R.pending(), []);
  R.emit('hotkey'); R.emit('hotkey');
  const said = R.shown().filter(o => o.text === "Nobody's waiting on you");
  assert.strictEqual(said.length, 2, 'one line a press');
  assert.ok(said.every(o => o.quiet), 'no sound');
  assert.deepStrictEqual(R.calls.jump, []);
  R.tick(FLEET());
  R.emit('hotkey');
  assert.deepStrictEqual(R.calls.jump, ['k'], 'first in line');
});
