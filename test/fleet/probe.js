#!/usr/bin/env node
'use strict';
// probe: high-frequency observer for ONE fleet member while something happens to it.
// Records, against a single clock, what Claude Code exposes and when:
//   transcript records (type/subtype, stop_reason, tool names, ids - never text),
//   registry ~/.claude/sessions/<pid>.json (status, statusUpdatedAt, updatedAt),
//   the tmux pane (classified; raw snapshots saved on shape change),
//   descendant processes of the claude pid (comm + argv; fleet pids only).
// Optionally sends a prompt / keys at t0 (spend-guarded).
//
//   node test/fleet/probe.js <member> [--send TEXT] [--keys K1,K2] [--secs N]
//        [--stop-on pane:REGEX|reg:STATUS|kind:KIND|sub:N] [--linger MS] [--label L]
const fs = require('fs');
const path = require('path');
const L = require('./lib');

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const name = argv[0];
if (!name || name.startsWith('--')) { console.error('usage: probe.js <member> [--send TEXT] [--keys K,..] [--secs N] [--stop-on ...] [--linger MS] [--label L]'); process.exit(2); }

const PANE_CLASSES = [
  ['approval', /Do you want to (proceed|make this edit|create|allow)/],
  ['question', /(Enter to select|Submit answers?|↑\/↓ to navigate|Tab\/Arrow keys to navigate)/],
  ['running', /(esc to interrupt|ctrl\+b to run in background)/i],
  ['prompt', /^\s*❯\s/m],
];
const classify = (txt) => { const hits = PANE_CLASSES.filter(([, re]) => re.test(txt)).map(([k]) => k); return hits.length ? hits.join('+') : 'other'; };
const signature = (txt) => txt.replace(/[0-9]+/g, '#').replace(/[·✢✳✶✻✽∗*⏺●○◐◓◑◒]/g, '').replace(/[ \t]+/g, ' ').trim();

