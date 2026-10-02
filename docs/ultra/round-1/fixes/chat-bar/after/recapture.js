#!/usr/bin/env node
// chat-bar recapture: the real vibepet from the chat-bar worktree, watching the isolated fleet root, chatting on the
// user's own Claude login (claude-haiku-4-5) or against fault injection at the network boundary. Every real send is
// counted in sends.jsonl (≤ 40). Main is instrumented: the clipboard and shell.openExternal only record; what the engine
// writes to claude's stdin is recorded (for "What Net sees" = the exact context). uptime beside every timing.
//   node recapture.js <phase>     phases: main | model | sonnet | faults | noengine
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), https = require('https');
const { execSync } = require('child_process');
const WT = '/Users/christopherharris/.vibepet-ultra/wt/r1-chat-bar', HERE = __dirname, ULTRA = path.join(os.homedir(), '.vibepet-ultra');
for (const k of Object.keys(process.env)) if (/^CLAUDE(CODE$|_CODE_|_PID$|_EFFORT$)/.test(k)) delete process.env[k];   // nothing of this session leaks into the app's claude
const { launch } = require(WT + '/test/ultra/launch');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const uptime = () => execSync('uptime').toString().trim().replace(/^.*load averages?: /, 'load ');
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.ceil(p / 100 * s.length) - 1)] : null; };
const stat = a => ({ n: a.length, p50: pct(a, 50), p95: pct(a, 95), min: Math.min(...a), max: Math.max(...a) });
const SENDS = path.join(HERE, 'sends.jsonl');
const sent = (phase, what) => fs.appendFileSync(SENDS, JSON.stringify({ at: new Date().toISOString(), phase, what }) + '\n');
const sendsSoFar = () => { try { return fs.readFileSync(SENDS, 'utf8').trim().split('\n').filter(Boolean).length; } catch { return 0; } };
const STATE = { setupDone: true, muted: true, model: 'claude-haiku-4-5', engine: 'claude', animations: false, game: false, hotkey: null, keyEnc: null };

async function boot(name, { state = {}, env = {}, fresh = true } = {}) {
  const ud = path.join(ULTRA, 'userdata', name);
  if (fresh) fs.rmSync(ud, { recursive: true, force: true });
  const v = await launch({ appDir: WT, root: path.join(ULTRA, 'root', '.claude'), userData: ud, state: { ...STATE, ...state }, env: { ANTHROPIC_API_KEY: '', ...env } });
  v.errors = [];
  v.win.on('pageerror', e => v.errors.push('pageerror ' + e.message));
  v.win.on('console', m => { if (m.type() === 'error') v.errors.push(m.text().slice(0, 300)); });
  await v.evalMain(({ clipboard, shell }) => {
    const G = globalThis.__rc = { clip: [], open: [], writes: [] };
    clipboard.writeText = t => G.clip.push(String(t));
    shell.openExternal = async u => G.open.push(String(u));
    const W = globalThis.__vibepet.require('./chat-engine').Warm, write = W.prototype.write;
    W.prototype.write = function (o) { G.writes.push({ at: Date.now(), pid: this.p?.pid ?? null, type: o.type, sub: o.request?.subtype, model: o.request?.model, text: o.message?.content?.[0]?.text }); return write.call(this, o); };
  });
  await instrument(v.win);
  return v;
}
// in the page: per send, Enter → user bubble + live indicator → first visible model text → end; every #msgs mutation
async function instrument(W) {
  await W.evaluate(() => {
    if (window.__t) return;
    const T = window.__t = { sends: [], acks: [] }, msgs = document.getElementById('msgs');
    document.getElementById('chatInput').addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey && !e.metaKey) T.sends.push({ enter: performance.now(), users: msgs.querySelectorAll('.msg.user').length, muts: [] });
    }, true);
    new MutationObserver(() => {
      const s = T.sends[T.sends.length - 1], now = performance.now(); if (!s) return;
      if (!s.bubble && msgs.querySelectorAll('.msg.user').length > s.users && msgs.querySelector('.msg.pet.live .st .think')) s.bubble = now;
      const md = msgs.querySelector('.msg.pet.live > .md');
      if (s.bubble && !s.first && md && md.textContent.trim()) s.first = now;
      if (s.first && !s.end) { s.muts.push(now); if (!msgs.querySelector('.msg.pet.live')) s.end = now; }
    }).observe(msgs, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] });
    window.pet.on('chat-ev', e => { if (e.t === 'stopped' || e.t === 'done' || e.t === 'error') T.acks.push({ t: e.t, id: e.id, at: performance.now(), kind: e.kind }); });
  });
}
const lastSend = W => W.evaluate(() => { const s = window.__t.sends.at(-1); return s && { ...s, muts: s.muts.length, span: s.end && s.first ? s.end - s.first : null }; });
const idle = W => W.waitForFunction(() => !document.querySelector('#msgs .msg.pet.live'), null, { timeout: 120e3 });
const lastReply = W => W.evaluate(() => { const m = [...document.querySelectorAll('#msgs .msg.pet:not(.note)')].filter(x => x.dataset.id !== 'noengine').pop(); return m && { cls: m.className, text: m.querySelector(':scope > .md')?.textContent || '', say: m.querySelector(':scope > .st .say')?.textContent || null, acts: [...m.querySelectorAll(':scope > .st button')].map(b => b.textContent), sees: m.querySelector('.sees summary')?.textContent || null }; });
async function ask(v, phase, text, { real = true, before } = {}) {
  const W = v.win;
  await W.locator('#chatInput').fill(text);
  const load = uptime();
  await W.locator('#chatInput').press('Enter');
  if (before) await before();
  await idle(W);
  if (real) sent(phase, text.slice(0, 60));
  const s = await lastSend(W), r = await lastReply(W);
  return { q: text, load, bubbleMs: s.bubble - s.enter, firstMs: s.first ? s.first - s.enter : null, streamMs: s.span, muts: s.muts, mutPerSec: s.span ? +(s.muts / (s.span / 1000)).toFixed(1) : null, reply: r };
}
const write = (dir, name, obj) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, name), JSON.stringify(obj, null, 2)); };

