// agents — read Claude Code session tails, and find the terminal a session lives in.
// Nothing here runs a process except locate/focus, which main.js calls only from the 'jump' handler (a click).
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

const { intentful, evidence } = require('./goal');
const SESS_DIR = require('./overrides').sessionsDir();   // Claude Code's own <pid>.json registry (~/.claude/sessions)

function readTail(file, bytes = 131072, maxBytes = 16 * 1048576) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    for (;;) {
      const start = Math.max(0, size - bytes);
      const buf = Buffer.alloc(size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      const lines = buf.toString('utf8').split('\n');
      if (start > 0) lines.shift();
      // a single huge record can swallow the whole window; widen until we get a full line
      if (start === 0 || bytes >= maxBytes || lines.some(l => l.trim())) return lines;
      bytes *= 4;
    }
  } finally { fs.closeSync(fd); }
}

function textOf(content) {
  if (typeof content === 'string') return content;
  return (content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
}

// one line for the pill: markdown stripped, whitespace collapsed, ≤ n chars (a question keeps its '?')
const plain = t => t.replace(/\*\*|__|`/g, '').replace(/^\s*(?:[-*>#]+|\d+\.)\s*/, '').replace(/\s+/g, ' ').trim();
function cap(t, n = 120) {
  if (t.length <= n) return t;
  return t.endsWith('?') ? t.slice(0, n - 2).trimEnd() + '…?' : t.slice(0, n - 1).trimEnd() + '…';
}
const lastLine = t => plain(t.trim().split('\n').filter(l => l.trim()).pop() || '');
const firstSentence = t => { const p = plain(t.trim().split(/\n\s*\n/)[0] || ''); return (p.match(/^.*?[.!?](?=\s|$)/) || [p])[0]; };
// a pending tool call as the pill says it: 'Bash: npm test'; a question is its text and choices, a plan its first sentence
function toolAsk(c) {
  const i = c.input || {}, q = Array.isArray(i.questions) && i.questions[0];
  if (c.name === 'AskUserQuestion' && q) { const o = toolOpts(c) || []; return plain(String(q.question || q.header || '')) + (o.length ? ` (${o.map(x => x.label).join(' / ')})` : ''); }
  if (c.name === 'ExitPlanMode') return `Plan: ${firstSentence(String(i.plan || ''))}`.replace(/: $/, '');
  return `${c.name}: ${plain(String(i.command || i.file_path || i.pattern || i.url || i.description || ''))}`.replace(/: $/, '');
}
function toolOpts(c) {
  const q = Array.isArray(c.input?.questions) && c.input.questions[0];
  return q && Array.isArray(q.options) && q.options.length ? q.options.map((o, k) => ({ key: String(k + 1), label: plain(String(o?.label ?? o)) })) : undefined;
}

// a real human prompt: typed text (or a /command), not a tool result, hook echo or background-task notice
function humanAt(d) {
  if (d.type !== 'user' || d.isMeta || d.isSidechain) return 0;
  const c = d.message?.content;
  if (Array.isArray(c) && c.some(b => b.type === 'tool_result')) return 0;
  const t = textOf(c).trimStart();
  if (!t || t.startsWith('[Request interrupted') || (t.startsWith('<') && !t.startsWith('<command-'))) return 0;
  return Date.parse(d.timestamp) || 0;
}

// ---------- receipt: what this turn touched, and whether a check ran green after it ----------
// a runner at the start of a command segment (after &&, ||, ;, |, a newline or env assignments); a bare 'build'/'test' word never matches
const CHECK_RE = /(?:^|&&|\|\||[;|\n(])\s*(?:\w+=\S*\s+)*((?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|build|lint|typecheck|check)\b|npx\s+(?:tsc|jest|vitest|eslint|playwright)\b|tsc\b|pytest\b|cargo\s+(?:test|build|check|clippy)\b|go\s+(?:test|build|vet)\b|xcodebuild\b|swift\s+(?:test|build)\b|make\s+(?:test|check|build)\b|node\s+--(?:test|check)\b)/;
const FAIL_RE = /\b[1-9]\d* (?:failed|failing|failures?|errors?)\b|\bFAIL(?:ED)?\b|npm ERR!|^error(?:\[E\d+\])?:|\berror TS\d+|^# fail [1-9]/m;
const PASS_RE = /\b[1-9]\d* (?:passed|passing)\b|\bBUILD SUCCEEDED\b|\btest result: ok\b|^ok\s|^# pass [1-9]/m;
const EDITS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);
const nl = s => typeof s === 'string' && s ? s.split('\n').length : 0;
const tsOf = l => Date.parse((l.match(/"timestamp":"([^"]+)"/) || [])[1]) || 0;
function receipt(lines, turnAt, side = false, fallback = false) {
  let first = 0, on = false, check, lastEditAt = 0, add = 0, del = 0;
  const checks = [];
  const edits = new Map(), results = new Map();   // tool_use_id -> edit | tool_result
  for (const l of lines) {
    if (!on) { const t = tsOf(l); if (!t) continue; first ||= t; if (t < turnAt) continue; on = true; }
    if (!l.includes('"tool_use"') && !l.includes('"tool_result"')) continue;
    let d; try { d = JSON.parse(l); } catch { continue; }
    if (d.isSidechain && !side) continue;
    const at = Date.parse(d.timestamp) || 0;
    for (const c of Array.isArray(d.message?.content) ? d.message.content : []) {
      if (c.type === 'tool_result') results.set(c.tool_use_id, c);
      if (c.type !== 'tool_use') continue;
      const i = c.input || {};
      if (EDITS.has(c.name) && (i.file_path || i.notebook_path)) {
        const pairs = c.name === 'MultiEdit' ? (i.edits || []).map(e => [e.new_string, e.old_string]) : [[i.new_string ?? i.content ?? i.new_source, i.old_string]];
        edits.set(c.id, { file: path.resolve(d.cwd || '/', i.file_path || i.notebook_path), at,
          add: pairs.reduce((s, p) => s + nl(p[0]), 0), del: pairs.reduce((s, p) => s + nl(p[1]), 0) });
      } else if (c.name === 'Bash' && typeof i.command === 'string') {
        const m = i.command.match(CHECK_RE);
        if (m) { const s = m.index + m[0].indexOf(m[1]);
          // a pipe, ';' or '||' after the runner hides its exit code ('npm test | tail' exits 0 on red): read the output instead
          checks.push({ id: c.id, cmd: i.command.slice(s).split('\n')[0].slice(0, 24), full: i.command, at,
            masked: /[|;\n]/.test(i.command.slice(s + m[1].length)) && !/pipefail/.test(i.command) }); }
      }
    }
  }
  const files = new Set();
  for (const [id, e] of edits) {
    if (results.get(id)?.is_error) continue;   // a rejected or failed edit touched nothing
    files.add(e.file); add += e.add; del += e.del; lastEditAt = Math.max(lastEditAt, e.at);
  }
  for (const ch of checks) {
    const r = results.get(ch.id), t = r ? textOf(r.content) || '' : '', x = t.match(/^Exit code (\d+)/);
    if (r && !/^(?:The user doesn't want|\[Request interrupted|Command running in background)/.test(t)) {
      if (r.is_error || x) Object.assign(ch, { ok: false, exit: x ? +x[1] : undefined });
      else if (!ch.masked || PASS_RE.test(t) && !FAIL_RE.test(t)) ch.ok = true;
      else if (FAIL_RE.test(t)) ch.ok = false;
    }
    delete ch.id; delete ch.masked;
  }
  // the last run of each command after the last edit; a red one outranks a later green of another command (lint ✓ can't hide test ✗)
  const last = new Map(); for (const ch of checks) last.set(ch.cmd, ch);
  check = [...last.values()].filter(ch => ch.at >= lastEditAt && ch.ok === false).sort((a, b) => b.at - a.at)[0] || checks[checks.length - 1];
  if (!files.size && !check) return undefined;
  return { files, add, del, check, lastEditAt, stale: !!check && lastEditAt > check.at, truncated: fallback || (!side && !!first && turnAt < first) };
}
// the parent's receipt, widened by its counted children: union of files, the latest check wins, stale if any edit follows it
function foldReceipt(rc, kids) {
  const all = [rc, ...kids].filter(Boolean);
  if (all.length < 2) return rc;
  const files = new Set(all.flatMap(r => [...r.files])), check = all.map(r => r.check).filter(Boolean).sort((a, b) => b.at - a.at)[0];
  const lastEditAt = Math.max(0, ...all.map(r => r.lastEditAt));
  return { files, add: all.reduce((s, r) => s + r.add, 0), del: all.reduce((s, r) => s + r.del, 0), check, lastEditAt,
    stale: !!check && lastEditAt > check.at, truncated: all.some(r => r.truncated) };
}

// what a subagent is doing right now, and how big its context is: newest assistant record's tool call (or text) + usage
function activity(lines) {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"type":"assistant"')) continue;
    let d; try { d = JSON.parse(lines[i]); } catch { continue; }
    const m = d.message || {}, u = m.usage || {}, tools = (m.content || []).filter(c => c.type === 'tool_use');
    const tok = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.output_tokens || 0);
    const t = tools[tools.length - 1], doing = t ? (t.input?.description ? plain(String(t.input.description)) : toolAsk(t)) : firstSentence(textOf(m.content));
    return { doing: doing ? cap(doing, 70) : '', tok };
  }
  return { doing: '', tok: 0 };
}
// side: a subagent's own file, whose records are all sidechain
function classify(file, mtimeMs, side = false) {
  const idle = Date.now() - mtimeMs;
  const lines = readTail(file);
  let cwd = null, title, turnAt = 0;
  for (let i = lines.length - 1; i >= 0 && title === undefined; i--) {
    if (!lines[i].includes('"ai-title"')) continue;
    try { const d = JSON.parse(lines[i]); if (d.type === 'ai-title' && d.aiTitle) title = String(d.aiTitle).slice(0, 80); } catch {}
  }
  for (let i = lines.length - 1; i >= 0 && !side && !turnAt; i--) {
    if (!lines[i].includes('"type":"user"')) continue;
    try { turnAt = humanAt(JSON.parse(lines[i])); } catch {}
  }
  const fallback = !turnAt && !side;
  turnAt ||= Date.now() - 45 * 60e3;
  const rc = receipt(lines, side ? 0 : turnAt, side, fallback);   // same lines, no extra read
  const act = side ? activity(lines) : null;
  const ev = side ? undefined : evidence(lines);
  // phase: the transcript's own rule (a session with no registry entry); kind + at: what the tail is, since when (its record's
  // timestamp, Claude Code's clock). scan() joins Claude Code's registry, which outranks both for a live session.
  const out = (phase, kind, at, ask, extra) => ({ phase, kind, at, cwd, title, turnAt, fallback, receipt: rc, ev, ...(ask ? { ask: cap(ask) } : {}), ...(act || {}), ...extra });
  let local = false;   // walking back over a local command's output (/cost, /model …): its command decides, not the output
  for (let i = lines.length - 1; i >= 0; i--) {
    let d; try { d = JSON.parse(lines[i]); } catch { continue; }
    if (!cwd && d.cwd) cwd = d.cwd;
    if ((d.isSidechain && !side) || d.isMeta || (d.type !== 'assistant' && d.type !== 'user')) continue;
    cwd = d.cwd || cwd;
    const at = Date.parse(d.timestamp) || 0;
    if (d.type === 'assistant') {
      const m = d.message || {}, tools = (m.content || []).filter(c => c.type === 'tool_use');
      if (tools.length) {
        const t = tools[tools.length - 1], x = { tool: t, toolAt: at, agentWait: tools.some(c => c.name === 'Agent' || c.name === 'Task') };
        // a question or a plan is a dialog the moment it's asked; any other tool is a dialog or just long (unstick tells)
        if (t.name === 'AskUserQuestion') return out('waiting', 'question', at, toolAsk(t), { ...x, options: toolOpts(t) });
        if (t.name === 'ExitPlanMode') return out('stalled', 'plan', at, toolAsk(t), x);
        return idle > 90000 ? out('stalled', 'approval', at, toolAsk(t), x) : out('working', 'running', at, undefined, x);
      }
      if (['end_turn', 'stop_sequence', 'max_tokens'].includes(m.stop_reason)) {
        const t = textOf(m.content).trim(), q = t.endsWith('?');   // a question needs you; anything else is just done
        return out(idle > 5 * 60e3 ? 'parked' : q ? 'waiting' : 'ready', q ? 'input' : 'done', at, q ? lastLine(t) : firstSentence(t), { end: true });
      }
      return out('working', 'running', at);
    }
    const txt = textOf(d.message?.content);
    if (!side && /^<command-name>\/(?:exit|quit)</.test(txt)) return out('exited', 'exited', at);   // /exit: that claude is gone
    if (!side && txt.startsWith('<local-command-stdout>')) { local = true; continue; }
    if (local && txt.startsWith('<command-name>')) { local = false; continue; }
    local = false;
    if (txt.startsWith('[Request interrupted')) return out('parked', 'done', at, 'interrupted');
    return out(idle > 120000 && !side ? 'parked' : 'working', 'running', at);   // a subagent thinking past 2 min after a tool result is still running (fanout ages it out at 10)
  }
  return null;
}

// the session's opening ask, as a default goal: the first prompt that states intent in the file's head (a /command or pasted tag doesn't count)
function firstPrompt(file, chunk = 262144, maxBytes = 4 * 1048576) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = Math.min(fs.fstatSync(fd).size, maxBytes);
    let pos = 0, rest = '', asks = 0;
    while (pos < size) {   // the head can hold 300KB+ of hook/skill attachments before the first prompt: read on, chunk by chunk
      const buf = Buffer.alloc(Math.min(chunk, size - pos));
      fs.readSync(fd, buf, 0, buf.length, pos); pos += buf.length;
      const lines = (rest + buf.toString('utf8')).split('\n');
      rest = pos < size ? lines.pop() : '';
      for (const l of lines) {
        if (!l.includes('"type":"user"')) continue;
        let d; try { d = JSON.parse(l); } catch { continue; }
        if (!humanAt(d)) continue;
        const t = textOf(d.message?.content).trim();
        if (t.startsWith('<')) continue;
        const g = firstSentence(t);
        if (intentful(g)) return cap(g, 80);   // 'cd vibepet' or 'commit it' is a reflex, not a goal: keep reading
        if (++asks >= 8) return null;
      }
    }
    return null;
  } finally { fs.closeSync(fd); }
}

// ---------- fan-out: the subagents a session is waiting on ----------
// The parent jsonl goes silent while its children run; their files live in <session>/subagents/.
const kidCache = new Map(), metaCache = new Map();   // child path -> { size, mtimeMs, k: { phase, stuck, ask } } | meta
function meta(fp) {
  if (metaCache.has(fp)) return metaCache.get(fp);
  let m = {}; try { m = JSON.parse(fs.readFileSync(fp.slice(0, -6) + '.meta.json', 'utf8')) || {}; } catch {}
  if (metaCache.size > 4000) metaCache.clear();
  metaCache.set(fp, m); return m;
}
function kidPhase(fp, st) {
  const hit = kidCache.get(fp);
  if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) return hit.k;
  let c = null; try { c = classify(fp, st.mtimeMs, true); } catch {}
  // stuck: silent > 90 s on a tool that isn't itself an Agent call. Subagent approvals block in the parent's terminal.
  const k = { phase: c?.phase || null, stuck: c?.phase === 'stalled' && !c.agentWait, ask: c?.ask, rc: c?.receipt, doing: c?.doing || '', tok: c?.tok || 0 };
  if (kidCache.size > 4000) kidCache.clear();
  kidCache.set(fp, { size: st.size, mtimeMs: st.mtimeMs, k });
  return k;
}
function fanout(file, turnAt = Date.now() - 45 * 60e3, rc) {
  const dir = path.join(file.slice(0, -6), 'subagents');
  let names; try { names = fs.readdirSync(dir); } catch { return null; }
  // workflow runs keep their agents one level down: subagents/workflows/<run>/agent-*.jsonl
  let wf = []; try { wf = fs.readdirSync(path.join(dir, 'workflows')).map(w => path.join('workflows', w)); } catch {}
  for (const w of wf) try { names.push(...fs.readdirSync(path.join(dir, w)).map(n => path.join(w, n))); } catch {}
  const now = Date.now(), kids = [];
  let newestAt = 0;
  for (const n of names) {
    if (!n.endsWith('.jsonl') || !path.basename(n).startsWith('agent-')) continue;
    const fp = path.join(dir, n);
    let st; try { st = fs.statSync(fp); } catch { continue; }
    if (st.mtimeMs < turnAt) continue;                    // finished before this turn began
    newestAt = Math.max(newestAt, st.mtimeMs);
    kids.push({ fp, st, m: meta(fp) });
  }
  const top = kids.filter(k => !k.m.parentAgentId), depth = k => k.m.spawnDepth ?? 1;
  const min = Math.min(...kids.map(depth));
  const direct = (top.length ? top : kids.filter(k => depth(k) === min)).sort((a, b) => b.st.mtimeMs - a.st.mtimeMs).slice(0, 32);
  let open = 0, oldestOpenAt = null, stuck = 0, stuckAsk;
  const rcs = [];
  const items = direct.map(k => {
    const p = kidPhase(k.fp, k.st), o = (p.phase === 'working' || p.phase === 'stalled') && now - k.st.mtimeMs < 10 * 60e3;
    if (o) { open++; const b = k.st.birthtimeMs || k.st.mtimeMs; oldestOpenAt = Math.min(oldestOpenAt ?? b, b); }
    if (o && p.stuck) { stuck++; stuckAsk ??= p.ask; }
    if (p.rc) rcs.push(p.rc);
    return { desc: cap(plain(String(k.m.description || '')), 60), open: o, type: String(k.m.agentType || 'agent'), doing: p.doing, tok: p.tok,
      startAt: k.st.birthtimeMs || k.st.mtimeMs, stuck: o && p.stuck };
  });
  return { total: direct.length, done: direct.length - open, open, stuck, stuckAsk, oldestOpenAt, newestAt: newestAt || null, items, receipt: foldReceipt(rc, rcs) };
}
// open children keep a parent working: not done, and not stuck on the Agent call it's waiting on. A question still needs you,
// and so does a child stuck on its own tool (its approval prompt is in the parent's terminal): then the parent is stuck, on the child's ask.
function settle(c, fo) {
  if (!c || !(fo?.open > 0)) return c?.phase;
  if (c.phase === 'ready' || c.phase === 'parked' || (c.phase === 'stalled' && c.agentWait)) return fo.stuck > 0 ? 'stalled' : 'working';
  return c.phase;
}

// ---------- one state per session: kind, since, ask ----------
// kind: approval | question | plan | input (all four = needs you) | done | running | exited. phase keeps the values the
// renderer maps: approval/plan 'stalled', question/input 'waiting', done 'ready', running 'working', plus 'exited'.
const PHASE = { approval: 'stalled', plan: 'stalled', question: 'waiting', input: 'waiting', done: 'ready', running: 'working', exited: 'exited' };
const NEEDS = new Set(['approval', 'question', 'plan', 'input']), EXIT_MS = 10 * 60e3;   // an exited session stays listed 10 min, last
// the one queue order (snapshot, Home, roster, jump key): needs you → done → running → exited, oldest first in each
const RANK = { approval: 0, question: 0, plan: 0, input: 0, done: 1, running: 2, exited: 3 };
const byQueue = (a, b) => (RANK[a.kind] ?? 2) - (RANK[b.kind] ?? 2) || a.since - b.since || (a.id < b.id ? -1 : 1);

// a live session: Claude Code's registry decides. It flips ~75 ms after a tool_use, also while the record itself is
// withheld (an open dialog, 1 in 5). The transcript adds what the dialog asks and the last answer; the pane (registry.js
// e.dialog) what a withheld dialog asks. since = the status's own start, on Claude Code's clock.
function withEntry(c, e, fo) {
  const t = c.tool && !c.agentWait && c.toolAt >= (e.statusUpdatedAt || 0) - 10e3 ? c.tool : null, d = e.dialog, since = e.statusUpdatedAt || c.at;
  if (e.status === 'waiting') {
    const w = String(e.waitingFor || ''), kind = t?.name === 'ExitPlanMode' || d?.kind === 'plan' ? 'plan' : /permission/.test(w) ? 'approval'
      : /input/.test(w) ? 'question' : d?.kind || (t ? (t.name === 'AskUserQuestion' ? 'question' : 'approval') : 'input');
    const ask = (t && toolAsk(t)) || d?.ask || (kind === 'approval' && fo?.stuck && fo.stuckAsk) || (kind === 'approval' || kind === 'plan' ? 'needs approval - see terminal' : 'needs an answer - see terminal');
    return { kind, since, ask, options: d?.options || (t && toolOpts(t)) };
  }
  // busy: a running tool's clock starts at its call, or at the approval that let it run
  if (e.status === 'busy') return { kind: 'running', since: Math.max(since, c.tool ? c.toolAt : 0), ask: c.tool && !c.agentWait ? toolAsk(c.tool) : undefined };
  if (e.status === 'idle') return { kind: c.kind === 'input' ? 'input' : 'done', since, ask: c.kind === 'input' || c.kind === 'done' ? c.ask : undefined };
  return null;   // a status this build doesn't know: the transcript's rule, but never parked (its claude is alive)
}
// no registry entry (the desktop app, an older CLI): the transcript's own rules, settled against the subagents. A tool
// unstick (main.js) saw running stays 'running' through prev.busyAt, so its clock never restarts.
function fromTranscript(c, fo, prev) {
  let phase = settle(c, fo), kind = phase === c.phase ? c.kind : phase === 'working' ? 'running' : 'approval', busyAt;
  if (phase === 'stalled' && kind === 'approval' && c.toolAt && prev?.busyAt === c.toolAt) { phase = 'working'; kind = 'running'; busyAt = c.toolAt; }
  const since = kind !== 'running' ? c.at : c.tool ? c.toolAt : c.fallback ? c.at : c.turnAt;
  const ask = kind === 'running' ? undefined : phase === 'stalled' && fo?.stuck && (c.phase !== 'stalled' || c.agentWait) ? fo.stuckAsk : c.ask;
  return { phase, kind, since, ask, options: c.options, busyAt };
}

// every live session under root (~/.claude/projects), joined with reg (registry.js: sessionId -> live entry).
// onChange(s, prev) when a session's phase or since changes (a new episode). Returns copies in queue order.
function scan(root, sessions, onChange, reg = new Map()) {
  let dirs; try { dirs = fs.readdirSync(root); } catch { return []; }
  const now = Date.now(), seen = new Set(), out = [], pids = new Set([...reg.values()].map(e => e.pid));
  for (const dname of dirs) {
    if (dname.includes('private-tmp') || dname.includes('scratchpad')) continue; // throwaway worker sessions
    const dir = path.join(root, dname);
    let files; try { files = fs.readdirSync(dir); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const fp = path.join(dir, f), id = f.slice(0, -6), e = reg.get(id), prev = sessions.get(id);
      let st; try { st = fs.statSync(fp); } catch { continue; }
      // gone: no entry now for a session seen alive (or seen exit) this run, and nothing written since it went
      const gone = !e && !!prev && (prev.alive === true || !!prev.exitAt) && !(prev.exitAt && st.mtimeMs > prev.exitAt + 5000);
      if (gone && prev.exitAt && now - prev.exitAt >= EXIT_MS) { seen.add(id); continue; }   // shown its 10 min: stays out
      const age = now - st.mtimeMs;
      // a live claude stays listed however long it's quiet; a silent file with none is skipped, unless its children still run
      if (!e && !gone && age > 45 * 60e3 && (age > 12 * 3600e3 || !(now - (fanout(fp)?.newestAt || 0) <= 45 * 60e3))) continue;
      let c; try { c = classify(fp, st.mtimeMs); } catch { continue; }
      if (!c) continue;
      const fo = fanout(fp, c.turnAt, c.receipt), receipt = fo ? fo.receipt : c.receipt;
      if (fo) delete fo.receipt;
      seen.add(id);
      let v = e && withEntry(c, e, fo), alive = e ? true : null;
      if (v) v.phase = PHASE[v.kind];
      else if (gone) {   // exited within one tick of its entry going. Not listed: the same claude in another session now (/clear,
        // /resume: nobody exited), or a headless one (a registry kind other than interactive: `claude -p` runs end by design)
        const exitAt = prev.exitAt || (c.kind === 'exited' ? c.at : now);
        v = { phase: 'exited', kind: 'exited', since: exitAt, exitAt, hide: prev.hide || prev.headless || (prev.alive === true && pids.has(prev.pid)) }; alive = false;
      } else {
        v = fromTranscript(c, fo, prev);
        if (e) { if (v.kind === 'exited') v.kind = 'done'; if (v.phase === 'parked' || v.phase === 'exited') v.phase = PHASE[v.kind]; }   // an unknown registry status: alive, never parked
        else if (v.kind === 'exited') { alive = false; v.exitAt = v.since; }
      }
      const name = c.cwd ? path.basename(c.cwd) : e?.cwd ? path.basename(e.cwd) : dname.split('-').pop();
      const s = { id, file: fp, name, cwd: c.cwd || e?.cwd, phase: v.phase, kind: v.kind, since: v.since || st.mtimeMs, mtime: Math.max(st.mtimeMs, fo?.newestAt || 0),
        ask: v.ask ? cap(v.ask) : undefined, options: v.options, title: c.title || prev?.title, fanout: fo?.total ? fo : undefined, receipt, ev: c.ev, toolAt: c.toolAt,
        alive, pid: e?.pid ?? prev?.pid, term: e ? (e.tmux ? { tmux: e.tmux } : e.tty ? { tty: e.tty } : null) : null, exitAt: v.exitAt, hide: v.hide, busyAt: v.busyAt,
        headless: e ? !!e.kind && e.kind !== 'interactive' : prev?.headless };
      if (prev && (prev.phase !== s.phase || prev.since !== s.since)) onChange?.(s, prev);
      sessions.set(id, s);
      if (s.phase !== 'parked' && !(s.phase === 'exited' && (s.hide || now - s.since >= EXIT_MS))) out.push({ ...s });
    }
  }
  for (const id of [...sessions.keys()]) if (!seen.has(id)) sessions.delete(id);
  return out.sort(byQueue);
}

// ---------- where does a session live? (on click only) ----------
const run = (cmd, args, timeout = 3000) => new Promise(res =>
  execFile(cmd, args, { timeout, maxBuffer: 8e6 }, (e, out) => res(e ? null : out)));

async function psAll() {
  const out = await run('/bin/ps', ['-axo', 'pid=,ppid=,tty=,lstart=,comm=']);
  const procs = new Map();
  for (const l of (out || '').split('\n')) {
    const m = l.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(\w{3}\s+\w{3}\s+\d+\s+[\d:]+\s+\d{4})\s+(.+)$/);
    if (m) procs.set(+m[1], { pid: +m[1], ppid: +m[2], tty: m[3].startsWith('tty') ? '/dev/' + m[3] : null, start: Date.parse(m[4].replace(/\s+/g, ' ')), comm: m[5] });
  }
  return procs;
}

const locCache = new Map();   // session id -> { pid, tty }
const isClaude = p => !!p && path.basename(p.comm) === 'claude';
const regOf = pid => { try { return JSON.parse(fs.readFileSync(path.join(SESS_DIR, pid + '.json'), 'utf8')); } catch { return null; } };
// → { pid, tty, reg } or null. reg = the pid's registry entry (its tmux pane, status, waitingFor), read fresh each time;
// null reg = a claude found only by its cwd (no registry file: an older CLI)
async function locateSession(s, procs) {
  procs ||= await psAll();
  const hit = locCache.get(s.id), hr = hit && isClaude(procs.get(hit.pid)) ? regOf(hit.pid) : undefined;
  if (hr !== undefined && (!hr || hr.sessionId === s.id)) return { ...hit, reg: hr };   // a /clear or /resume moves the pid on
  locCache.delete(s.id);
  const cands = [...procs.values()].filter(isClaude), regs = new Map(cands.map(p => [p.pid, regOf(p.pid)]));
  const keep = (p, reg = null) => { const v = { pid: p.pid, tty: p.tty }; locCache.set(s.id, v); return { ...v, reg }; };
  for (const p of cands) if (regs.get(p.pid)?.sessionId === s.id) return keep(p, regs.get(p.pid));   // exact: Claude Code records which session each pid is running
  if (!s.cwd) return null;
  const free = cands.filter(p => !regs.get(p.pid));   // a pid whose registry names another session isn't this one: never guess it
  const cwds = await Promise.all(free.map(p => run('/usr/sbin/lsof', ['-a', '-p', String(p.pid), '-d', 'cwd', '-Fn'])));
  const same = free.filter((p, i) => (cwds[i] || '').split('\n').find(l => l.startsWith('n'))?.slice(1) === s.cwd);
  if (!same.length) return null;
  let born = Infinity; try { born = fs.statSync(s.file).birthtimeMs; } catch {}
  const gap = p => p.start <= born ? born - p.start : 1e13 + p.start - born;   // started closest to, and not after, the session
  return keep(same.sort((a, b) => gap(a) - gap(b))[0]);
}

// the terminal host: walk up from the shell to the first process inside an .app bundle (outermost bundle wins)
function hostApp(pid, procs) {
  for (let p = procs.get(procs.get(pid)?.ppid), n = 0; p && p.pid > 1 && n < 24; p = procs.get(p.ppid), n++) {
    const m = p.comm.match(/^(.*?\.app)\/Contents\//);
    if (m) return m[1];
  }
  return null;
}
const bidCache = new Map();
async function bundleId(app) {
  if (bidCache.has(app)) return bidCache.get(app);
  const out = await run('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', path.join(app, 'Contents', 'Info.plist')]);
  const bid = out ? out.trim() : null;
  if (bid) bidCache.set(app, bid);
  return bid;
}

const FOCUS = {
  'com.googlecode.iterm2': `on run argv
  tell application id "com.googlecode.iterm2"
    repeat with w in windows
      repeat with t in tabs of w
        repeat with s in sessions of t
          if tty of s is (item 1 of argv) then
            select w
            select t
            select s
            activate
            return "ok"
          end if
        end repeat
      end repeat
    end repeat
  end tell
  return "no"
end run`,
  'com.apple.Terminal': `on run argv
  tell application id "com.apple.Terminal"
    repeat with w in windows
      repeat with t in tabs of w
        if tty of t is (item 1 of argv) then
          set selected tab of w to t
          set index of w to 1
          activate
          return "ok"
        end if
      end repeat
    end repeat
  end tell
  return "no"
end run`,
};
// Terminals with no scripting dictionary (Ghostty, WezTerm, kitty…): tag the session's own tty with a one-off window
// title (OSC 2, invisible), find the window or native tab wearing it through Accessibility, raise it, then put a title
// back. Exact even when every tab says "Claude Code". Needs Accessibility once; 'noax' tells the caller to ask.
const TAG_FOCUS = `on run argv
  set tok to item 1 of argv
  repeat with i from 1 to 12
  -- first pass looks without switching apps; after that, activate (Accessibility only sees the current Space) and poll fast
  if i = 2 then tell application id (item 2 of argv) to activate
  if i > 2 then delay 0.08
  tell application "System Events"
    tell (first process whose bundle identifier is (item 2 of argv))
      repeat with w in windows
        if name of w contains tok then
          perform action "AXRaise" of w
          set frontmost to true
          return "ok"
        end if
        try
          repeat with b in radio buttons of tab group 1 of w
            if name of b contains tok then
              click b
              perform action "AXRaise" of w
              set frontmost to true
              return "ok"
            end if
          end repeat
        end try
      end repeat
    end tell
  end tell
  end repeat
  return "no"
end run`;
const osc2 = (tty, title) => { try { fs.writeFileSync(tty, `\x1b]2;${title}\x07`); return true; } catch { return false; } };
async function focusTagged(bid, tty, restore) {
  const tok = `vibepet-${Math.random().toString(36).slice(2, 8)}`;
  if (!osc2(tty, tok)) return false;
  const out = await new Promise(res => execFile('/usr/bin/osascript', ['-e', TAG_FOCUS, tok, bid], { timeout: 8000 }, (e, o, err) => res(e ? String(err || e.message) : o)));
  osc2(tty, restore || 'Claude Code');   // Claude Code re-titles on its next state change anyway
  if (/-1719|-25211|assistive|not allowed/i.test(out || '')) return 'noax';
  return out?.trim() === 'ok';
}
async function focusTty(bid, tty, restore) {
  if (!tty) return false;
  if (FOCUS[bid]) return (await run('/usr/bin/osascript', ['-e', FOCUS[bid], tty], 5000))?.trim() === 'ok';
  return bid ? focusTagged(bid, tty, restore) : false;
}

module.exports = { CHECK_RE, firstPrompt, humanAt, receipt, readTail, textOf, classify, fanout, settle, scan, byQueue, NEEDS, EXIT_MS, psAll, locateSession, hostApp, bundleId, focusTty, run };
