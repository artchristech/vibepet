'use strict';
// Shared helpers for the vibepet fixture fleet. Zero dependencies.
//
// Safety contract (see docs/ultra/round-0/fleet.md):
//  - Only fleet transcripts (project dir name contains FLEET_TAG) are ever opened.
//  - Only the registry files (~/.claude/sessions/<pid>.json) of fleet pids are opened.
//  - Only tmux sessions named vp-* are ever touched; the default tmux socket is used.
//  - Nothing here writes under ~/.claude except the isolated watch root (ULTRA/root).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOME = os.homedir();
const ULTRA = process.env.VIBEPET_ULTRA || path.join(HOME, '.vibepet-ultra');
const FLEET = path.join(ULTRA, 'fleet');
const ROOT = path.join(ULTRA, 'root', '.claude');
const STATE_FILE = path.join(FLEET, '.fleet-state.json');
const CLAUDE_HOME = path.join(HOME, '.claude');
const PROJECTS = path.join(CLAUDE_HOME, 'projects');
const SESSIONS = path.join(CLAUDE_HOME, 'sessions');
const EVID = process.env.VIBEPET_ULTRA_EVID || path.join(HOME, 'projects', 'vibepet', 'docs', 'ultra');
const FLEET_TAG = '-vibepet-ultra-fleet-';
const TMUX_PREFIX = 'vp-';
const SPEND_CAP = 5;
const SPEND_REFUSE_AT = 4.5;   // default stop; a round can set a lower one (spendStop below)
const SPEND_STOP_FILE = path.join(FLEET, 'spend-stop');
// Claude Code makes API calls that never reach the transcript (prompt suggestions, ai-title,
// background-agent summaries ...). Measured against its own cost-state records: +8.8% for a
// one-turn session, +44% (ember: 7 turns incl. /loop fires), +55% (delta: 2 fan-outs, 6
// subagents). Sessions without a cost-state yet are budgeted with at least this overhead.
const HIDDEN_OVERHEAD_FLOOR = 0.5;

const firstExisting = (...ps) => ps.find(p => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } }) || ps[ps.length - 1];
const TMUX = process.env.VP_TMUX || firstExisting('/opt/homebrew/bin/tmux', '/usr/local/bin/tmux', 'tmux');
const CLAUDE_BIN = process.env.VP_CLAUDE || firstExisting(path.join(HOME, '.local/bin/claude'), '/opt/homebrew/bin/claude', 'claude');
const PANE_PATH = [path.join(HOME, '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':');

// Environment for the tmux client/server and for every fleet pane. Built from scratch so
// nothing from the launching Claude Code session (CLAUDECODE, CLAUDE_CODE_MESSAGING_SOCKET,
// CLAUDE_CODE_SESSION_ID, ...) can leak into fleet sessions.
function cleanEnv(extra = {}) {
  const e = {
    HOME, USER: os.userInfo().username, LOGNAME: os.userInfo().username,
    SHELL: '/bin/bash', PATH: PANE_PATH, LANG: 'en_US.UTF-8',
    TMPDIR: process.env.TMPDIR || '/tmp/', BASH_SILENCE_DEPRECATION_WARNING: '1',
  };
  if (process.env.__CF_USER_TEXT_ENCODING) e.__CF_USER_TEXT_ENCODING = process.env.__CF_USER_TEXT_ENCODING;
  return Object.assign(e, extra);
}

// Claude Code's project-dir name for a cwd: every non [A-Za-z0-9] char becomes '-'.
const dname = (cwd) => cwd.replace(/[^a-zA-Z0-9]/g, '-');
const isFleetDname = (d) => d.includes(FLEET_TAG);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const now = () => Date.now();
const iso = (t = Date.now()) => new Date(t).toISOString();

// ---------------------------------------------------------------- members / state
// VP_MEMBERS=<file> swaps in another member list (experiments, extra fixtures); seeds resolve
// relative to this directory either way.
function loadMembers(file = process.env.VP_MEMBERS || path.join(__dirname, 'members.json')) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const m of j.members) {
    m.repoSpec = j.repos[m.repo];
    if (!m.repoSpec) throw new Error(`member ${m.name}: unknown repo ${m.repo}`);
    m.cwd = path.join(FLEET, m.repoSpec.dir || m.repo, m.subdir || '');
    m.dname = dname(m.cwd);
    m.target = TMUX_PREFIX + m.name;
  }
  return j;
}
function loadState() { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return { members: {} }; } }
function saveState(s) { fs.mkdirSync(FLEET, { recursive: true }); fs.writeFileSync(STATE_FILE + '.tmp', JSON.stringify(s, null, 2)); fs.renameSync(STATE_FILE + '.tmp', STATE_FILE); }