// ---------------------------------------------------------------- main: (a) (c) (d) (g) (h) (i)
async function main() {
  const D = path.join(HERE, 'main'), R = { startedAt: new Date().toISOString(), loadStart: uptime(), turns: [], stops: [] };
  let v = await boot('r1-chat-bar');
  const W = () => v.win;
  try {
    await v.openHome(); await sleep(3000);   // a person reads Home a moment; the warm claude spawned when the panel opened
    R.warmPid = await v.evalMain(() => globalThis.__vibepetChat.warmPid());
    await v.shot(path.join(D, '01-open.png'));
    const Q = ['Which of my sessions needs me first, and why?', 'What is kestrel waiting for?',
      'Reply with a short bulleted list naming two of my sessions, one markdown link to https://vibepet.net, and a ```bash code block containing ./deploy.sh --dry-run.',
      'What did delta finish?', null /* quick ask chip */, 'Summarize beacon\'s question in one sentence.', 'Which repo am I watching, and is anything uncommitted?',
      'Give me one concrete next step, in two sentences.', 'How long has kestrel been waiting?', 'Should I approve kestrel\'s command? Two sentences.',
      'What is atlas doing?', 'Thanks. Anything else I should know? Two sentences.'];
    for (let i = 0; i < Q.length; i++) {
      let t;
      if (Q[i] === null) {   // a quick ask: its label shows, its long prompt goes out
        const load = uptime();
        await W().evaluate(() => { window.__t.sends.push({ enter: performance.now(), users: document.querySelectorAll('#msgs .msg.user').length, muts: [] }); });
        await W().locator('#chips button[data-mode=agent]').click();
        await idle(W()); sent('main', 'chip: agent');
        const s = await lastSend(W());
        t = { q: '[chip] What\'s my agent doing?', load, bubbleMs: s.bubble - s.enter, firstMs: s.first - s.enter, streamMs: s.span, muts: s.muts, mutPerSec: s.span ? +(s.muts / (s.span / 1000)).toFixed(1) : null, reply: await lastReply(W()) };
      } else if (i === 6) {   // (h) scrolled up 200 px while the reply streams in
        let up = null;
        t = await ask(v, 'main', Q[i], { before: async () => { up = await W().evaluate(() => { const m = document.getElementById('msgs'); m.scrollTop = m.scrollHeight - m.clientHeight - 200; return { top: m.scrollTop, max: m.scrollHeight - m.clientHeight }; }); await sleep(30); await v.shot(path.join(D, '07a-scrolled-up.png')); } });
        R.scroll = { ...up, after: await W().evaluate(() => document.getElementById('msgs').scrollTop), pill: await W().evaluate(() => !document.getElementById('newPill').classList.contains('hidden')) };
        await v.shot(path.join(D, '07b-new-pill.png'));
        await W().locator('#newPill').click(); await sleep(200);
      } else t = await ask(v, 'main', Q[i]);
      t.turn = i + 1; R.turns.push(t);
      console.log(`turn ${t.turn}: bubble ${t.bubbleMs?.toFixed(1)} ms, first ${t.firstMs?.toFixed(0)} ms, ${t.mutPerSec}/s (${t.load})`);
      if (i === 2) {   // (h) markdown
        R.markdown = await W().evaluate(() => { const m = [...document.querySelectorAll('#msgs .msg.pet:not(.note)')].pop(); return { ul: !!m.querySelector('.md ul'), li: m.querySelectorAll('.md li').length, a: m.querySelector('.md a')?.dataset.href || null, lang: m.querySelector('.md pre .lang')?.textContent || null, copy: !!m.querySelector('.md pre .copy'), html: m.querySelector('.md').innerHTML.slice(0, 1500) }; });
        await W().evaluate(() => [...document.querySelectorAll('#msgs .msg.pet:not(.note)')].pop().scrollIntoView({ block: 'end' }));
        await v.shot(path.join(D, '03-markdown.png'));
      }
      await sleep(1200);   // reading the answer
    }
    R.chatTurns = await v.evalMain(() => globalThis.__vibepetChat.turns);
    R.pidsUsed = [...new Set((await v.evalMain(() => globalThis.__rc.writes)).filter(w => w.type === 'user').map(w => w.pid))];
    await v.shot(path.join(D, '12-conversation.png'));

    // (i) What Net sees = the exact context of the last turn: the disclosure vs what went into claude's stdin
    const sees = await W().evaluate(() => { const m = [...document.querySelectorAll('#msgs .msg.pet:not(.note)')].pop(); const d = m.querySelector('.sees'); d.open = true; return { summary: d.querySelector('summary').textContent, ctx: d.querySelector('pre').textContent }; });
    const lastIn = (await v.evalMain(() => globalThis.__rc.writes)).filter(w => w.type === 'user').pop();
    R.sees = { summary: sees.summary, exact: lastIn.text.endsWith(`${sees.ctx}\n\n${Q[11]}`), ctxChars: sees.ctx.length, stdinChars: lastIn.text.length, ctx: sees.ctx };
    await sleep(200);
    await W().evaluate(() => document.querySelector('#msgs .msg.pet:not(.note):last-of-type .sees')?.scrollIntoView({ block: 'end' }));
    await W().evaluate(() => [...document.querySelectorAll('#msgs .msg.pet:not(.note)')].pop().querySelector('.sees').scrollIntoView({ block: 'end' }));
    await v.shot(path.join(D, '13-what-net-sees.png'));
    await W().evaluate(() => { [...document.querySelectorAll('#msgs .sees')].forEach(d => { d.open = false; }); });

    // (h) composer keys
    const C = W().locator('#chatInput');
    await C.fill(''); await C.type('first line'); await W().keyboard.press('Shift+Enter'); await C.type('second line');
    R.keys = { shiftEnter: await W().evaluate(() => ({ value: document.getElementById('chatInput').value, height: document.getElementById('chatInput').offsetHeight, users: document.querySelectorAll('#msgs .msg.user').length })) };
    await v.shot(path.join(D, '14-shift-enter.png'));
    await C.fill(''); await C.press('ArrowUp'); R.keys.up = await C.inputValue();
    await C.fill(''); await W().keyboard.press('Meta+Shift+C'); await sleep(100);
    R.keys.copyLast = await v.evalMain(() => globalThis.__rc.clip.slice());
    await W().keyboard.press('Meta+k'); await sleep(100);
    R.keys.cmdK = await W().evaluate(() => ({ value: document.getElementById('chatInput').value, slashMenu: !document.getElementById('slash').classList.contains('hidden'), items: document.querySelectorAll('#slash [data-cmd]').length }));
    await v.shot(path.join(D, '15-cmd-k.png'));
    await C.fill(''); await C.dispatchEvent('input');

    // (d) Esc while streaming: 10 stops; the first with a second message queued during the reply
    for (let k = 0; k < 10; k++) {
      const pid0 = await v.evalMain(() => globalThis.__vibepetChat.warmPid());
      await C.fill(`Write about 250 words on keeping five coding agents from editing the same file (take ${k + 1}).`);
      const load = uptime();
      await C.press('Enter'); sent('main', `stop trial ${k + 1}`);
      await W().waitForFunction(() => (document.querySelector('#msgs .msg.pet.live > .md')?.textContent || '').trim().length > 0, null, { timeout: 60e3 });
      if (k === 0) {
        await C.fill('And in one sentence: which file is most at risk?'); await C.press('Enter');
        R.queued = await W().evaluate(() => { const u = [...document.querySelectorAll('#msgs .msg.user')].pop(); return { cls: u.className, tag: u.querySelector('.tag')?.textContent }; });
        await v.shot(path.join(D, '16-queued.png'));
      }
      // the user's Esc: a real key press; its keydown timeStamp → the reply marked stopped (both on the page's clock)
      await W().evaluate(() => {
        const msgs = document.getElementById('msgs'), live = msgs.querySelector('.msg.pet.live'), S = window.__stop = { id: live.dataset.id, chars: live.querySelector('.md').textContent.length, acks0: window.__t.acks.length, after: 0 };
        window.addEventListener('keydown', e => { if (e.key === 'Escape') S.key = e.timeStamp; }, { capture: true, once: true });
        new MutationObserver((_, mo) => { const el = msgs.querySelector(`.msg[data-id="${S.id}"]`); if (!S.ui && el?.classList.contains('stopped')) S.ui = performance.now(); else if (S.ui) S.after++; }).observe(live, { childList: true, subtree: true, characterData: true, attributes: true });
      });
      await W().keyboard.press('Escape');
      await sleep(1500);
      const r = await W().evaluate(() => {
        const S = window.__stop, ack = window.__t.acks.slice(S.acks0).find(a => a.t === 'stopped'), el = document.querySelector(`#msgs .msg[data-id="${S.id}"]`);
        return { uiMs: S.ui && S.key ? S.ui - S.key : null, ackMs: ack && S.key ? ack.at - S.key : null, charsAtStop: S.chars, mutationsAfterStop: S.after, tag: el?.querySelector('.tag')?.textContent, open: !document.getElementById('chat').classList.contains('hidden') };
      });
      r.pidBefore = pid0; r.pidAfter = await v.evalMain(() => globalThis.__vibepetChat.warmPid()); r.load = load;
      if (k === 0) { await v.shot(path.join(D, '17-stopped.png')); await idle(W()); sent('main', 'queued message answered'); R.queuedAnswer = await lastReply(W()); await v.shot(path.join(D, '18-queued-answered.png')); }
      R.stops.push(r);
      console.log(`stop ${k + 1}: ui ${r.uiMs?.toFixed(1)} ms, engine ack ${r.ackMs?.toFixed(0)} ms, pid ${r.pidBefore}→${r.pidAfter} (${load})`);
      await idle(W()); await sleep(600);
    }

    // (g) persistence: leave the view mid-conversation, quit, relaunch on the same userData
    R.beforeQuit = await W().evaluate(() => { const m = document.getElementById('msgs'); m.scrollTop = Math.round((m.scrollHeight - m.clientHeight) * 0.4); return { top: m.scrollTop, msgs: m.querySelectorAll('.msg').length, users: [...m.querySelectorAll('.msg.user')].map(e => e.textContent.slice(0, 40)), code: m.querySelectorAll('pre code').length }; });
    await sleep(1000); await v.shot(path.join(D, '19-before-quit.png'));
    R.close1 = await v.close();
    v = await boot('r1-chat-bar', { fresh: false });
    await v.openHome(); await sleep(1200);
    R.afterRelaunch = await W().evaluate(() => { const m = document.getElementById('msgs'); return { top: m.scrollTop, msgs: m.querySelectorAll('.msg').length, users: [...m.querySelectorAll('.msg.user')].map(e => e.textContent.slice(0, 40)), code: m.querySelectorAll('pre code').length, label: [...m.querySelectorAll('.msg.user')].map(e => e.textContent).find(t => /my agent doing/.test(t)) || null }; });
    await v.shot(path.join(D, '20-after-relaunch.png'));
    // ⌘N, the list, search, Clear
    await W().keyboard.press('Meta+n'); await sleep(400);
    R.newChat = await W().evaluate(() => ({ msgs: document.querySelectorAll('#msgs .msg').length, fresh: document.getElementById('chat').classList.contains('fresh'), chips: [...document.querySelectorAll('#chips button')].filter(b => b.offsetParent).length }));
    await v.shot(path.join(D, '21-new-chat.png'));
    await W().locator('#chatHistBtn').click(); await sleep(400);
    R.history = await W().evaluate(() => ({ items: [...document.querySelectorAll('#histList button')].map(b => b.textContent), keep: document.getElementById('histKeep').textContent }));
    const t0 = Date.now(); await W().locator('#histQ').fill('deploy.sh'); await W().waitForFunction(() => document.querySelectorAll('#histList button').length >= 1, null, { timeout: 3000 });
    R.search = { q: 'deploy.sh', ms: Date.now() - t0, items: await W().evaluate(() => [...document.querySelectorAll('#histList button b')].map(b => b.textContent)) };
    await W().locator('#histQ').fill('zebra-not-said'); await sleep(300);
    R.searchMiss = await W().evaluate(() => document.querySelector('#histList')?.textContent);
    await W().locator('#histQ').fill(''); await sleep(300);
    await v.shot(path.join(D, '22-history.png'));
    await W().locator('#histClear').click(); await v.shot(path.join(D, '23-clear-confirm.png')); await W().locator('#histClear').click(); await sleep(500);
    R.cleared = await W().evaluate(() => ({ items: document.querySelectorAll('#histList button').length, text: document.getElementById('histList').textContent }));
    R.clearedOnDisk = (() => { try { return JSON.parse(fs.readFileSync(path.join(ULTRA, 'userdata', 'r1-chat-bar', 'chats.json'), 'utf8')).chats.length; } catch (e) { return e.message; } })();
    await v.shot(path.join(D, '24-cleared.png'));
  } finally {
    R.errors = v.errors; R.close = await v.close().catch(e => e.message); R.loadEnd = uptime(); R.sends = sendsSoFar();
    const T = R.turns;
    R.summary = {
      firstTokenMs: stat(T.map(t => t.firstMs).filter(x => x != null)), bubbleMs: stat(T.map(t => t.bubbleMs).filter(x => x != null)),
      mutationsPerSec: stat(T.map(t => t.mutPerSec).filter(x => x != null)),
      stopUiMs: stat(R.stops.map(s => s.uiMs).filter(x => x != null)), stopEngineAckMs: stat(R.stops.map(s => s.ackMs).filter(x => x != null)),
      stopReusedProcess: R.stops.filter(s => s.pidBefore && s.pidBefore === s.pidAfter).length + '/' + R.stops.length,
      cache: (R.chatTurns || []).map((c, i) => ({ turn: i + 1, input: c.usage.input, read: c.usage.read, write: c.usage.write, readPct: c.usage.input ? Math.round(100 * c.usage.read / c.usage.input) : 0, first: c.ms.first, model: c.model })),
    };
    write(D, 'main.json', R);
    console.log(JSON.stringify(R.summary, null, 1));
  }
}

