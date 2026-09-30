// theater/model.js — a Claude Code session jsonl (+ subagents, + git log) → a replayable Timeline. Pure: no fs, no electron.
// build(lines, { subagents: [{ meta, lines }], commits: [{ t, hash, subject }] }) → { beats, chapters, stats, meta }
const { humanAt, textOf, CHECK_RE } = require('../agents');
const { redact } = require('../content/edl');

const FAIL_RE = /\b[1-9]\d* (?:failed|failing|failures?|errors?)\b|\bFAIL(?:ED)?\b|npm ERR!|^error(?:\[E\d+\])?:|\berror TS\d+|^# fail [1-9]/m;
const EDITS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);
const READS = new Set(['Read', 'Grep', 'Glob', 'LS', 'WebFetch', 'WebSearch', 'NotebookRead']);
const AGENTS = new Set(['Agent', 'Task']);
const GAP = 6000;          // idle longer than this collapses to it: a 40-minute lunch replays as 6s
const MIN = 700;           // every beat gets at least this much stage time, even if the next one landed 10ms later
const DETAIL = 4000, TITLE = 110, HUNK_LINES = 80, DIFF_IN = 400;

const clean = s => redact(s).text;
const cap = (s, n) => { s = String(s || ''); return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…'; };
const one = s => String(s || '').replace(/\s+/g, ' ').trim();
const base = f => String(f || '').split('/').pop();
const home = s => String(s || '').replace(/^\/Users\/[^/]+|^\/home\/[^/]+/, '~');   // no usernames in paths (exports travel)

// a tiny line diff (LCS on ≤DIFF_IN lines each side) → [{ op: ' '|'+'|'-'|'…', s }] with 2 lines of context
function diff(a, b) {
  const A = String(a ?? '').split('\n').slice(0, DIFF_IN), B = String(b ?? '').split('\n').slice(0, DIFF_IN);
  if (a == null || a === '') return B.slice(0, HUNK_LINES).map(s => ({ op: '+', s: clean(s) })).concat(B.length > HUNK_LINES ? [{ op: '…', s: `+${B.length - HUNK_LINES} more lines` }] : []);
  const n = A.length, m = B.length, L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const ops = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && A[i] === B[j]) { ops.push({ op: ' ', s: A[i] }); i++; j++; }
    else if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) ops.push({ op: '+', s: B[j++] });
    else ops.push({ op: '-', s: A[i++] });
  }
  // keep changes + 2 lines around them; runs of unchanged context fold into one '…'
  const keep = ops.map((o, k) => o.op !== ' ' || ops.slice(Math.max(0, k - 2), k + 3).some(x => x.op !== ' '));
  const out = [];
  ops.forEach((o, k) => { if (keep[k]) out.push({ op: o.op, s: clean(o.s) }); else if (out.length && out[out.length - 1].op !== '…') out.push({ op: '…', s: '' }); });
  if (out[out.length - 1]?.op === '…') out.pop();
  return out.length > HUNK_LINES ? out.slice(0, HUNK_LINES).concat({ op: '…', s: `+${out.length - HUNK_LINES} more lines` }) : out;
}

function checkOk(isError, t) {
  if (isError || /^Exit code [1-9]/.test(t)) return false;
  if (FAIL_RE.test(t)) return false;   // a red count outranks a green one ("1 failed, 3 passed")
  return true;
}

function toolBeat(c, t, lane, cwd) {
  const i = c.input || {}, rel = f => home(String(f || '').replace(cwd ? cwd.replace(/\/$/, '') + '/' : '\0', ''));
  if (EDITS.has(c.name)) {
    const f = i.file_path || i.notebook_path;
    const pairs = c.name === 'MultiEdit' ? (i.edits || []).map(e => [e.old_string, e.new_string]) : [[c.name === 'Write' ? null : i.old_string, i.new_string ?? i.content ?? i.new_source]];
    const hunks = pairs.flatMap((p, k) => (k ? [{ op: '…', s: '' }] : []).concat(diff(p[0], p[1])));
    const add = hunks.filter(h => h.op === '+').length, del = hunks.filter(h => h.op === '-').length;
    return { t, lane, kind: 'edit', title: `${c.name === 'Write' ? 'Write' : 'Edit'} ${base(f)}`, detail: rel(f), files: [rel(f)], hunks, add, del };
  }
  if (c.name === 'Bash') {
    const cmd = String(i.command || ''), chk = CHECK_RE.test(cmd);
    return { t, lane, kind: chk ? 'check' : 'command', title: cap(one(clean(i.description || cmd)), TITLE), cmd: cap(clean(cmd), 600) };
  }
  if (AGENTS.has(c.name)) return { t, lane, kind: 'agent', title: cap(one(clean(i.description || 'subagent')), TITLE), detail: cap(clean(i.prompt || ''), DETAIL), agentType: i.subagent_type || 'agent' };
  if (READS.has(c.name)) {
    const what = i.file_path ? rel(i.file_path) : i.pattern || i.query || i.url || i.path || '';
    return { t, lane, kind: 'read', title: cap(`${c.name} ${one(clean(what))}`, TITLE), files: i.file_path ? [rel(i.file_path)] : [] };
  }
  return { t, lane, kind: 'read', title: cap(`${c.name.replace(/^mcp__[^_]+__/, '')} ${one(clean(i.description || i.command || i.url || ''))}`.trim(), TITLE) };
}