// ---------------------------------------------------------------- leases (advisory: one holder per member)
// Whoever is about to change a member's state takes its lease first, re-arms what it consumed, then releases.
// Taking = an atomic mkdir of LEASES/<member> (of N racing takers exactly one wins); owner.json inside names the
// holder. A lease older than its ttl is stale and the next taker breaks it: rename it aside (atomic, so one breaker
// wins), check that what moved is the lease it judged stale, then mkdir again. The holder taking it again renews it.
const LEASES = path.join(FLEET, '.leases');
const LEASE_TTL_SEC = 1800;
const LEASE_NAME = /^[A-Za-z0-9_-]{1,64}$/;   // no dots: '<member>.stale-*' / '.release-*' are the move-aside names
function leaseDirOf(member, dir) {
  if (!LEASE_NAME.test(String(member))) throw new Error(`bad member name for a lease: ${member}`);
  return path.join(dir, member);
}
function readLeaseAt(p, now) {
  let st; try { st = fs.statSync(p); } catch { return null; }
  let info = null; try { info = JSON.parse(fs.readFileSync(path.join(p, 'owner.json'), 'utf8')); } catch {}
  // no owner.json yet (a taker between its mkdir and its write) or unreadable: held, owner unknown, aged by the dir
  const at = info && Date.parse(info.at) ? Date.parse(info.at) : st.mtimeMs;
  const ttlSec = info && info.ttlSec > 0 ? info.ttlSec : LEASE_TTL_SEC;
  const exp = at + ttlSec * 1000;
  return { member: path.basename(p), owner: info ? info.owner : null, token: info ? info.token : null, at: iso(at), ttlSec, expiresAt: iso(exp), leftSec: Math.round((exp - now) / 1000), stale: now >= exp };
}
function readLease(member, { dir = LEASES, now = Date.now() } = {}) { return readLeaseAt(leaseDirOf(member, dir), now); }
function listLeases({ dir = LEASES, now = Date.now() } = {}) {
  let names = []; try { names = fs.readdirSync(dir).filter(n => LEASE_NAME.test(n)); } catch {}
  return names.map(n => readLeaseAt(path.join(dir, n), now)).filter(Boolean);
}
function writeLeaseOwner(p, info) {
  const tmp = path.join(p, `.owner-${process.pid}-${require('crypto').randomBytes(3).toString('hex')}.json`);
  fs.writeFileSync(tmp, JSON.stringify(info, null, 2) + '\n');
  fs.renameSync(tmp, path.join(p, 'owner.json'));
}
// Move the lease dir aside and delete it, but only if it is still the lease `expect` describes (same token); a
// lease that changed in between is put back. Returns 'gone' (removed or already gone) or 'changed'.
function removeLeaseIf(p, expect) {
  const aside = `${p}.${expect.why}-${process.pid}-${require('crypto').randomBytes(4).toString('hex')}`;
  try { fs.renameSync(p, aside); } catch (e) { if (e.code === 'ENOENT') return 'gone'; throw e; }
  const moved = readLeaseAt(aside, Date.now());
  if (moved && moved.token !== expect.token) { try { fs.renameSync(aside, p); } catch {} return 'changed'; }
  fs.rmSync(aside, { recursive: true, force: true });
  return 'gone';
}
function acquireLease(member, owner, { ttlSec = LEASE_TTL_SEC, dir = LEASES, now = Date.now() } = {}) {
  owner = String(owner || '').trim();
  if (!owner || owner.length > 100 || /[\n\r]/.test(owner)) throw new Error('lease: owner must be a short one-line name');
  ttlSec = Number(ttlSec);
  if (!(ttlSec > 0)) throw new Error(`lease: bad ttl ${ttlSec}`);
  const p = leaseDirOf(member, dir);
  fs.mkdirSync(dir, { recursive: true });
  const info = () => ({ member, owner, token: require('crypto').randomBytes(8).toString('hex'), at: iso(now), ttlSec, expiresAt: iso(now + ttlSec * 1000), cmdPid: process.pid });
  let broke = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try { fs.mkdirSync(p); } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let cur = readLeaseAt(p, now);
      // a fresh dir without owner.json: the winner is between its mkdir and its write; give it a moment to say who
      for (let i = 0; cur && cur.owner == null && !cur.stale && i < 10; i++) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25); cur = readLeaseAt(p, now); }
      if (!cur) continue;                                        // released between our mkdir and our read: retry
      if (cur.owner === owner) { writeLeaseOwner(p, info()); return { ok: true, action: 'renewed', lease: readLeaseAt(p, now), broke }; }
      if (!cur.stale) return { ok: false, action: 'held', lease: cur };
      if (removeLeaseIf(p, { token: cur.token, why: 'stale' }) === 'changed') return { ok: false, action: 'held', lease: readLeaseAt(p, now) || cur };
      broke = cur;
      continue;
    }
    writeLeaseOwner(p, info());
    return { ok: true, action: broke ? 'broke-stale' : 'taken', lease: readLeaseAt(p, now), broke };
  }
  return { ok: false, action: 'contended', lease: readLeaseAt(p, now) };
}
// release <member> frees it whoever holds it; with `owner`, only that owner's lease is freed (unless `force`).
function releaseLease(member, { owner = null, force = false, dir = LEASES, now = Date.now() } = {}) {
  const p = leaseDirOf(member, dir);
  const cur = readLeaseAt(p, now);
  if (!cur) return { ok: true, action: 'free', lease: null };
  if (owner && cur.owner !== owner && !force) return { ok: false, action: 'not-yours', lease: cur };
  return removeLeaseIf(p, { token: cur.token, why: 'release' }) === 'changed'
    ? { ok: false, action: 'changed', lease: readLeaseAt(p, now) }
    : { ok: true, action: 'released', lease: cur };
}
const leaseLabel = (l) => (l ? `${l.owner || '(unknown)'} ${l.stale ? 'STALE' : `${l.leftSec}s left`}` : '');