// ---------------------------------------------------------------- model: (b)
async function model() {
  const D = path.join(HERE, 'model'), R = { loadStart: uptime() };
  const v = await boot('r1-chat-bar-model', { state: { model: 'claude-unavailable-model-x' } });
  try {
    await v.openHome(); await sleep(3000);
    R.t1 = await ask(v, 'model', 'Say hi in five words.');
    R.note1 = await v.win.evaluate(() => [...document.querySelectorAll('#msgs .msg.note')].map(n => n.textContent));
    await v.shot(path.join(D, '01-first-send-note.png'));
    await sleep(1500);
    R.t2 = await ask(v, 'model', 'And now in three words.');
    R.notesAfter2 = await v.win.evaluate(() => [...document.querySelectorAll('#msgs .msg.note')].map(n => n.textContent));
    await v.shot(path.join(D, '02-second-send.png'));
    R.writes = (await v.evalMain(() => globalThis.__rc.writes)).map(w => ({ at: w.at, pid: w.pid, type: w.type, sub: w.sub, model: w.model, chars: w.text?.length }));
    R.chatTurns = await v.evalMain(() => globalThis.__vibepetChat.turns);
    // what went to claude, in order: the first send = the message, set_model (its one extra round trip), the message again;
    // the second send = the message only, to the same process
    R.verdict = { seq: R.writes.map(w => w.sub || w.type), pids: [...new Set(R.writes.map(w => w.pid))] };
  } finally { R.errors = v.errors; R.close = await v.close(); R.loadEnd = uptime(); R.sends = sendsSoFar(); write(D, 'model.json', R); console.log(JSON.stringify({ t1: R.t1, t2: R.t2, note: R.note1, verdict: R.verdict }, null, 1)); }
}