(async () => {
  const { members } = L.loadMembers();
  const m = members.find(x => x.name === name);
  if (!m) throw new Error('unknown member ' + name);
  const pid = L.claudePidOf(m.target);
  if (!pid) throw new Error(`${name}: no claude process under ${m.target}`);
  const reg0 = L.readRegistry(pid);
  const sid = opt('sid') || (reg0 && reg0.sessionId);
  const tfile = L.transcriptPath(m, sid);
  const label = opt('label', name);
  const secs = Number(opt('secs', 60));
  const linger = Number(opt('linger', 1500));
  const stopOn = opt('stop-on');
  const outDir = path.join(L.EVID, 'round-0', 'raw');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = L.iso().replace(/[:.]/g, '-');
  const outFile = path.join(outDir, `probe-${label}-${stamp}.jsonl`);
  const out = fs.openSync(outFile, 'a');
  const t0 = Date.now();
  const ev = (o) => { const e = Object.assign({ t: Date.now() - t0, at: Date.now() }, o); fs.writeSync(out, JSON.stringify(e) + '\n'); return e; };
  ev({ ev: 'start', member: name, pid, sessionId: sid, transcript: tfile, target: m.target });

  // --- transcript tailers (main + subagents)
  const tails = new Map(); // file -> {off, buf}
  const recSummary = (r) => {
    const cs = L.contentOf(r);
    const o = { type: r.type };
    if (r.subtype) o.subtype = r.subtype;
    if (r.isMeta) o.isMeta = true;
    if (r.isSidechain) o.sidechain = true;
    if (r.message && r.message.role) o.role = r.message.role;
    if (r.message && r.message.stop_reason !== undefined) o.stop_reason = r.message.stop_reason;
    if (r.message && r.message.model) o.model = r.message.model;
    const blocks = cs.map(c => c.type); if (blocks.length) o.blocks = blocks;
    const tools = cs.filter(c => c.type === 'tool_use').map(c => c.name); if (tools.length) o.tools = tools;
    const ids = cs.filter(c => c.type === 'tool_use').map(c => c.id); if (ids.length) o.toolUseIds = ids;
    const res = cs.filter(c => c.type === 'tool_result').map(c => c.tool_use_id); if (res.length) o.toolResultFor = res;
    if (r.timestamp) o.recTs = Date.parse(r.timestamp);
    if (r.toolUseResult && typeof r.toolUseResult === 'object') o.toolUseResultKeys = Object.keys(r.toolUseResult).slice(0, 12);
    if (r.data && typeof r.data === 'object') o.dataType = r.data.type;
    return o;
  };
  const pollFile = (file, src) => {
    let st; try { st = fs.statSync(file); } catch { return; }
    let t = tails.get(file);
    if (!t) { t = { off: preexisting.has(file) && opt('from-start') == null ? st.size : 0, buf: '' }; tails.set(file, t); }
    if (st.size <= t.off) return;
    const fd = fs.openSync(file, 'r'); const b = Buffer.alloc(st.size - t.off); fs.readSync(fd, b, 0, b.length, t.off); fs.closeSync(fd);
    t.off = st.size; t.buf += b.toString('utf8');
    const lines = t.buf.split('\n'); t.buf = lines.pop();
    for (const line of lines) { if (!line) continue; let r; try { r = JSON.parse(line); } catch { continue; } lastRecs.push(Object.assign(ev(Object.assign({ ev: 'rec', src }, recSummary(r))), {})); }
  };
  L.readJsonl(tfile); // asserts fleet path
  const lastRecs = [];
  const subDir = path.join(L.PROJECTS, m.dname, sid || '_none_');
  // files that already exist are tailed from their end; files created during the probe from 0
  const preexisting = new Set([tfile, ...L.walkJsonl(subDir)].filter(f => fs.existsSync(f)));

  // --- registry, pane, processes
  let lastReg = '', lastCls = '', lastSig = '', lastSnapAt = 0, lastProcs = '';
  const firstSeen = {};
  let snaps = 0;
  const pollReg = () => {
    const r = L.readRegistry(pid);
    const k = r ? `${r.status}|${r.statusUpdatedAt}|${r.updatedAt}` : 'missing';
    if (k !== lastReg) { lastReg = k; ev(Object.assign({ ev: 'reg' }, r ? { status: r.status, waitingFor: r.waitingFor, statusUpdatedAt: r.statusUpdatedAt, updatedAt: r.updatedAt, seenLagMs: Date.now() - r.updatedAt, keys: Object.keys(r) } : { missing: true })); }
  };
  const pollPane = () => {
    const txt = L.capture(m.target) || '';
    const cls = classify(txt);
    for (const c of cls.split('+')) if (!firstSeen[c]) { firstSeen[c] = Date.now() - t0; ev({ ev: 'pane-first', cls: c }); }
    if (cls !== lastCls) { lastCls = cls; ev({ ev: 'pane', cls }); }
    const sig = signature(txt);
    if (sig !== lastSig && Date.now() - lastSnapAt > 250) { lastSig = sig; lastSnapAt = Date.now(); snaps++; ev({ ev: 'snap', n: snaps, cls, text: txt }); }
  };
  const pollProcs = () => {
    const ps = L.childProcs(pid).map(p => `${p.comm}:${p.args.slice(0, 120)}`).sort();
    const k = ps.join(' | ');
    if (k !== lastProcs) { lastProcs = k; ev({ ev: 'procs', n: ps.length, procs: ps }); }
  };

  // --- act at t0
  pollReg(); pollPane(); pollProcs(); pollFile(tfile, 'main');
  if (opt('send') || opt('keys')) L.assertBudget('probe send');
  if (opt('send')) { ev({ ev: 'send-begin' }); await L.sendLine(m.target, opt('send')); ev({ ev: 'send-enter' }); }
  if (opt('keys')) { for (const k of opt('keys').split(',')) { L.sendKeys(m.target, k); await L.sleep(150); } ev({ ev: 'keys-sent', keys: opt('keys') }); }

  const deadline = t0 + secs * 1000;
  let stopAt = null, tick = 0, sawBusy = false; // reg:idle only counts after the session left idle
  const stopHit = () => {
    if (!stopOn) return false;
    const [k, v] = [stopOn.slice(0, stopOn.indexOf(':')), stopOn.slice(stopOn.indexOf(':') + 1)];
    if (k === 'pane') return new RegExp(v).test(L.capture(m.target) || '');
    if (k === 'reg') { const r = L.readRegistry(pid); if (r && r.status !== 'idle') sawBusy = true; return !!r && r.status === v && (v !== 'idle' || sawBusy); }
    if (k === 'kind') return L.tailState(L.readJsonl(tfile)).kind === v;
    if (k === 'sub') return L.walkJsonl(subDir).length >= Number(v);
    return false;
  };
  // Stalls (the machine runs ~15 other Claude sessions) would delay every observation; log them
  // so trials with a stall near an event can be discarded.
  const timed = (step, fn) => { const a = Date.now(); fn(); const dt = Date.now() - a; if (dt > 150) ev({ ev: 'stall', step, ms: dt }); };
  while (Date.now() < deadline) {
    const it = Date.now();
    timed('transcript', () => { pollFile(tfile, 'main'); for (const f of L.walkJsonl(subDir)) pollFile(f, 'sub:' + path.basename(f, '.jsonl')); });
    timed('registry', pollReg);
    if (tick % 2 === 0) timed('pane', pollPane);
    if (tick % 10 === 0) timed('procs', pollProcs);
    if (Date.now() - it > 300) ev({ ev: 'stall', step: 'iteration', ms: Date.now() - it });
    if (!stopAt && tick % 4 === 0 && stopHit()) { stopAt = Date.now(); ev({ ev: 'stop-hit', on: stopOn }); }
    if (stopAt && Date.now() - stopAt > linger) break;
    tick++;
    await L.sleep(25);
  }
  ev({ ev: 'end', firstSeen });
  fs.closeSync(out);
  // console summary: structure only
  const evs = fs.readFileSync(outFile, 'utf8').trim().split('\n').map(JSON.parse);
  for (const e of evs) {
    if (e.ev === 'snap') { console.log(`${String(e.t).padStart(7)}ms snap#${e.n} cls=${e.cls}`); continue; }
    const { t, at, ev: k, ...rest } = e;
    console.log(`${String(t).padStart(7)}ms ${k} ${JSON.stringify(rest)}`);
  }
  console.log('OUT', outFile);
})().catch(e => { console.error('probe error:', e.message); process.exit(1); });