// ---------------------------------------------------------------- tmux
function tmux(args, { allowFail = false } = {}) {
  const r = spawnSync(TMUX, args, { env: cleanEnv(), encoding: 'utf8' });
  if (r.status !== 0 && !allowFail) throw new Error(`tmux ${args[0]} failed: ${(r.stderr || '').trim()}`);
  return r.status === 0 ? r.stdout : null;
}
const assertOurs = (target) => { if (!String(target).startsWith(TMUX_PREFIX)) throw new Error(`refusing to touch non-fleet tmux target ${target}`); };
function hasSession(target) { assertOurs(target); return tmux(['has-session', '-t', '=' + target], { allowFail: true }) !== null; }
function fleetSessions() {
  const out = tmux(['list-sessions', '-F', '#{session_name}'], { allowFail: true }) || '';
  return out.split('\n').filter(s => s.startsWith(TMUX_PREFIX));
}
function capture(target, { join = false } = {}) {
  assertOurs(target);
  const r = spawnSync(TMUX, ['capture-pane', '-p', ...(join ? ['-J'] : []), '-t', target], { env: cleanEnv(), encoding: 'utf8' });
  return r.status === 0 ? r.stdout : null;
}
function paneInfo(target) {
  assertOurs(target);
  const out = tmux(['display-message', '-p', '-t', target, '#{pane_pid}\t#{session_name}:#{window_index}.#{pane_index}\t#{pane_tty}\t#{pane_width}x#{pane_height}'], { allowFail: true });
  if (!out) return null;
  const [pid, pane, tty, size] = out.trim().split('\t');
  return { panePid: Number(pid), pane, tty, size };
}
function sendKeys(target, ...keys) { assertOurs(target); tmux(['send-keys', '-t', target, ...keys]); }
function sendLiteral(target, text) { assertOurs(target); tmux(['send-keys', '-t', target, '-l', text]); }
async function sendLine(target, text, { settleMs = 400 } = {}) {
  sendLiteral(target, text);
  await sleep(settleMs);            // Claude Code's input treats a fast trailing Enter as part of a paste
  sendKeys(target, 'Enter');
}