// ---------------------------------------------------------------- sonnet: (c) where the model's cache minimum lets a short chat cache
async function sonnet() {
  const D = path.join(HERE, 'sonnet'), R = { loadStart: uptime(), turns: [] };
  const v = await boot('r1-chat-bar-sonnet', { state: { model: 'claude-sonnet-5' } });
  try {
    await v.openHome(); await sleep(3000);
    for (const q of ['Which of my sessions needs me first?', 'What is kestrel waiting for?', 'What did delta finish?', 'Is anything running right now?', 'One concrete next step?']) { R.turns.push(await ask(v, 'sonnet', q)); await sleep(800); }
    R.chatTurns = await v.evalMain(() => globalThis.__vibepetChat.turns);
    await v.shot(path.join(D, '01-five-turns.png'));
    await v.win.evaluate(() => { const d = [...document.querySelectorAll('#msgs .msg.pet:not(.note)')].pop().querySelector('.sees'); d.open = true; d.querySelector('summary').scrollIntoView({ block: 'start' }); });
    await sleep(300); await v.shot(path.join(D, '02-what-net-sees.png'));
  } finally {
    R.errors = v.errors; R.close = await v.close(); R.loadEnd = uptime(); R.sends = sendsSoFar();
    R.cache = (R.chatTurns || []).map((c, i) => ({ turn: i + 1, input: c.usage.input, read: c.usage.read, write: c.usage.write, readPct: c.usage.input ? Math.round(100 * c.usage.read / c.usage.input) : 0, model: c.model }));
    write(D, 'sonnet.json', R); console.log(JSON.stringify(R.cache, null, 1));
  }
}