// one jsonl (main or a subagent) → raw beats on a lane; results fill back into their tool beats by id
function walk(lines, lane, byTool, side) {
  const beats = [];
  let cwd = null;
  for (const l of lines) {
    let d; try { d = JSON.parse(l); } catch { continue; }
    if (!d || !d.timestamp) continue;
    const t = Date.parse(d.timestamp); if (!t) continue;
    cwd ||= d.cwd || null;
    const content = d.message?.content;
    if (d.type === 'user') {
      if (!side && humanAt(d)) {
        // a /command arrives as tags; show it the way it was typed
        let txt = textOf(content).trim();
        const cn = txt.match(/<command-name>([^<]*)<\/command-name>/);
        if (cn) txt = `${cn[1]} ${(txt.match(/<command-args>([^<]*)<\/command-args>/) || [])[1] || ''}`.trim();
        beats.push({ t, lane, kind: 'prompt', title: cap(one(clean(txt)), TITLE), detail: cap(clean(txt), DETAIL) });
        continue;
      }
      for (const c of Array.isArray(content) ? content : []) {
        if (c.type !== 'tool_result') continue;
        const b = byTool.get(c.tool_use_id); if (!b) continue;
        const out = typeof c.content === 'string' ? c.content : textOf(c.content);
        b.out = cap(clean(out), DETAIL); b.doneAt = t;
        const denied = /^(?:The user doesn't want|\[Request interrupted)/.test(out);
        b.ok = denied ? false : b.kind === 'check' ? checkOk(c.is_error, out) : !c.is_error;
        if (denied) b.denied = true;
      }
    } else if (d.type === 'assistant') {
      for (const c of Array.isArray(content) ? content : []) {
        if (c.type === 'thinking' && c.thinking?.trim()) beats.push({ t, lane, kind: 'thinking', title: cap(one(clean(c.thinking)), TITLE), detail: cap(clean(c.thinking), DETAIL) });
        else if (c.type === 'text' && c.text?.trim()) beats.push({ t, lane, kind: 'reply', title: cap(one(clean(c.text)), TITLE), detail: cap(clean(c.text), DETAIL) });
        else if (c.type === 'tool_use') { const b = toolBeat(c, t, lane, d.cwd || cwd); b.id = c.id; byTool.set(c.id, b); beats.push(b); }
      }
    }
  }
  return { beats, cwd };
}

// `git log --format=%H%x09%at%x09%s` → commits
function parseGit(text) {
  return String(text || '').split('\n').map(l => l.split('\t')).filter(p => p.length >= 3 && /^[0-9a-f]{7,}$/.test(p[0]))
    .map(([hash, at, ...s]) => ({ hash: hash.slice(0, 7), t: +at * 1000, subject: s.join('\t') }));
}

function build(lines, { subagents = [], commits = [] } = {}) {
  const byTool = new Map();
  const main = walk(lines, 0, byTool, false);
  let beats = main.beats;
  // subagents fork off the Agent beat that spawned them (meta.toolUseId); nested ones fork off their parent's lane
  const lanes = [];
  const pending = subagents.map(s => ({ ...s })), placed = new Set();
  for (let pass = 0; pass < 4 && placed.size < pending.length; pass++) {
    pending.forEach((s, k) => {
      if (placed.has(k)) return;
      const parent = byTool.get(s.meta?.toolUseId);
      if (!parent && pass < 3) return;
      placed.add(k);
      const lane = lanes.length + 1, w = walk(s.lines, lane, byTool, true);
      if (!w.beats.length) return;
      lanes.push({ lane, from: parent ? parent.lane : 0, title: cap(one(clean(s.meta?.description || parent?.title || 'subagent')), 60), type: s.meta?.agentType || 'agent' });
      if (parent) parent.branch = lane;
      beats = beats.concat(w.beats);
    });
  }
  const t0 = beats.length ? Math.min(...beats.map(b => b.t)) : 0, t1 = beats.length ? Math.max(...beats.map(b => b.doneAt || b.t)) : 0;
  for (const c of commits) if (c.t >= t0 - 60e3 && c.t <= t1 + 5 * 60e3)
    beats.push({ t: c.t, lane: 0, kind: 'commit', title: cap(one(clean(c.subject)), TITLE), detail: c.hash, ok: true });
  beats.sort((a, b) => a.t - b.t || (a.lane - b.lane));
  // virtual clock: real gaps capped at GAP, floored at MIN per beat (parallel subagent beats still interleave by real time)
  let v = 0;
  beats.forEach((b, k) => { if (k) v += Math.min(GAP, Math.max(MIN, b.t - beats[k - 1].t)); b.v = v; b.i = k; delete b.id; });
  const dur = v + 2500;
  // chapters: one per human prompt; anything before the first prompt joins chapter 0
  const chapters = [];
  beats.forEach(b => {
    if (b.kind === 'prompt' || !chapters.length) chapters.push({ i: chapters.length, v: b.kind === 'prompt' ? b.v : 0, t: b.t, title: b.kind === 'prompt' ? b.title : 'Session start', beat: b.i });
    b.ch = chapters.length - 1;
  });
  const edits = beats.filter(b => b.kind === 'edit' && b.ok !== false), checks = beats.filter(b => b.kind === 'check');
  const stats = {
    prompts: beats.filter(b => b.kind === 'prompt').length, edits: edits.length, files: new Set(edits.flatMap(b => b.files)).size,
    add: edits.reduce((s, b) => s + b.add, 0), del: edits.reduce((s, b) => s + b.del, 0),
    commands: beats.filter(b => b.kind === 'command').length, checks: checks.length,
    passed: checks.filter(b => b.ok === true).length, failed: checks.filter(b => b.ok === false).length,
    agents: lanes.length, commits: beats.filter(b => b.kind === 'commit').length, beats: beats.length, realMs: t1 - t0, playMs: dur,
  };
  return { beats, chapters, lanes, stats, meta: { cwd: main.cwd, t0, t1, dur } };
}

module.exports = { build, diff, parseGit, GAP, MIN };