// ---------------------------------------------------------------- processes (descendants of our panes only)
function psTable() {
  const r = spawnSync('/bin/ps', ['-A', '-o', 'pid=,ppid=,comm='], { encoding: 'utf8' });
  const rows = [];
  for (const line of (r.stdout || '').split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
    if (m) rows.push({ pid: Number(m[1]), ppid: Number(m[2]), comm: m[3] });
  }
  return rows;
}
function descendants(rootPid, rows = psTable()) {
  const kids = new Map();
  for (const r of rows) { if (!kids.has(r.ppid)) kids.set(r.ppid, []); kids.get(r.ppid).push(r); }
  const out = [], stack = [...(kids.get(rootPid) || [])];
  while (stack.length) { const r = stack.pop(); out.push(r); stack.push(...(kids.get(r.pid) || [])); }
  return out;
}
// Full argv, but only for pids we already know descend from a fleet pane.
function argsOf(pids) {
  if (!pids.length) return new Map();
  const r = spawnSync('/bin/ps', ['-o', 'pid=,args=', '-p', pids.join(',')], { encoding: 'utf8' });
  const m = new Map();
  for (const line of (r.stdout || '').split('\n')) { const x = line.trim().match(/^(\d+)\s+(.*)$/); if (x) m.set(Number(x[1]), x[2]); }
  return m;
}
function claudePidOf(target, rows = psTable()) {
  const info = paneInfo(target);
  if (!info) return null;
  const d = descendants(info.panePid, rows).filter(r => /(^|\/)claude$/.test(r.comm));
  // the shallowest claude under the pane shell
  const direct = d.find(r => r.ppid === info.panePid);
  return (direct || d[0] || {}).pid || null;
}
function childProcs(claudePid, rows = psTable()) {
  const d = descendants(claudePid, rows);
  const a = argsOf(d.map(r => r.pid));
  return d.map(r => ({ pid: r.pid, ppid: r.ppid, comm: path.basename(r.comm), args: a.get(r.pid) || '' }));
}

// ---------------------------------------------------------------- registry (fleet pids only)
function readRegistry(pid) {
  if (!pid) return null;
  try { return JSON.parse(fs.readFileSync(path.join(SESSIONS, pid + '.json'), 'utf8')); } catch { return null; }
}

// ---------------------------------------------------------------- transcripts (fleet only)
function assertFleetPath(p) {
  const rel = path.relative(PROJECTS, p);
  if (rel.startsWith('..') || !isFleetDname(rel.split(path.sep)[0])) throw new Error(`refusing to read non-fleet transcript ${p}`);
}
function readJsonl(file) {
  assertFleetPath(file);
  let txt; try { txt = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const out = [];
  for (const line of txt.split('\n')) { if (!line) continue; try { out.push(JSON.parse(line)); } catch {} }
  return out;
}
function walkJsonl(dir, out = []) {
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkJsonl(p, out); else if (e.name.endsWith('.jsonl')) out.push(p);
  }
  return out;
}
function fleetDnames() { try { return fs.readdirSync(PROJECTS).filter(isFleetDname); } catch { return []; } }
function transcriptPath(m, sessionId) { return path.join(PROJECTS, m.dname, sessionId + '.jsonl'); }
function subagentFiles(m, sessionId) { return walkJsonl(path.join(PROJECTS, m.dname, sessionId)); }