// ---------------------------------------------------------------- faults: (e) offline, 429, a rejected key (+ an expired login)
function fake(status, extra = {}) {   // the network boundary: a local endpoint answering every POST with one error
  const hits = [];
  const s = http.createServer((q, r) => {
    hits.push({ t: Date.now(), m: q.method, p: q.url.split('?')[0] }); q.resume();
    if (q.method === 'HEAD') { r.writeHead(200); return r.end(); }
    const body = { 429: { type: 'rate_limit_error', message: 'Number of request tokens has exceeded your per-minute rate limit' }, 401: { type: 'authentication_error', message: 'invalid x-api-key' } }[status];
    r.writeHead(status, { 'content-type': 'application/json', ...extra }); r.end(JSON.stringify({ type: 'error', error: body }));
  });
  return new Promise(res => s.listen(0, '127.0.0.1', () => res({ s, hits, url: `http://127.0.0.1:${s.address().port}` })));
}
function proxy(port) {   // the network back: a pass-through to the real API (headers forwarded, never logged)
  const hits = [];
  const s = http.createServer((q, r) => {
    hits.push({ t: Date.now(), m: q.method, p: q.url.split('?')[0] });
    const up = https.request({ host: 'api.anthropic.com', port: 443, method: q.method, path: q.url, headers: { ...q.headers, host: 'api.anthropic.com' } }, u => { r.writeHead(u.statusCode, u.headers); u.pipe(r); });
    up.on('error', () => { r.writeHead(502); r.end(); });
    q.pipe(up);
  });
  return new Promise(res => s.listen(port, '127.0.0.1', () => res({ s, hits })));
}
const freePort = () => new Promise(r => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
async function faults(steps = ['offline', 'recover', 'rate', 'badkey', 'login']) {
  const D = path.join(HERE, 'faults'), R = { loadStart: uptime() };
  const save = (k, extra = {}) => write(D, `${k}.json`, { load: { start: R.loadStart, end: uptime() }, ...extra, data: R[k] });
  let v;
  // offline at http://127.0.0.1:9: the copy within 3 s, n = 10 (each one cancelled, so the next is the one in flight)
  if (steps.includes('offline')) {
  v = await boot('r1-chat-bar-offline', { env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:9' } });
  try {
    await v.openHome(); await sleep(3000);
    R.offline = [];
    for (let k = 0; k < 10; k++) {
      await v.win.locator('#chatInput').fill(`are you there? (${k + 1})`);
      const load = uptime(), t0 = Date.now();
      await v.win.locator('#chatInput').press('Enter');
      await v.win.waitForFunction(() => /You're offline/.test(document.querySelector('#msgs .msg.pet.live .st .say')?.textContent || ''), null, { timeout: 15e3 });
      const ms = Date.now() - t0, card = await lastReply(v.win);
      if (k === 0) await v.shot(path.join(D, '01-offline-copy.png'));
      await v.win.locator('#msgs .msg.pet.live .st button[data-act=cancel]').click(); await sleep(400);
      const user = await v.win.evaluate(() => { const u = [...document.querySelectorAll('#msgs .msg.user')].pop(); return { cls: u.className, text: u.firstChild.textContent, retry: !!u.querySelector('.redo') }; });
      R.offline.push({ ms, load, say: card.say, acts: card.acts, user });
      console.log(`offline ${k + 1}: ${ms} ms (${load})`);
    }
    await v.shot(path.join(D, '02-offline-cancelled-retryable.png'));
  } finally { R.offlineErrors = v.errors; R.offlineClose = await v.close(); }
  save('offline', { stat: stat(R.offline.map(x => x.ms)), errors: R.offlineErrors, close: R.offlineClose });
  }
  // offline, then back: nothing on port P, then a pass-through proxy comes up there; the waiting message goes out
  if (steps.includes('recover')) {
  const P = await freePort();
  v = await boot('r1-chat-bar-recover', { env: { ANTHROPIC_BASE_URL: `http://127.0.0.1:${P}` } });
  let px = null;
  try {
    await v.openHome(); await sleep(3000);
    await v.win.locator('#chatInput').fill('Back online? Answer in one short sentence.');
    const t0 = Date.now(); await v.win.locator('#chatInput').press('Enter');
    await v.win.waitForFunction(() => /You're offline/.test(document.querySelector('#msgs .msg.pet.live .st .say')?.textContent || ''), null, { timeout: 15e3 });
    R.recover = { offlineMs: Date.now() - t0, load: uptime() };
    await sleep(4000); await v.shot(path.join(D, '03-waiting-offline.png'));
    px = await proxy(P); const t1 = Date.now();
    await idle(v.win); sent('faults', 'offline → recovered');
    Object.assign(R.recover, { sentAfterRecoveryMs: Date.now() - t1, reply: await lastReply(v.win), proxyHits: px.hits.map(h => `${h.m} ${h.p}`), engine: (await v.evalMain(() => globalThis.__rc.writes)).filter(w => w.type === 'user').map(w => w.pid) });
    await v.shot(path.join(D, '04-sent-after-recovery.png'));
  } finally { R.recoverErrors = v.errors; R.recoverClose = await v.close(); px?.s.close(); }
  save('recover', { errors: R.recoverErrors, close: R.recoverClose });
  }
  // 429 with retry-after 23: the copy + a live countdown + Retry now; n = 10 (each stopped with Esc)
  if (steps.includes('rate')) {
  const f429 = await fake(429, { 'retry-after': '23' });
  v = await boot('r1-chat-bar-429', { env: { ANTHROPIC_BASE_URL: f429.url } });
  try {
    await v.openHome(); await sleep(3000);
    R.rate = [];
    for (let k = 0; k < 10; k++) {
      await v.win.locator('#chatInput').fill(`quick one (${k + 1})`);
      const load = uptime(), t0 = Date.now();
      await v.win.locator('#chatInput').press('Enter');
      await v.win.waitForFunction(() => /Rate limited by Anthropic/.test(document.querySelector('#msgs .msg.pet.live .st .say')?.textContent || ''), null, { timeout: 15e3 });
      const ms = Date.now() - t0, c1 = await lastReply(v.win);
      let c2 = null;
      if (k === 0) {
        await v.shot(path.join(D, '05-rate-limited.png')); await sleep(2000); c2 = (await lastReply(v.win)).say; await v.shot(path.join(D, '06-rate-countdown.png'));
        const hits0 = f429.hits.filter(h => h.m === 'POST').length; await v.win.locator('#msgs .msg.pet.live .st button[data-act=now]').click(); await sleep(200);
        await v.win.waitForFunction(() => /Retrying in (2[23]) s/.test(document.querySelector('#msgs .msg.pet.live .st .say')?.textContent || ''), null, { timeout: 20e3 }).catch(() => {});
        await sleep(300);
        R.retryNow = { hitsBefore: hits0, hitsAfter: f429.hits.filter(h => h.m === 'POST').length, say: (await lastReply(v.win)).say };
        await v.shot(path.join(D, '07-after-retry-now.png'));
      }
      await v.win.keyboard.press('Escape'); await sleep(300);
      const user = await v.win.evaluate(() => { const u = [...document.querySelectorAll('#msgs .msg.user')].pop(); return { cls: u.className, text: u.firstChild.textContent, retry: !!u.querySelector('.redo') }; });
      R.rate.push({ ms, load, say: c1.say, later: c2, acts: c1.acts, user });
      console.log(`429 ${k + 1}: ${ms} ms '${c1.say}'${c2 ? ` → '${c2}'` : ''} (${load})`);
    }
    R.rateHits = f429.hits.length;
  } finally { R.rateErrors = v.errors; R.rateClose = await v.close(); f429.s.close(); }
  save('rate', { stat: stat(R.rate.map(x => x.ms)), retryNow: R.retryNow, hits: R.rateHits, errors: R.rateErrors, close: R.rateClose });
  }
  // a rejected key (API path): the copy + [Paste key], n = 10; the text stays retryable
  if (steps.includes('badkey')) {
  const f401 = await fake(401);
  v = await boot('r1-chat-bar-badkey', { state: { engine: 'key' }, env: { ANTHROPIC_BASE_URL: f401.url, ANTHROPIC_API_KEY: 'sk-ant-api03-' + 'x'.repeat(95) } });
  try {
    await v.openHome(); await sleep(1500);
    R.badkey = [];
    for (let k = 0; k < 10; k++) {
      await v.win.locator('#chatInput').fill(`hello (${k + 1})`);
      const load = uptime(), t0 = Date.now();
      await v.win.locator('#chatInput').press('Enter');
      await v.win.waitForFunction(n => document.querySelectorAll('#msgs .msg.pet.err').length >= n, k + 1, { timeout: 15e3 });
      const ms = Date.now() - t0, c = await lastReply(v.win);
      const user = await v.win.evaluate(() => { const u = [...document.querySelectorAll('#msgs .msg.user')].pop(); return { cls: u.className, text: u.firstChild.textContent, retry: !!u.querySelector('.redo') }; });
      R.badkey.push({ ms, load, say: c.say, acts: c.acts, user });
      if (k === 0) await v.shot(path.join(D, '08-rejected-key.png'));
    }
    await v.win.locator('#msgs .msg.pet.err button[data-act=key]').last().click(); await sleep(300);
    R.badkeyPaste = await v.win.evaluate(() => ({ keyForm: !document.getElementById('keyForm').classList.contains('hidden'), focus: document.activeElement?.id }));
    await v.shot(path.join(D, '09-paste-key-form.png'));
  } finally { R.badkeyErrors = v.errors; R.badkeyClose = await v.close(); f401.s.close(); }
  save('badkey', { stat: stat(R.badkey.map(x => x.ms)), paste: R.badkeyPaste, errors: R.badkeyErrors, close: R.badkeyClose });
  }
  // the Claude Code login itself rejected (claude path, 401 after its own refresh): the login copy
  if (steps.includes('login')) {
  const f401b = await fake(401);
  v = await boot('r1-chat-bar-login', { env: { ANTHROPIC_BASE_URL: f401b.url } });
  try {
    await v.openHome(); await sleep(3000);
    await v.win.locator('#chatInput').fill('hello?'); const t0 = Date.now(); await v.win.locator('#chatInput').press('Enter');
    await v.win.waitForFunction(() => document.querySelector('#msgs .msg.pet.err'), null, { timeout: 30e3 });
    R.login = { ms: Date.now() - t0, load: uptime(), card: await lastReply(v.win), user: await v.win.evaluate(() => [...document.querySelectorAll('#msgs .msg.user')].pop().className) };
    await v.shot(path.join(D, '10-login-expired.png'));
  } finally { R.loginErrors = v.errors; R.loginClose = await v.close(); f401b.s.close(); }
  save('login', { errors: R.loginErrors, close: R.loginClose });
  }
  console.log(JSON.stringify({ offline: R.offline && stat(R.offline.map(x => x.ms)), recover: R.recover && { offlineMs: R.recover.offlineMs, sentAfterRecoveryMs: R.recover.sentAfterRecoveryMs, reply: R.recover.reply?.text }, rate: R.rate && stat(R.rate.map(x => x.ms)), retryNow: R.retryNow, badkey: R.badkey && stat(R.badkey.map(x => x.ms)), badkeyCard: R.badkey?.[0], paste: R.badkeyPaste, login: R.login && { ms: R.login.ms, say: R.login.card?.say } }, null, 1));
}

// ---------------------------------------------------------------- noengine: (f)
async function noengine() {
  const D = path.join(HERE, 'noengine'), R = { loadStart: uptime() };
  const v = await boot('r1-chat-bar-noengine', { env: { VIBEPET_CLAUDE_BIN: '/nonexistent' } });
  try {
    await v.openHome(); await sleep(800);
    R.open = await v.win.evaluate(() => ({ composerVisible: document.getElementById('chatInput').offsetParent !== null, focus: document.activeElement?.id, keyFormShown: !document.getElementById('keyForm').classList.contains('hidden'),
      header: document.getElementById('chatMeta').textContent, card: document.querySelector('#msgs .msg[data-id="noengine"] .st .say')?.textContent, acts: [...document.querySelectorAll('#msgs .msg[data-id="noengine"] .st button')].map(b => b.textContent) }));
    await v.shot(path.join(D, '01-open.png'));
    const n0 = await v.win.locator('#msgs .msg.note').count();
    await v.win.locator('#chatInput').fill('/today'); await v.win.locator('#chatInput').press('Enter'); await sleep(500);
    R.today = (await v.win.locator('#msgs .msg.note').count()) > n0;
    await v.evalMain(({ ipcMain }) => { const H = ipcMain._invokeHandlers, h = H.get('jump'); ipcMain.removeHandler('jump'); ipcMain.handle('jump', async (e, ...a) => { const r = await h(e, ...a); (globalThis.__rc.jumps ||= []).push({ args: a, result: r }); return r; }); });
    await v.win.locator('#chatInput').fill('/jump kestrel'); await v.win.locator('#chatInput').press('Enter'); await sleep(2500);
    R.jump = await v.evalMain(() => globalThis.__rc.jumps || []);
    await v.win.locator('#chatInput').fill('what does kestrel need?'); await v.win.locator('#chatInput').press('Enter'); await sleep(800);
    R.question = { card: await lastReply(v.win), user: await v.win.evaluate(() => { const u = [...document.querySelectorAll('#msgs .msg.user')].pop(); return { cls: u.className, text: u.firstChild.textContent, retry: !!u.querySelector('.redo') }; }) };
    await v.shot(path.join(D, '02-question-kept.png'));
    await v.win.locator('#msgs .msg.pet.err button[data-act=key]').last().click(); await sleep(200);
    R.pasteKey = await v.win.evaluate(() => document.activeElement?.id);
    await v.win.locator('#keyInput').fill("what's my agent doing?"); await v.win.locator('#keyInput').press('Enter'); await sleep(800);
    R.keyField = await v.win.evaluate(() => ({ note: [...document.querySelectorAll('#msgs .msg.note')].pop()?.textContent, composer: document.getElementById('chatInput').value, keyFormShown: !document.getElementById('keyForm').classList.contains('hidden') }));
    R.keySaved = await v.evalMain(() => ({ keyEnc: !!globalThis.__vibepet.state().keyEnc, engine: globalThis.__vibepet.state().engine }));
    await v.shot(path.join(D, '03-question-refused-as-key.png'));
    await v.win.locator('#msgs .msg.pet.err button[data-act=install]').last().click(); await sleep(200);
    R.install = await v.evalMain(() => globalThis.__rc.open);
  } finally { R.errors = v.errors; R.close = await v.close(); R.loadEnd = uptime(); write(D, 'noengine.json', R); console.log(JSON.stringify(R, null, 1)); }
}

const phase = process.argv[2];
const P = { main, model, sonnet, faults: () => faults(process.argv.slice(3).length ? process.argv.slice(3) : undefined), noengine }[phase];
if (!P) { console.error('phases: main | model | sonnet | faults | noengine'); process.exit(2); }
if (sendsSoFar() >= 40 && phase !== 'noengine') { console.error('send budget spent (40)'); process.exit(3); }
P().then(() => console.log(`sends so far: ${sendsSoFar()}`), e => { console.error('FAIL', e); process.exit(1); });