const contentOf = (rec) => { const c = rec && rec.message && rec.message.content; return Array.isArray(c) ? c : (typeof c === 'string' ? [{ type: 'text', text: c }] : []); };
const CONVO = new Set(['user', 'assistant']);
// Summarise a transcript tail with structure only (types, stop_reason, tool names).
function tailState(records) {
  const convo = records.filter(r => CONVO.has(r.type) && !r.isMeta);
  const results = new Set();
  for (const r of convo) if (r.type === 'user') for (const c of contentOf(r)) if (c.type === 'tool_result') results.add(c.tool_use_id);
  const uses = [];
  for (const r of convo) if (r.type === 'assistant') for (const c of contentOf(r)) if (c.type === 'tool_use') uses.push({ id: c.id, name: c.name, input: c.input || {}, ts: r.timestamp, msgId: r.message.id });
  const pending = uses.filter(u => !results.has(u.id));
  const last = convo[convo.length - 1] || null;
  const lastAsst = [...convo].reverse().find(r => r.type === 'assistant') || null;
  const lastAsstText = lastAsst ? contentOf(lastAsst).filter(c => c.type === 'text').map(c => c.text).join('\n').trim() : '';
  let kind = 'empty';
  if (last && last.type === 'assistant') {
    const sr = last.message.stop_reason;
    if (pending.length && pending.some(p => p.msgId === last.message.id)) kind = 'pending_tool_use';
    else if (sr === 'end_turn' || sr === 'stop_sequence') kind = 'end_turn';
    else if (sr === 'tool_use') kind = 'tool_use_resolved';
    else kind = 'assistant_' + (sr || 'streaming');
  } else if (last && last.type === 'user') {
    const cs = contentOf(last);
    const txt = cs.filter(c => c.type === 'text').map(c => c.text).join('');
    if (/\[Request interrupted by user/.test(txt) || cs.some(c => c.type === 'tool_result' && /interrupted by user/i.test(JSON.stringify(c.content || '')))) kind = 'interrupted';
    else if (cs.some(c => c.type === 'tool_result')) kind = 'tool_result';
    else kind = 'user_prompt';
  }
  // '<synthetic>' = records Claude Code writes itself (interrupts, 'No response requested.'), no API call
  const models = [...new Set(convo.filter(r => r.type === 'assistant').map(r => r.message.model).filter(x => x && x !== '<synthetic>'))];
  return {
    kind, pending, lastType: last && last.type, lastTs: last && last.timestamp,
    stopReason: lastAsst && lastAsst.message.stop_reason, lastAsstText, models,
    toolUses: uses, toolResultIds: results,
    recordTypes: [...new Set(records.map(r => r.type + (r.subtype ? ':' + r.subtype : '')))],
  };
}

// ---------------------------------------------------------------- spend (Haiku 4.5 list prices, $/M tokens)
const PRICES = {
  haiku: { in: 1, out: 5, cw5m: 1.25, cw1h: 2, cr: 0.10 },
  unknown: { in: 15, out: 75, cw5m: 18.75, cw1h: 30, cr: 1.5 },   // deliberately pessimistic: never expected
};
const priceFor = (model) => (/haiku/i.test(model || '') ? PRICES.haiku : PRICES.unknown);
function usageCost(model, u) {
  const p = priceFor(model);
  const cc = u.cache_creation || {};
  const has = cc.ephemeral_5m_input_tokens != null || cc.ephemeral_1h_input_tokens != null;
  const cw5 = has ? (cc.ephemeral_5m_input_tokens || 0) : (u.cache_creation_input_tokens || 0);
  const cw1 = has ? (cc.ephemeral_1h_input_tokens || 0) : 0;
  return ((u.input_tokens || 0) * p.in + (u.output_tokens || 0) * p.out + cw5 * p.cw5m + cw1 * p.cw1h + (u.cache_read_input_tokens || 0) * p.cr) / 1e6;
}
// Dedupe one API response split across several records (same message.id): keep max per field.
function responsesOf(records) {
  const by = new Map();
  for (const r of records) {
    if (r.type !== 'assistant' || !r.message || !r.message.usage) continue;
    if (r.message.model === '<synthetic>') continue;
    const key = r.message.id || r.requestId || r.uuid;
    const u = r.message.usage, prev = by.get(key);
    if (!prev) { by.set(key, { model: r.message.model, ts: r.timestamp, usage: JSON.parse(JSON.stringify(u)) }); continue; }
    for (const k of ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens']) prev.usage[k] = Math.max(prev.usage[k] || 0, u[k] || 0);
    if (u.cache_creation) { prev.usage.cache_creation = prev.usage.cache_creation || {}; for (const k of Object.keys(u.cache_creation)) prev.usage.cache_creation[k] = Math.max(prev.usage.cache_creation[k] || 0, u.cache_creation[k] || 0); }
  }
  return [...by.values()];
}
function tokenSums(resps) {
  const t = { responses: resps.length, input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, usd: 0 };
  for (const r of resps) {
    const u = r.usage, cc = u.cache_creation || {};
    const has = cc.ephemeral_5m_input_tokens != null || cc.ephemeral_1h_input_tokens != null;
    t.input += u.input_tokens || 0; t.output += u.output_tokens || 0; t.cacheRead += u.cache_read_input_tokens || 0;
    t.cacheWrite5m += has ? (cc.ephemeral_5m_input_tokens || 0) : (u.cache_creation_input_tokens || 0);
    t.cacheWrite1h += has ? (cc.ephemeral_1h_input_tokens || 0) : 0;
    t.usd += usageCost(r.model, u);
  }
  t.usd = Math.round(t.usd * 1e6) / 1e6;
  return t;
}
// Claude Code's own accounting: every graceful exit appends a cumulative `cost-state` record
// (totalCostUSD over ALL API calls of the session, incl. ones that never reach the transcript:
// prompt suggestions, titles, agent progress summaries ...). Sessions that have one are counted
// at that figure; the rest at transcripts x (1 + max(observed overhead, HIDDEN_OVERHEAD_FLOOR)).
function sessionSpend(dir, mainFile) {
  const recs = readJsonl(mainFile);
  const sid = path.basename(mainFile, '.jsonl');
  const subFiles = walkJsonl(path.join(dir, sid));
  let subResps = [];
  for (const f of subFiles) subResps = subResps.concat(responsesOf(readJsonl(f)));
  const all = responsesOf(recs).concat(subResps);
  const t = tokenSums(all);
  let lastCs = -1;
  recs.forEach((r, i) => { if (r.type === 'cost-state' && typeof r.totalCostUSD === 'number') lastCs = i; });
  let covered = null;
  if (lastCs >= 0) {
    let csTs = 0;
    for (let i = lastCs; i >= 0; i--) if (recs[i].timestamp) { csTs = Date.parse(recs[i].timestamp); break; }
    const after = tokenSums(responsesOf(recs.slice(lastCs + 1)).concat(subResps.filter(r => Date.parse(r.ts) > csTs))).usd;
    covered = { costStateUsd: recs[lastCs].totalCostUSD, transcriptUsd: Math.max(0, t.usd - after), afterUsd: after };
  }
  return { sid, files: 1 + subFiles.length, resps: all, t, covered };
}
// Spend over ALL fleet transcripts (main + subagents), grouped by project dir.
function fleetSpend() {
  const byDir = {}, models = {};
  let all = [];
  const cov = { sessions: 0, costStateUsd: 0, transcriptUsd: 0, afterUsd: 0 }, unc = { sessions: 0, usd: 0 };
  for (const d of fleetDnames()) {
    const dir = path.join(PROJECTS, d);
    let mains = [];
    try { mains = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')).map(f => path.join(dir, f)); } catch {}
    let resps = [], files = 0;
    const dc = { costStateUsd: 0, uncoveredUsd: 0 };
    for (const f of mains) {
      const s = sessionSpend(dir, f);
      resps = resps.concat(s.resps); files += s.files;
      if (s.covered) { cov.sessions++; cov.costStateUsd += s.covered.costStateUsd; cov.transcriptUsd += s.covered.transcriptUsd; cov.afterUsd += s.covered.afterUsd; dc.costStateUsd += s.covered.costStateUsd; dc.uncoveredUsd += s.covered.afterUsd; }
      else { unc.sessions++; unc.usd += s.t.usd; dc.uncoveredUsd += s.t.usd; }
    }
    for (const r of resps) models[r.model] = (models[r.model] || 0) + 1;
    byDir[d] = Object.assign(tokenSums(resps), { files }, dc);
    all = all.concat(resps);
  }
  const observed = cov.transcriptUsd > 0 ? cov.costStateUsd / cov.transcriptUsd - 1 : null;
  const overhead = Math.max(observed == null ? 0 : observed, HIDDEN_OVERHEAD_FLOOR);
  const estimate = cov.costStateUsd + (cov.afterUsd + unc.usd) * (1 + overhead);
  const r4 = (x) => Math.round(x * 1e4) / 1e4;
  return {
    at: iso(), total: tokenSums(all), byDir, models, cap: SPEND_CAP, refuseAt: spendStop().usd,
    hidden: { sessionsWithCostState: cov.sessions, costStateUsd: r4(cov.costStateUsd), transcriptUsdCovered: r4(cov.transcriptUsd), observedOverhead: observed == null ? null : r4(observed), appliedOverhead: r4(overhead), uncoveredSessions: unc.sessions },
    estimate: r4(estimate),
  };
}
function appendSpendLog(sp, note) {
  const f = path.join(EVID, 'fleet-spend.jsonl');
  fs.mkdirSync(EVID, { recursive: true });
  const byDir = {}; for (const [d, v] of Object.entries(sp.byDir)) byDir[d.replace(/^.*-vibepet-ultra-fleet-/, '')] = v.usd;
  fs.appendFileSync(f, JSON.stringify({ at: sp.at, usd: sp.total.usd, estimateUsd: sp.estimate, hidden: sp.hidden, responses: sp.total.responses, tokens: { in: sp.total.input, out: sp.total.output, cw5m: sp.total.cacheWrite5m, cw1h: sp.total.cacheWrite1h, cr: sp.total.cacheRead }, byRepo: byDir, models: sp.models, note: note || undefined }) + '\n');
}
const estimateUsd = (sp) => sp.estimate;
// The stop in force: the lowest of the $4.50 default, the round's budget in ULTRA/fleet/spend-stop (one number, set
// by whoever runs the round) and VP_SPEND_STOP. Neither can raise it; unparsable values are ignored.
function spendStop() {
  let file = ''; try { file = fs.readFileSync(SPEND_STOP_FILE, 'utf8').trim(); } catch {}
  const c = [{ usd: SPEND_REFUSE_AT, from: 'default' }, { usd: Number(file), from: SPEND_STOP_FILE }, { usd: Number(process.env.VP_SPEND_STOP), from: 'VP_SPEND_STOP' }]
    .filter(x => x.usd > 0);
  return c.reduce((a, b) => (b.usd < a.usd ? b : a));
}
function assertBudget(what) {
  const sp = fleetSpend(), stop = spendStop();
  if (sp.estimate >= stop.usd) throw new Error(`refusing ${what}: estimated fleet spend $${sp.estimate.toFixed(4)} (transcripts $${sp.total.usd.toFixed(4)}, hidden-call overhead ${Math.round(sp.hidden.appliedOverhead * 100)}%) >= stop $${stop.usd} (${stop.from}; cap $${SPEND_CAP})`);
  return sp;
}

module.exports = {
  HOME, ULTRA, FLEET, ROOT, STATE_FILE, CLAUDE_HOME, PROJECTS, SESSIONS, EVID, FLEET_TAG, TMUX_PREFIX, TMUX, CLAUDE_BIN, PANE_PATH,
  SPEND_CAP, SPEND_REFUSE_AT, SPEND_STOP_FILE, spendStop, HIDDEN_OVERHEAD_FLOOR, PRICES, estimateUsd, sessionSpend,
  cleanEnv, dname, isFleetDname, sleep, now, iso,
  loadMembers, loadState, saveState,
  LEASES, LEASE_TTL_SEC, readLease, listLeases, acquireLease, releaseLease, leaseLabel,
  tmux, hasSession, fleetSessions, capture, paneInfo, sendKeys, sendLiteral, sendLine, assertOurs,
  psTable, descendants, argsOf, claudePidOf, childProcs, readRegistry,
  readJsonl, walkJsonl, fleetDnames, transcriptPath, subagentFiles, contentOf, tailState,
  usageCost, responsesOf, tokenSums, fleetSpend, appendSpendLog, assertBudget,
};
