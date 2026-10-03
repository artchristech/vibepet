#!/usr/bin/env node
// vibepet ultra — Round 0 ground truth, implementation "mineA" (Node, zero deps).
// Streams every top-level transcript ~/.claude/projects/<dir>/<sessionId>.jsonl and
// writes docs/ultra/round-0/mineA.json. PRIVACY: this script never prints or writes
// transcript text, paths or commands; only numbers, counts, durations, enum values.
// Usage: node mineA.js [--root DIR] [--out FILE] [--now ISO] [--cutoff ISO] [--dump FILE]
// Reconciled 2026-10-01 against mineB.py (see docs/ultra/round-0/ground-truth.md for the definition changes).
'use strict';
process.env.TZ = process.env.TZ || 'America/Denver'; // user's timezone: local days + last-30d window
const fs = require('fs'), path = require('path'), readline = require('readline');
const crypto = require('crypto'), { execFileSync } = require('child_process');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const ROOT = arg('--root', path.join(process.env.HOME, '.claude/projects'));
const OUT = arg('--out', path.join(__dirname, '..', 'round-0', 'mineA.json'));
const DUMP = arg('--dump', null); // optional: per-event JSONL (hashed session id, ms timestamps, enums only)
const T0 = Date.now();
// Snapshot: records with timestamp > CUTOFF and files born after CUTOFF are ignored (the corpus is live).
const CUTOFF = Date.parse(arg('--cutoff', '9999-12-31T00:00:00Z'));
// Approval (class c) comes in two definitions, both always computed:
// approval_spec = spec rule as written (Edit-like gap > 2 s in any mode, plus user rejections);
// approval      = only waits where a human prompt was shown (user rejections; ExitPlanMode; Edit-like tools in
//                 default/unknown mode). Under auto/acceptEdits/plan an Edit/Write shows no permission prompt.
const PROMPT_EDIT_MODES = new Set(['default', '?']);
const NONHUMAN_DENIALS = new Set(['automode-blocked', 'automode-unavailable', 'permission-rule', 'interrupted']);
const REJECT_RX = /doesn't want to proceed|user rejected|was rejected by the user|The user doesn't want/i;

// ---------- constants / definitions ----------
const MIN = 60e3, HOUR = 3600e3;
const LIVE_GAP = 30 * MIN;            // live span: consecutive records < 30 min apart
const AWAY_CENSOR = 2 * HOUR;         // waits > 2 h are 'away'
const AWAY_GAP = 20 * MIN;            // global away gap: no human prompt anywhere for >= 20 min
const EDIT_COLLIDE = 30 * MIN;
const EDITLIKE = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'ExitPlanMode']);
const FILE_EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
// Last 30 days: the 30 x 24 h ending at the cutoff (or now): [end - 30 d, end].
const W30_END = Math.min(CUTOFF, Date.now()) + 1, W30_START = W30_END - 1 - 30 * 864e5;
// List prices $/MTok: [input, output, cacheWrite5m, cacheWrite1h, cacheRead].
// Source: claude-api skill model table (cached 2026-09-25). Writes = 1.25x / 2x input,
// reads = 0.1x input unless the table states otherwise (Opus 5.5 $0.20, Fable 5.1 $0.25).
const P = (i, o, r) => [i, o, i * 1.25, i * 2, r == null ? i * 0.1 : r];
const PRICES = [
  ['claude-fable-5-1', P(10, 50, 0.25)], ['claude-fable-5', P(10, 50)],
  ['claude-opus-5-5', P(4, 20, 0.20)], ['claude-opus-5', P(5, 25)],
  ['claude-opus-4-8', P(5, 25)], ['claude-opus-4-7', P(5, 25)], ['claude-opus-4-6', P(5, 25)],
  ['claude-sonnet-5-5', P(2, 10, 0.20)], ['claude-sonnet-5', P(2, 10)], ['claude-sonnet-4-6', P(3, 15)],
  ['claude-haiku-4-5', P(1, 5)],
];
const priceOf = m => { if (!m) return null; for (const [k, p] of PRICES) if (m === k || m.startsWith(k + '-') || m.startsWith(k + '[')) return p; return null; };

// ---------- helpers ----------
const inc = (m, k, n = 1) => (m[k] = (m[k] || 0) + n);
const H = s => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 12);
function lin(a, p) { // linear interpolation (Hyndman-Fan type 7) on a sorted array
  const n = a.length; if (n === 1) return a[0]; const x = (n - 1) * p, lo = Math.floor(x), hi = Math.min(lo + 1, n - 1);
  return a[lo] + (a[hi] - a[lo]) * (x - lo);
}
function q(arr, p) { if (!arr.length) return null; return lin(Float64Array.from(arr).sort(), p); }
const r2 = x => x == null ? null : Math.round(x * 100) / 100;
function dist(arr, scale = 1) { // seconds by default
  if (!arr.length) return { n: 0 };
  const a = Float64Array.from(arr).sort(); const pick = p => r2(lin(a, p) / scale);
  let s = 0; for (const x of a) s += x;
  return { n: a.length, median: pick(0.5), p75: pick(0.75), p90: pick(0.9), p99: pick(0.99), max: r2(a[a.length - 1] / scale), mean: r2(s / a.length / scale) };
}
function textOf(c) {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.filter(b => b && b.type === 'text' && typeof b.text === 'string').map(b => b.text).join('\n');
  return '';
}
const hasToolResult = c => Array.isArray(c) && c.some(b => b && b.type === 'tool_result');
function isHumanPrompt(o) {
  if (o.type !== 'user' || o.isMeta || o.isSidechain) return false;
  const c = o.message && o.message.content;
  if (hasToolResult(c)) return false;
  const s = textOf(c).trim();
  if (!s) return false;
  if (s.startsWith('[Request interrupted')) return false;
  if (s.startsWith('<') && !s.startsWith('<command-')) return false;
  return true;
}
const isMachinePrompt = o => !!(o.isCompactSummary || o.scheduledTaskId); // compaction summary / scheduled fire: not human
function resultText(b) { const c = b && b.content; if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.filter(x => x && typeof x.text === 'string').map(x => x.text).join(' '); return ''; }
const localDay = ms => { const d = new Date(ms); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); };
const in30 = ms => ms >= W30_START && ms < W30_END;

// git repo resolution (filesystem only; never printed)
const repoCache = new Map();
function repoOf(dir) {
  if (!dir) return { top: null, common: null, missing: true };
  if (repoCache.has(dir)) return repoCache.get(dir);
  let res = { top: null, common: null, missing: !fs.existsSync(dir) };
  if (!res.missing) {
    let d = dir;
    for (;;) {
      const g = path.join(d, '.git');
      let st = null; try { st = fs.statSync(g); } catch {}
      if (st) {
        res.top = d; res.common = d;
        if (st.isFile()) { try {
          const m = /gitdir:\s*(.+)/.exec(fs.readFileSync(g, 'utf8'));
          if (m) { const gd = path.resolve(d, m[1].trim()); let cd = gd;
            try { cd = path.resolve(gd, fs.readFileSync(path.join(gd, 'commondir'), 'utf8').trim()); } catch {}
            res.common = path.basename(cd) === '.git' ? path.dirname(cd) : cd; }
        } catch {} }
        break;
      }
      const up = path.dirname(d); if (up === d) break; d = up;
    }
  }
  repoCache.set(dir, res); return res;
}

// ---------- file list ----------
const skipped = { dirs_private_tmp_or_scratchpad: 0, dirs_fleet: 0, files_in_skipped_dirs: 0, subagent_files_ignored: 0 };
const files = [];
for (const d of fs.readdirSync(ROOT)) {
  const dp = path.join(ROOT, d); let ents; try { ents = fs.readdirSync(dp, { withFileTypes: true }); } catch { continue; }
  const skip = /-vibepet-ultra-fleet-/.test(d) ? 'fleet' : /private-tmp|scratchpad/.test(d) ? 'tmp' : null;
  if (skip === 'fleet') skipped.dirs_fleet++; else if (skip) skipped.dirs_private_tmp_or_scratchpad++;
  for (const e of ents) {
    if (e.isFile() && e.name.endsWith('.jsonl')) {
      if (skip) { skipped.files_in_skipped_dirs++; continue; }
      const fp = path.join(dp, e.name); const st = fs.statSync(fp);
      const birth = st.birthtimeMs || st.mtimeMs; if (birth > CUTOFF) { skipped.files_born_after_cutoff = (skipped.files_born_after_cutoff || 0) + 1; continue; }
      files.push({ fp, sid: e.name.slice(0, -6), bytes: st.size, birth });
    } else if (e.isDirectory() && !skip) {
      try { const sd = path.join(dp, e.name, 'subagents'); if (fs.existsSync(sd)) skipped.subagent_files_ignored += countJsonl(sd); } catch {}
    }
  }
}
function countJsonl(d) { let n = 0; for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.isDirectory()) n += countJsonl(path.join(d, e.name)); else if (e.name.endsWith('.jsonl')) n++; } return n; }
// Older files first, so that records duplicated by resume/fork are attributed to the original file.
files.sort((a, b) => a.birth - b.birth || (a.fp < b.fp ? -1 : a.fp > b.fp ? 1 : 0));

// ---------- pass: stream + collect compact per-session data ----------
const sanity = { records: 0, parse_errors: 0, blank_lines: 0, dup_uuid_records_dropped: 0, sessionId_ne_filename: 0,
  no_timestamp_records: 0, bad_timestamp: 0, nonmonotonic_records: 0, nonmonotonic_by_type: {}, future_ts: 0, pre2025_ts: 0,
  compact_boundaries: 0, compact_summary_prompts_excluded: 0, scheduled_prompts_excluded: 0, records_after_cutoff: 0, sidechain_records: 0, assistant_records: 0, assistant_messages: 0,
  usage_records_deduped_by_message_id: 0, human_prompts: 0, human_prompts_with_origin_sender: 0,
  sessions_with_no_timestamps: 0, tool_use_without_result: 0, tool_result_without_use: 0, unpriced_models: {}, models: {},
  record_types: {}, permission_modes_seen: {} };
const seenUuid = new Set();
const sessions = [];
const NOW = Date.parse(arg('--now', '2026-10-01T23:59:59Z'));

async function readFile(f) {
  // One pass in file order. Turn waits (question/done) and tool waits (ask/approval) are paired on the fly.
  const S = { sid: f.sid, bytes: f.bytes, ts: [], prompts: [], msgs: new Map(), waits: [], literal: [],
    cwds: [], edits: [], bashEdits: [], commits: [], wakeups: [], wakeDelays: [], crons: [], loopPrompts: 0, costState: null,
    superseded: { question: 0, done_idle: 0 }, negDropped: 0, unanswered: { question: 0, ask: 0, approval: 0, done_idle: 0 },
    ad: { editlike_gap_gt2s: 0, editlike_by_mode: {}, edit_gap_excluded_nonprompting_mode: 0, user_rejection_any_tool: 0,
      excluded_bypassPermissions: 0, excluded_nonhuman_denial: {}, excluded_unknown_denial: 0, tool_results_total: 0,
      tool_results_by_mode: {}, bash_results: 0, bash_with_decisive_signal: 0, bash_fast_gt30s_nonauto: 0, denial_kind_gaps: {} } };
  let mode = '?', lastTs = 0, pend = null;
  const lastTextByMid = new Map(), pendTools = new Map(), litIdx = new Map();
  const rl = readline.createInterface({ input: fs.createReadStream(f.fp), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) { sanity.blank_lines++; continue; }
    let o; try { o = JSON.parse(line); } catch { sanity.parse_errors++; continue; }
    if (!o || typeof o !== 'object' || Array.isArray(o)) continue;
    let ts = null;
    if (o.timestamp) { ts = Date.parse(o.timestamp); if (!isFinite(ts)) { sanity.bad_timestamp++; ts = null; } }
    if (ts != null && ts > CUTOFF) { sanity.records_after_cutoff++; continue; }
    sanity.records++;
    inc(sanity.record_types, typeof o.type === 'string' && /^[a-z\-]{1,40}$/.test(o.type) ? o.type : 'other');
    if (o.uuid) { if (seenUuid.has(o.uuid)) { sanity.dup_uuid_records_dropped++; continue; } seenUuid.add(o.uuid); }
    if (o.sessionId && o.sessionId !== f.sid) sanity.sessionId_ne_filename++;
    if (o.isSidechain) sanity.sidechain_records++;
    if (o.permissionMode) { mode = o.permissionMode; inc(sanity.permission_modes_seen, /^[A-Za-z]{1,30}$/.test(mode) ? mode : 'other'); }
    if (o.type === 'system' && o.subtype === 'compact_boundary') sanity.compact_boundaries++;
    if (o.type === 'cost-state' && typeof o.totalCostUSD === 'number') S.costState = o.totalCostUSD;
    if (ts != null) {
      if (ts > NOW + 864e5) sanity.future_ts++;
      if (ts < Date.UTC(2025, 0, 1)) sanity.pre2025_ts++;
      if (ts < lastTs - 1000) { sanity.nonmonotonic_records++; inc(sanity.nonmonotonic_by_type, o.type); }
      lastTs = Math.max(lastTs, ts); S.ts.push(ts);
    } else { sanity.no_timestamp_records++; continue; }
    if (o.cwd && (!S.cwds.length || S.cwds[S.cwds.length - 1][1] !== o.cwd)) S.cwds.push([ts, o.cwd]);
    const c = o.message && o.message.content;

    if (o.type === 'user') {
      if (isHumanPrompt(o)) {
        if (isMachinePrompt(o)) { if (o.isCompactSummary) sanity.compact_summary_prompts_excluded++; else sanity.scheduled_prompts_excluded++; }
        else {
          S.prompts.push(ts); sanity.human_prompts++;
          if (o.origin && o.origin.senderTaskId) sanity.human_prompts_with_origin_sender++;
          const s = textOf(c).trim();
          if (/^\/loop\b/i.test(s) || /<command-name>\s*\/?loop\s*<\/command-name>/i.test(s)) S.loopPrompts++;
          if (pend) { if (ts < pend.start) S.negDropped++; else S.waits.push({ cls: pend.cls, start: pend.start, end: ts }); pend = null; }
          S.literalWaits = S.literalWaits || []; for (const [lt, lc] of S.literal.splice(0)) S.literalWaits.push([lc, ts - lt]);
          litIdx.clear();
        }
      }
      if (Array.isArray(c)) for (const b of c) if (b && b.type === 'tool_result') {
        const u = pendTools.get(b.tool_use_id); if (!u) { sanity.tool_result_without_use++; continue; }
        pendTools.delete(b.tool_use_id);
        const gap = ts - u.ts, dk = typeof o.toolDenialKind === 'string' ? o.toolDenialKind : null, err = !!b.is_error;
        const rej = err && REJECT_RX.test(resultText(b).slice(0, 600));
        const ad = S.ad; ad.tool_results_total++; inc(ad.tool_results_by_mode, u.mode);
        if (dk || rej) { const cat = EDITLIKE.has(u.name) ? 'editlike' : u.name === 'Bash' ? 'Bash' : u.name === 'AskUserQuestion' ? 'Ask' : 'other';
          const kk = cat + '|' + (dk && /^[a-z\-]{1,30}$/.test(dk) ? dk : dk ? 'other:' + H(dk).slice(0, 6) : 'regex-reject');
          (ad.denial_kind_gaps[kk] = ad.denial_kind_gaps[kk] || []).push(gap); }
        if (u.name === 'AskUserQuestion') { S.waits.push({ cls: 'ask', start: u.ts, end: ts }); continue; }
        if (u.name === 'Bash') { ad.bash_results++; if (dk || rej || u.mode === 'bypassPermissions') ad.bash_with_decisive_signal++; }
        // file edits & commits (successful)
        if (!err) {
          if (u.file && FILE_EDIT_TOOLS.has(u.name)) S.edits.push({ ts, file: u.file });
          if (u.commitDir) S.commits.push({ ts: u.ts, dir: u.commitDir });
          const tur = o.toolUseResult;
          const changed = tur && tur.bashEditDiff && Array.isArray(tur.bashEditDiff.changedFiles) ? tur.bashEditDiff.changedFiles : null;
          if (changed) for (const cf of changed) S.bashEdits.push({ ts, file: path.resolve(u.cwd || '/', String(cf)) });
        }
        if (u.name === 'ScheduleWakeup') { const tur = o.toolUseResult && typeof o.toolUseResult === 'object' ? o.toolUseResult : {};
          const d = typeof tur.clampedDelaySeconds === 'number' ? tur.clampedDelaySeconds : u.delay;
          if (typeof d === 'number' && !u.noop && !u.stop) S.wakeDelays.push(d); }
        // approval classification (class c)
        if (u.mode === 'bypassPermissions') { ad.excluded_bypassPermissions++; continue; }
        if (dk && NONHUMAN_DENIALS.has(dk)) { inc(ad.excluded_nonhuman_denial, dk); continue; }
        let sig = null, human = false;
        if (dk === 'user-rejected' || rej) { sig = 'user-rejected'; human = true; ad.user_rejection_any_tool++; }
        else if (dk) { ad.excluded_unknown_denial++; continue; }
        else if (EDITLIKE.has(u.name) && gap > 2000) {
          sig = 'edit_gap'; ad.editlike_gap_gt2s++; inc(ad.editlike_by_mode, u.mode);
          human = u.name === 'ExitPlanMode' || PROMPT_EDIT_MODES.has(u.mode);
          if (!human) ad.edit_gap_excluded_nonprompting_mode++;
        } else if (u.name === 'Bash' && u.mode !== 'auto' && gap > 30000) ad.bash_fast_gt30s_nonauto++; // diagnostic only (no decisive signal)
        if (sig) { const w = { start: u.ts, end: ts, key1: u.key1, key2: u.key2, name: u.name, mode: u.mode, sig };
          S.waits.push({ ...w, cls: 'approval_spec' }); if (human) S.waits.push({ ...w, cls: 'approval' }); }
      }
    } else if (o.type === 'assistant' && o.message) {
      sanity.assistant_records++;
      const m = o.message, mid = typeof m.id === 'string' ? m.id : null, id = mid || ('noid:' + o.uuid);
      // any assistant record of a DIFFERENT message supersedes a pending question/done wait (the session moved on)
      if (pend && !(mid && pend.mid === mid)) { S.superseded[pend.cls]++; pend = null; }
      let g = S.msgs.get(id);
      if (!g) { g = { first: ts, last: ts, model: m.model, u: {} }; S.msgs.set(id, g); }
      else sanity.usage_records_deduped_by_message_id++;
      g.last = Math.max(g.last, ts); g.first = Math.min(g.first, ts);
      if (m.model) g.model = m.model;
      if (m.usage) { const u = m.usage, cc = u.cache_creation || {};
        const set = (k, v) => { if (typeof v === 'number' && !(g.u[k] >= v)) g.u[k] = v; };
        set('in', u.input_tokens); set('out', u.output_tokens); set('cr', u.cache_read_input_tokens);
        set('cw', u.cache_creation_input_tokens); set('cw5', cc.ephemeral_5m_input_tokens); set('cw1', cc.ephemeral_1h_input_tokens); }
      if (Array.isArray(c)) for (const b of c) {
        if (!b) continue;
        if (b.type === 'text' && typeof b.text === 'string' && mid) lastTextByMid.set(mid, b.text);
        if (b.type === 'tool_use') {
          const inp = b.input || {};
          const u = { name: b.name, ts, mode, cwd: o.cwd, key1: null, key2: null };
          if (b.name === 'Bash' && typeof inp.command === 'string') {
            const cmd = inp.command.trim().replace(/\s+/g, ' ');
            u.key1 = H('Bash|' + cmd);
            u.key2 = H('Bash|' + cmd.split(' ').slice(0, 2).join(' '));
            const gm = /(?:^|[;&|(]\s*|\s)git((?:\s+-[Cc]\s+\S+)*)\s+commit\b/.exec(cmd);
            if (gm) { let dir = o.cwd; const cm = /-C\s+(\S+)/.exec(gm[1] || ''); if (cm) dir = path.resolve(o.cwd || '/', cm[1].replace(/^["']|["']$/g, '').replace(/^~/, process.env.HOME));
              u.commitDir = dir; }
          } else if (inp.file_path || inp.notebook_path) {
            const fp = path.resolve(o.cwd || '/', String(inp.file_path || inp.notebook_path));
            u.file = fp;
            const rp = repoOf(path.dirname(fp)); const rel = rp.top ? path.relative(rp.top, path.dirname(fp)) : path.dirname(fp);
            u.key1 = H(b.name + '|' + (rp.common || '') + '|' + rel + '|' + path.extname(fp));
            u.key2 = H(b.name + '|' + path.extname(fp));
          } else u.key1 = u.key2 = H(b.name + '|' + JSON.stringify(inp));
          if (b.name === 'ScheduleWakeup') { S.wakeups.push({ ts }); u.delay = inp.delaySeconds; u.noop = !!inp.noop; u.stop = !!inp.stop; }
          if (b.name === 'CronCreate') {
            let iv = null; for (const v of Object.values(inp)) if (typeof v === 'string') { const f5 = v.trim().split(/\s+/); if (f5.length >= 5 && f5.length <= 6) { const mm = /^\*\/(\d+)$/.exec(f5[0]), hh = /^\*\/(\d+)$/.exec(f5[1]);
              if (mm && f5[1] === '*') iv = +mm[1] * 60; else if (/^\d+$/.test(f5[0]) && f5[1] === '*') iv = 3600; else if (/^\d+$/.test(f5[0]) && hh) iv = +hh[1] * 3600; else if (/^\d+$/.test(f5[0]) && /^\d+$/.test(f5[1])) iv = 86400; else if (f5[0] === '*') iv = 60; } }
            S.crons.push({ ts, interval: iv });
          }
          pendTools.set(b.id, u);
        }
      }
      const sameTurn = pend && mid && pend.mid === mid;
      if (m.stop_reason === 'end_turn' || sameTurn) {
        let txt = mid ? lastTextByMid.get(mid) : undefined;
        if (txt == null && Array.isArray(c)) for (let i = c.length - 1; i >= 0; i--) if (c[i] && c[i].type === 'text' && typeof c[i].text === 'string') { txt = c[i].text; break; }
        const cls = txt && txt.trim().endsWith('?') ? 'question' : 'done_idle';
        pend = { cls, start: ts, mid };
        if (litIdx.has(id)) S.literal[litIdx.get(id)] = [ts, cls]; else if (m.stop_reason === 'end_turn') { litIdx.set(id, S.literal.length); S.literal.push([ts, cls]); }
      }
    }
  }
  if (pend) S.unanswered[pend.cls]++;
  for (const u of pendTools.values()) { sanity.tool_use_without_result++; if (u.name === 'AskUserQuestion') S.unanswered.ask++;
    else if (EDITLIKE.has(u.name) && u.mode !== 'bypassPermissions') S.unanswered.approval++; }
  return S;
}

(async () => {
  for (const f of files) sessions.push(await readFile(f));

  // ---------- per-session derivations ----------
  const allPrompts = [];            // [ts, sessionIdx]
  const classWaits = { question: [], ask: [], approval: [], approval_spec: [], done_idle: [] }; // {s, start, end, wait}
  const unanswered = { question: 0, ask: 0, approval: 0, done_idle: 0 };
  const superseded = { question: 0, done_idle: 0 };
  const literal = { question: [], done_idle: [] };
  const approvalDetail = { editlike_gap_gt2s: 0, editlike_by_mode: {}, edit_gap_excluded_nonprompting_mode: 0,
    user_rejection_any_tool: 0, excluded_bypassPermissions: 0, excluded_nonhuman_denial: {}, excluded_unknown_denial: 0,
    tool_results_total: 0, tool_results_by_mode: {}, bash_results: 0, bash_with_decisive_signal: 0, bash_fast_gt30s_nonauto: 0, denial_kind_gaps: {} };
  let negDropped = 0;
  const editsAll = [];    // {s, ts, fileHash, top, common, src}
  const commits = [];     // {s, ts, top, common}
  const tokens = [];      // per-session token rows
  const dayModel = {};

  sessions.forEach((S, si) => {
    S.ts.sort((a, b) => a - b);
    if (!S.ts.length) { sanity.sessions_with_no_timestamps++; return; }
    S.prompts.sort((a, b) => a - b);
    for (const p of S.prompts) allPrompts.push([p, si]);

    // tokens / $
    const t = { in: 0, cw5: 0, cw1: 0, cw_unsplit: 0, cr: 0, out: 0, usd: 0, usd30: 0, msgs: 0 };
    for (const g of S.msgs.values()) {
      sanity.assistant_messages++;
      const m = g.model || '?'; inc(sanity.models, /^[A-Za-z0-9.\-_\[\]<>]{1,48}$/.test(m) ? m : 'other');
      const u = g.u; if (u.in == null && u.out == null) continue;
      t.msgs++;
      const cw5 = u.cw5 || 0, cw1 = u.cw1 || 0, cwu = Math.max(0, (u.cw || 0) - cw5 - cw1);
      t.in += u.in || 0; t.out += u.out || 0; t.cr += u.cr || 0; t.cw5 += cw5; t.cw1 += cw1; t.cw_unsplit += cwu;
      const p = priceOf(g.model);
      if (!p) { if ((u.in || 0) + (u.out || 0) > 0) inc(sanity.unpriced_models, /^[A-Za-z0-9.\-_\[\]<>]{1,48}$/.test(m) ? m : 'other'); continue; }
      const usd = ((u.in || 0) * p[0] + (u.out || 0) * p[1] + (cw5 + cwu) * p[2] + cw1 * p[3] + (u.cr || 0) * p[4]) / 1e6;
      t.usd += usd; if (in30(g.first)) t.usd30 += usd;
      const dm = /^[A-Za-z0-9.\-_\[\]]{1,48}$/.test(m) ? m : 'other'; dayModel[dm] = (dayModel[dm] || 0) + usd;
    }
    t.costState = S.costState; t.any = t.in + t.cw5 + t.cw1 + t.cw_unsplit + t.cr + t.out > 0; tokens.push(t);

    // waits (paired in file order during the read)
    for (const w of S.waits) classWaits[w.cls].push({ ...w, s: si, wait: w.end - w.start });
    for (const k in S.unanswered) unanswered[k] += S.unanswered[k];
    for (const k in S.superseded) superseded[k] += S.superseded[k];
    for (const [lc, wv] of (S.literalWaits || [])) literal[lc].push(wv);
    negDropped += S.negDropped;
    // merge approval detail counters
    const ad = S.ad;
    for (const k of ['editlike_gap_gt2s', 'edit_gap_excluded_nonprompting_mode', 'user_rejection_any_tool', 'excluded_bypassPermissions', 'excluded_unknown_denial', 'tool_results_total', 'bash_results', 'bash_with_decisive_signal', 'bash_fast_gt30s_nonauto']) approvalDetail[k] += ad[k];
    for (const k of ['editlike_by_mode', 'excluded_nonhuman_denial', 'tool_results_by_mode']) for (const [kk, v] of Object.entries(ad[k])) inc(approvalDetail[k], kk, v);
    for (const [kk, arr] of Object.entries(ad.denial_kind_gaps)) (approvalDetail.denial_kind_gaps[kk] = approvalDetail.denial_kind_gaps[kk] || []).push(...arr);
    // successful file edits & commits
    for (const e of S.edits) { const rp = repoOf(path.dirname(e.file)); editsAll.push({ s: si, ts: e.ts, f: H(e.file), top: rp.top, common: rp.common, src: 'tool' }); }
    for (const e of S.bashEdits) { const rp = repoOf(path.dirname(e.file)); editsAll.push({ s: si, ts: e.ts, f: H(e.file), top: rp.top, common: rp.common, src: 'bash' }); }
    for (const c of S.commits) { const rp = repoOf(c.dir); commits.push({ s: si, ts: c.ts, top: rp.top, common: rp.common, dirMissing: rp.missing }); }
  });
  for (const k in approvalDetail.denial_kind_gaps) approvalDetail.denial_kind_gaps[k] = dist(approvalDetail.denial_kind_gaps[k], 1000);
  sanity.negative_turn_waits_dropped = negDropped;

  // ---------- live minutes ----------
  const liveRanges = []; // per session: merged [m0, m1] minute ranges
  const liveSpans = [];  // per session: merged [t0, t1] ms spans (exact live time)
  const liveMsIn = (si, lo, hi) => { let x = 0; for (const [a, b] of liveSpans[si] || []) x += Math.max(0, Math.min(b, hi) - Math.max(a, lo)); return x; };
  let liveMinTotal = 0;
  const minuteSessions = new Map(); // minute -> array of si
  const sessionLiveMin = new Float64Array(sessions.length);
  sessions.forEach((S, si) => {
    const rs = []; const a = S.ts;
    for (let i = 1; i < a.length; i++) if (a[i] - a[i - 1] < LIVE_GAP) { // equal timestamps = zero-length span, live in that minute
      const m0 = Math.floor(a[i - 1] / MIN), m1 = Math.floor(a[i] / MIN);
      if (rs.length && m0 <= rs[rs.length - 1][1]) rs[rs.length - 1][1] = Math.max(rs[rs.length - 1][1], m1); else rs.push([m0, m1]);
    }
    liveRanges[si] = rs;
    const sp = []; for (let i = 1; i < a.length; i++) if (a[i] - a[i - 1] < LIVE_GAP) { if (sp.length && a[i - 1] <= sp[sp.length - 1][1]) sp[sp.length - 1][1] = Math.max(sp[sp.length - 1][1], a[i]); else sp.push([a[i - 1], a[i]]); }
    liveSpans[si] = sp;
    for (const [m0, m1] of rs) for (let m = m0; m <= m1; m++) { let arr = minuteSessions.get(m); if (!arr) minuteSessions.set(m, arr = []); arr.push(si); sessionLiveMin[si]++; liveMinTotal++; }
  });
  const minutes = [...minuteSessions.keys()].sort((a, b) => a - b);
  function concurrency(filter) {
    const counts = [], dayPeak = new Map(); let ge5 = 0, ge10 = 0, ge2 = 0;
    for (const m of minutes) { const ms = m * MIN; if (!filter(ms)) continue; const n = minuteSessions.get(m).length;
      counts.push(n); if (n >= 2) ge2++; if (n >= 5) ge5++; if (n >= 10) ge10++;
      const d = localDay(ms); dayPeak.set(d, Math.max(dayPeak.get(d) || 0, n)); }
    const dp = [...dayPeak.values()];
    return { live_minutes: counts.length, live_hours: r2(counts.length / 60), sessions_per_live_minute: { median: q(counts, .5), p75: q(counts, .75), p90: q(counts, .9), max: counts.length ? Math.max(...counts) : null, mean: r2(counts.reduce((x, y) => x + y, 0) / (counts.length || 1)) },
      share_minutes_ge2: r2(100 * ge2 / (counts.length || 1)), share_minutes_ge5_pct: r2(100 * ge5 / (counts.length || 1)), share_minutes_ge10_pct: r2(100 * ge10 / (counts.length || 1)),
      days_with_live: dp.length, per_day_peak: { median: q(dp, .5), p90: q(dp, .9), max: dp.length ? Math.max(...dp) : null },
      session_minutes: counts.reduce((x, y) => x + y, 0) };
  }
  const conc = { all_time: concurrency(() => true), last_30d: concurrency(in30) };

  // ---------- TTA stats ----------
  function ttaBlock(filter) {
    const out = {};
    const pick = arr => arr.filter(w => filter(w.start));
    const mk = arr => { const raw = arr.map(w => w.wait / 1000); const cen = raw.filter(x => x <= AWAY_CENSOR / 1000);
      return { raw: dist(raw), censored: dist(cen), away_dropped: raw.length - cen.length }; };
    for (const k of ['question', 'ask', 'approval', 'approval_spec']) out[k] = mk(pick(classWaits[k]));
    out.combined_abc = mk([...pick(classWaits.question), ...pick(classWaits.ask), ...pick(classWaits.approval)]);
    out.combined_abc_spec = mk([...pick(classWaits.question), ...pick(classWaits.ask), ...pick(classWaits.approval_spec)]);
    out.done_idle_not_tta = mk(pick(classWaits.done_idle));
    return out;
  }
  const tta = { all_time: ttaBlock(() => true), last_30d: ttaBlock(in30),
    unanswered_at_end: unanswered, superseded_before_prompt: superseded,
    literal_no_supersession: { question: { raw: dist(literal.question.map(x => x / 1000)), censored: dist(literal.question.filter(x => x <= AWAY_CENSOR).map(x => x / 1000)) },
      done_idle: { raw: dist(literal.done_idle.map(x => x / 1000)), censored: dist(literal.done_idle.filter(x => x <= AWAY_CENSOR).map(x => x / 1000)) } },
    approval_detail: approvalDetail, negative_turn_waits_dropped: negDropped };

  // ---------- attention load ----------
  const blocks = [...classWaits.question, ...classWaits.ask, ...classWaits.approval];
  const blocksCen = blocks.filter(b => b.wait <= AWAY_CENSOR);
  // blocks per live hour (exact live time: sum of record gaps < 30 min)
  const perSessBlocks = new Float64Array(sessions.length); for (const b of blocks) perSessBlocks[b.s]++;
  const liveMsAll = sessions.map((S, si) => liveMsIn(si, -Infinity, Infinity)), liveMs30 = sessions.map((S, si) => liveMsIn(si, W30_START, W30_END));
  const totLiveH = liveMsAll.reduce((x, y) => x + y, 0) / HOUR, totLiveH30 = liveMs30.reduce((x, y) => x + y, 0) / HOUR;
  const rates = []; sessions.forEach((S, si) => { if (liveMsAll[si] >= 0.5 * HOUR) rates.push(perSessBlocks[si] / (liveMsAll[si] / HOUR)); });
  const perSess30 = new Float64Array(sessions.length); for (const b of blocks) if (in30(b.start)) perSess30[b.s]++;
  const rates30 = []; sessions.forEach((S, si) => { if (liveMs30[si] >= 0.5 * HOUR) rates30.push(perSess30[si] / (liveMs30[si] / HOUR)); });
  const blocksPerLiveHour = { aggregate: r2(blocks.length / totLiveH), aggregate_censored: r2(blocksCen.length / totLiveH),
    per_session_ge_half_live_hour: { n: rates.length, median: r2(q(rates, .5)), p75: r2(q(rates, .75)), p90: r2(q(rates, .9)), max: r2(rates.length ? Math.max(...rates) : null) },
    total_blocks: blocks.length, total_live_session_hours: r2(totLiveH), live_session_minutes_touched: liveMinTotal,
    last_30d: (() => { const b30 = blocks.filter(b => in30(b.start)).length; return { blocks: b30, live_session_hours: r2(totLiveH30), per_live_hour: r2(b30 / totLiveH30),
      per_session_ge_half_live_hour: { n: rates30.length, median: r2(q(rates30, .5)), p75: r2(q(rates30, .75)), p90: r2(q(rates30, .9)) } }; })() };
  // per-minute blocked sessions (censored intervals, unioned per session, minute overlap)
  const blockedBySess = new Map();
  for (const b of blocksCen) { const m0 = Math.floor(b.start / MIN), m1 = Math.floor(b.end / MIN); let set = blockedBySess.get(b.s); if (!set) blockedBySess.set(b.s, set = new Set()); for (let m = m0; m <= m1; m++) set.add(m); }
  const blockedCount = new Map(); for (const set of blockedBySess.values()) for (const m of set) blockedCount.set(m, (blockedCount.get(m) || 0) + 1);
  function blockedDist(filter) {
    const all = [], pos = []; let ge1 = 0, ge2 = 0, ge3 = 0;
    for (const m of minutes) { if (!filter(m * MIN)) continue; const n = blockedCount.get(m) || 0; all.push(n); if (n >= 1) { ge1++; pos.push(n); } if (n >= 2) ge2++; if (n >= 3) ge3++; }
    const L = all.length || 1;
    return { live_minutes: all.length, median: q(all, .5), p75: q(all, .75), p90: q(all, .9), p99: q(all, .99), max: all.length ? Math.max(...all) : null,
      share_ge1_pct: r2(100 * ge1 / L), share_ge2_pct: r2(100 * ge2 / L), share_ge3_pct: r2(100 * ge3 / L),
      given_ge1: { n: pos.length, median: q(pos, .5), p90: q(pos, .9) } };
  }
  const blockedPerMinute = { note: 'blocked minutes outside live minutes arise because a session waiting > 30 min with no records is not live by the live-span definition', all_time: blockedDist(() => true), last_30d: blockedDist(in30), blocked_minutes_outside_live_minutes: [...blockedCount.keys()].filter(m => !minuteSessions.has(m)).length };
  // identical tool calls blocked at overlapping times across sessions
  function identical(keyName) {
    const ap = classWaits.approval_spec.filter(b => b.wait <= AWAY_CENSOR && b[keyName]);
    const byKey = new Map(); for (const b of ap) { let a = byKey.get(b[keyName]); if (!a) byKey.set(b[keyName], a = []); a.push(b); }
    let blocksInvolved = 0, pairs = 0, clusters = 0; const inv = new Set();
    for (const arr of byKey.values()) { if (arr.length < 2) continue; arr.sort((x, y) => x.start - y.start); let had = false;
      for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length && arr[j].start <= arr[i].end; j++) if (arr[i].s !== arr[j].s) { pairs++; inv.add(arr[i]); inv.add(arr[j]); had = true; }
      if (had) clusters++; }
    blocksInvolved = inv.size;
    return { approval_blocks_considered: ap.length, overlapping_cross_session_pairs: pairs, blocks_involved: blocksInvolved, distinct_keys_with_overlap: clusters };
  }
  const identicalBlocks = { exact_command_or_dir_ext_pattern: identical('key1'), coarse_prefix2_or_tool_ext: identical('key2'),
    note: 'approval_spec (c, spec rule, superset of approval) blocks only, censored <= 2 h; key1 = tool + whitespace-normalized full Bash command, or tool + repo-common-dir + repo-relative dir + extension for file tools; key2 = tool + first two Bash tokens, or tool + extension. Hashes only.' };
  // loops / wakeups / cron
  const loopSess = sessions.filter(S => S.loopPrompts > 0).length, wakeSess = sessions.filter(S => S.wakeups.length).length, cronSess = sessions.filter(S => S.crons.length).length;
  const delays = [], observed = [], cronIv = [];
  for (const S of sessions) { for (const d of S.wakeDelays) delays.push(d);
    const ws = S.wakeups.map(w => w.ts).sort((a, b) => a - b); for (let i = 1; i < ws.length; i++) observed.push((ws[i] - ws[i - 1]) / 1000);
    for (const c of S.crons) if (c.interval != null) cronIv.push(c.interval); }
  const anyLoop = sessions.filter(S => S.loopPrompts || S.wakeups.length || S.crons.length).length;
  const loops = { sessions_with_loop_prompt: loopSess, loop_prompts: sessions.reduce((x, S) => x + S.loopPrompts, 0), sessions_with_ScheduleWakeup: wakeSess,
    ScheduleWakeup_calls: sessions.reduce((x, S) => x + S.wakeups.length, 0), sessions_with_CronCreate: cronSess, CronCreate_calls: sessions.reduce((x, S) => x + S.crons.length, 0),
    sessions_with_any: anyLoop, sessions_with_effective_ScheduleWakeup_non_noop_non_stop: sessions.filter(S => S.wakeDelays.length).length, wakeup_delaySeconds: { ...dist(delays), min: delays.length ? Math.min(...delays) : null },
    observed_seconds_between_consecutive_ScheduleWakeup_calls: dist(observed), cron_interval_seconds_parsed: dist(cronIv) };
  // tokens
  const tokU = tokens.filter(t => t.any); const usd = tokU.map(t => t.usd), sum = k => tokens.reduce((x, t) => x + (t[k] || 0), 0);
  const csCmp = tokens.filter(t => typeof t.costState === 'number');
  const tokenStats = { sessions: tokens.length, sessions_with_usage: tokU.length, assistant_messages_with_usage: sum('msgs'),
    totals: { input: sum('in'), cache_write_5m: sum('cw5'), cache_write_1h: sum('cw1'), cache_write_unsplit: sum('cw_unsplit'), cache_read: sum('cr'), output: sum('out'), usd: r2(sum('usd')), usd_last_30d_by_message_time: r2(sum('usd30')) },
    per_session_usd: { median: r2(q(usd, .5)), p75: r2(q(usd, .75)), p90: r2(q(usd, .9)), p99: r2(q(usd, .99)), max: r2(usd.length ? Math.max(...usd) : 0) },
    per_session_tokens_median: { input: q(tokU.map(t => t.in), .5), cache_write: q(tokU.map(t => t.cw5 + t.cw1 + t.cw_unsplit), .5), cache_read: q(tokU.map(t => t.cr), .5), output: q(tokU.map(t => t.out), .5) },
    per_session_tokens_p90: { input: q(tokU.map(t => t.in), .9), cache_write: q(tokU.map(t => t.cw5 + t.cw1 + t.cw_unsplit), .9), cache_read: q(tokU.map(t => t.cr), .9), output: q(tokU.map(t => t.out), .9) },
    usd_by_model: Object.fromEntries(Object.entries(dayModel).map(([k, v]) => [k, r2(v)])),
    crosscheck_cost_state: { sessions_with_cost_state: csCmp.length, sum_last_cost_state_usd: r2(csCmp.reduce((x, t) => x + t.costState, 0)), sum_mine_usd_same_sessions: r2(csCmp.reduce((x, t) => x + t.usd, 0)),
      note: 'cost-state totalCostUSD is Claude Code\'s own running cost (last record per file); it can reset on resume and includes subagents, so only an order-of-magnitude check.' } };
  // away gaps
  allPrompts.sort((a, b) => a[0] - b[0]);
  const fin = classWaits.done_idle.map(w => w.start).sort((a, b) => a - b), bst = blocks.map(b => b.start).sort((a, b) => a - b);
  const countIn = (arr, a, b) => { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] <= a) lo = m + 1; else hi = m; } let n = 0; for (let i = lo; i < arr.length && arr[i] < b; i++) n++; return n; };
  function awayStats(filter) {
    const g = [];
    for (let i = 1; i < allPrompts.length; i++) { const a = allPrompts[i - 1][0], b = allPrompts[i][0]; if (b - a >= AWAY_GAP && filter(a)) {
      let active = false; for (let m = Math.floor(a / MIN) + 1; m < Math.floor(b / MIN); m++) if (minuteSessions.has(m)) { active = true; break; }
      g.push({ a, b, blocks: countIn(bst, a, b), fin: countIn(fin, a, b), active }); } }
    const pile = g.map(x => x.blocks + x.fin), act = g.filter(x => x.active);
    return { gaps: g.length, active_gaps: act.length, total_hours: r2(g.reduce((x, y) => x + (y.b - y.a), 0) / HOUR), gap_minutes: dist(g.map(x => (x.b - x.a) / MIN)),
      blocks_started_in_gaps: g.reduce((x, y) => x + y.blocks, 0), finishes_started_in_gaps: g.reduce((x, y) => x + y.fin, 0),
      gaps_with_ge1_pileup: pile.filter(x => x >= 1).length, gaps_with_ge3_pileup: pile.filter(x => x >= 3).length,
      pileup_per_gap: { median: q(pile, .5), p75: q(pile, .75), p90: q(pile, .9), max: pile.length ? Math.max(...pile) : null },
      share_active_gaps_with_ge1_block: act.length ? r2(100 * act.filter(x => x.blocks > 0).length / act.length) : null,
      share_active_gaps_with_ge1_finish: act.length ? r2(100 * act.filter(x => x.fin > 0).length / act.length) : null };
  }
  const away = { all_time: awayStats(() => true), last_30d: awayStats(in30), human_prompts_total: allPrompts.length,
    definition: 'gap >= 20 min between consecutive human prompts (all sessions merged); pile-up = answered a+b+c blocks + answered done-idle waits whose start lies strictly inside the gap; active = a live minute strictly inside the gap' };
  // shared cwd / repo among concurrently live sessions
  const cwdAt = sessions.map(S => S.cwds.slice().sort((x, y) => x[0] - y[0]));
  const ptr = new Int32Array(sessions.length);
  let mShareCwd = 0, mShareTop = 0, mShareCommon = 0, mGe2 = 0; const pairCwd = new Set(), pairTop = new Set(), pairCommon = new Set();
  let mShareCwd30 = 0, mShareCommon30 = 0, mShareTop30 = 0, mGe2_30 = 0;
  for (const m of minutes) {
    const ss = minuteSessions.get(m); if (ss.length < 2) continue; mGe2++; const is30 = in30(m * MIN); if (is30) mGe2_30++;
    const end = (m + 1) * MIN; const byCwd = new Map(), byTop = new Map(), byCommon = new Map();
    for (const si of ss) { const cl = cwdAt[si]; if (!cl.length) continue; while (ptr[si] + 1 < cl.length && cl[ptr[si] + 1][0] < end) ptr[si]++; const cwd = cl[ptr[si]][1]; const rp = repoOf(cwd);
      const add = (map, k) => { if (k == null) return; let a = map.get(k); if (!a) map.set(k, a = []); a.push(si); };
      add(byCwd, cwd); add(byTop, rp.top); add(byCommon, rp.common); }
    const share = (map, pairs) => { let any = false; for (const a of map.values()) if (a.length >= 2) { any = true; for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) pairs.add(Math.min(a[i], a[j]) + ':' + Math.max(a[i], a[j])); } return any; };
    if (share(byCwd, pairCwd)) { mShareCwd++; if (is30) mShareCwd30++; }
    if (share(byTop, pairTop)) { mShareTop++; if (is30) mShareTop30++; }
    if (share(byCommon, pairCommon)) { mShareCommon++; if (is30) mShareCommon30++; }
  }
  const lm = minutes.length || 1;
  const sharedCwd = { live_minutes: minutes.length, minutes_ge2_live: mGe2,
    minutes_with_shared_cwd: mShareCwd, pct_of_live_minutes_shared_cwd: r2(100 * mShareCwd / lm), pct_of_ge2_minutes_shared_cwd: r2(100 * mShareCwd / (mGe2 || 1)), pct_of_ge2_minutes_shared_worktree: r2(100 * mShareTop / (mGe2 || 1)),
    minutes_with_shared_worktree: mShareTop, minutes_with_shared_repo_any_worktree: mShareCommon, pct_of_live_minutes_shared_repo: r2(100 * mShareCommon / lm), pct_of_ge2_minutes_shared_repo: r2(100 * mShareCommon / (mGe2 || 1)),
    distinct_session_pairs_shared_cwd: pairCwd.size, distinct_session_pairs_shared_worktree: pairTop.size, distinct_session_pairs_shared_repo: pairCommon.size,
    last_30d: { minutes_ge2_live: mGe2_30, minutes_with_shared_cwd: mShareCwd30, minutes_with_shared_worktree: mShareTop30, minutes_with_shared_repo: mShareCommon30,
      pct_of_ge2_minutes_shared_cwd: r2(100 * mShareCwd30 / (mGe2_30 || 1)), pct_of_ge2_minutes_shared_worktree: r2(100 * mShareTop30 / (mGe2_30 || 1)), pct_of_ge2_minutes_shared_repo: r2(100 * mShareCommon30 / (mGe2_30 || 1)) },
    definition: 'per live minute with >= 2 sessions: cwd = latest cwd record before the minute ends; worktree/repo = git toplevel / common dir resolved on the filesystem (sessions whose cwd is not in a git repo do not share a repo).' };
  // same file edited by two sessions within 30 min
  function collisions(srcFilter, filter) {
    const byF = new Map(); for (const e of editsAll) if (srcFilter(e) && filter(e.ts)) { let a = byF.get(e.f); if (!a) byF.set(e.f, a = []); a.push(e); }
    let events = 0; const files = new Set(), pairs = new Set();
    for (const [f, arr] of byF) { arr.sort((a, b) => a.ts - b.ts);
      for (let i = 0; i < arr.length; i++) { let hit = false; for (let j = i - 1; j >= 0 && arr[i].ts - arr[j].ts <= EDIT_COLLIDE; j--) if (arr[j].s !== arr[i].s) { hit = true; pairs.add(Math.min(arr[i].s, arr[j].s) + ':' + Math.max(arr[i].s, arr[j].s)); }
        if (hit) { events++; files.add(f); } } }
    return { edit_events: [...byF.values()].reduce((x, a) => x + a.length, 0), files_edited: byF.size, collision_events: events, files_with_collision: files.size, session_pairs: pairs.size };
  }
  const sameFile = { edit_tools_only: collisions(e => e.src === 'tool', () => true), incl_bash_changed_files: collisions(() => true, () => true),
    edit_tools_only_last_30d: collisions(e => e.src === 'tool', in30),
    definition: 'collision event = a successful edit to file F by session B with an edit to F by a different session A in the preceding 30 min (paths hashed).' };
  // git commit while another live session in same repo had newer edits
  const gitLogCache = new Map();
  function commitTimes(top) { if (!top) return null; if (gitLogCache.has(top)) return gitLogCache.get(top); let ts = null;
    try { ts = execFileSync('git', ['-C', top, 'log', '--all', '--format=%ct'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64e6 }).split('\n').filter(Boolean).map(x => +x * 1000).sort((a, b) => a - b); } catch { ts = null; }
    gitLogCache.set(top, ts); return ts; }
  const transcriptCommits = new Map(); for (const c of commits.slice().sort((a, b) => a.ts - b.ts)) { const k = c.top || 'null'; let a = transcriptCommits.get(k); if (!a) transcriptCommits.set(k, a = []); a.push(c.ts); }
  const isLive = (si, ts) => { const m = Math.floor(ts / MIN); const rs = liveRanges[si]; for (const [a, b] of rs) if (m >= a && m <= b) return true; return false; };
  let cTotal = 0, cFlagTop = 0, cFlagCommon = 0, cPrevGit = 0, cPrevTranscript = 0, cNoPrev = 0, cNoRepo = 0, cFlag30 = 0, c30 = 0;
  for (const c of commits) {
    cTotal++; if (in30(c.ts)) c30++;
    if (!c.top) { cNoRepo++; continue; }
    let prev = null; const gl = commitTimes(c.top);
    if (gl && gl.length) { let lo = 0, hi = gl.length; while (lo < hi) { const m = (lo + hi) >> 1; if (gl[m] < c.ts) lo = m + 1; else hi = m; } if (lo > 0) { prev = gl[lo - 1]; cPrevGit++; } }
    if (prev == null) { const tc = transcriptCommits.get(c.top) || []; const before = tc.filter(t => t < c.ts); if (before.length) { prev = before[before.length - 1]; cPrevTranscript++; } }
    if (prev == null) { cNoPrev++; prev = -Infinity; }
    const others = (key, val) => editsAll.some(e => e.s !== c.s && e.src === 'tool' && e[key] === val && e.ts > prev && e.ts <= c.ts && isLive(e.s, c.ts));
    const fTop = others('top', c.top), fCom = others('common', c.common);
    if (fTop) { cFlagTop++; if (in30(c.ts)) cFlag30++; } if (fCom) cFlagCommon++;
  }
  const commitRace = { git_commits_detected: cTotal, last_30d_commits: c30, commits_no_repo_resolved: cNoRepo, prev_commit_from_git_log: cPrevGit, prev_commit_from_transcripts: cPrevTranscript, no_previous_commit: cNoPrev,
    flagged_same_worktree: cFlagTop, flagged_same_worktree_pct: r2(100 * cFlagTop / (cTotal || 1)), flagged_same_repo_any_worktree: cFlagCommon, flagged_same_repo_pct: r2(100 * cFlagCommon / (cTotal || 1)), flagged_same_worktree_last_30d: cFlag30,
    definition: 'commit = successful Bash tool_use whose command matches git [-C dir] commit; flagged when a different session, live (by live-span minutes) at the commit time, made a successful Edit/Write/MultiEdit/NotebookEdit in the same worktree (or same repo incl. other worktrees) after the repo\'s previous commit (git log --all %ct, fallback: previous transcript commit) and before this commit.' };

  if (DUMP) { const L = [];
    for (const k of ['question', 'ask', 'approval', 'approval_spec', 'done_idle']) for (const w of classWaits[k])
      L.push(JSON.stringify({ c: k, sid: H(sessions[w.s].sid), st: w.start, en: w.end, tool: w.name || null, mode: w.mode || null, sig: w.sig || null }));
    for (const [t, si] of allPrompts) L.push(JSON.stringify({ c: 'prompt', sid: H(sessions[si].sid), st: t, en: t }));
    sessions.forEach((S, si) => { for (const [a, b] of liveSpans[si] || []) L.push(JSON.stringify({ c: 'live', sid: H(S.sid), st: a, en: b })); });
    fs.writeFileSync(DUMP, L.join('\n') + '\n'); }
  // ---------- output ----------
  const out = {
    generated_at: new Date().toISOString(), implementation: 'mineA (Node ' + process.version + ', zero deps)',
    headline: {
      concurrency_median_p90_max_all: [conc.all_time.sessions_per_live_minute.median, conc.all_time.sessions_per_live_minute.p90, conc.all_time.sessions_per_live_minute.max],
      concurrency_median_p90_max_30d: [conc.last_30d.sessions_per_live_minute.median, conc.last_30d.sessions_per_live_minute.p90, conc.last_30d.sessions_per_live_minute.max],
      tta_combined_censored_median_p90_s_all: [tta.all_time.combined_abc.censored.median, tta.all_time.combined_abc.censored.p90],
      tta_combined_censored_median_p90_s_30d: [tta.last_30d.combined_abc.censored.median, tta.last_30d.combined_abc.censored.p90],
      cutoff: isFinite(CUTOFF) && CUTOFF < 2e14 ? new Date(CUTOFF).toISOString() : null,
      blocks_per_live_session_hour: blocksPerLiveHour.aggregate,
    },
    concurrency: conc, tta, attention_load: { blocks_per_live_hour: blocksPerLiveHour, blocked_sessions_per_minute: blockedPerMinute, identical_tool_call_blocks: identicalBlocks,
      loops_wakeups_cron: loops, tokens_and_cost: tokenStats, away_gaps: away, shared_cwd_or_repo: sharedCwd, same_file_edits_within_30min: sameFile, commit_while_other_session_has_newer_edits: commitRace },
    methods: {
      root: '~/.claude/projects (top-level <dir>/<sessionId>.jsonl only)',
      files_parsed: files.length, bytes_parsed: files.reduce((x, f) => x + f.bytes, 0), sessions: sessions.length, skipped,
      records_parsed: sanity.records, parse_errors: sanity.parse_errors, runtime_s: r2((Date.now() - T0) / 1000),
      session_identity: 'one session = one top-level file (filename sessionId). Records whose uuid was already seen in an earlier-born file (birth time, then path) are dropped (resume/fork copies). Records with timestamp > cutoff and files born after cutoff are ignored.',
      cutoff: isFinite(CUTOFF) && CUTOFF < 2e14 ? new Date(CUTOFF).toISOString() : null,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, last_30d_window: new Date(W30_START).toISOString() + ' .. ' + new Date(W30_END - 1).toISOString() + ' (30 x 24 h ending at the cutoff); events assigned by their start timestamp, minutes by minute start; per-day peaks use local (America/Denver) calendar days',
      percentiles: 'linear interpolation (Hyndman-Fan type 7, numpy default). Durations in seconds unless named otherwise.',
      definitions: {
        human_prompt: "type=user, !isMeta, !isSidechain, !isCompactSummary, no scheduledTaskId, no tool_result block, text (string content or text blocks joined by \\n) trimmed non-empty, not starting with '[Request interrupted', not starting with '<' unless starting with '<command-'. Compaction summaries and scheduled fires are machine-written and excluded (see sanity counts).",
        live: 'all records with a parseable top-level timestamp (any type), sorted per session; consecutive pair < 30 min apart => session live over [t_i, t_i+1]; a minute is live if any such span touches it (minute = floor(ms/60000)). Isolated records (no neighbour within 30 min) are not live.',
        question: "file order. Assistant message (records grouped by message.id) with stop_reason end_turn whose last text block, trimmed, ends with '?'; wait starts at the timestamp of the message's last record and ends at the session's next human prompt. Supersession: any assistant record of a DIFFERENT message.id before that prompt drops the wait (the session moved on by itself; counted in superseded_before_prompt). A prompt timestamped before the end_turn (file-order anomaly) drops the wait (negative_turn_waits_dropped). literal_no_supersession reports pairing every end_turn to the next prompt.",
        ask: 'tool_use AskUserQuestion -> its tool_result (tool_use record timestamp to tool_result record timestamp).',
        approval: 'HEADLINE (a human prompt was shown): tool_use -> first tool_result in file order. Excluded: permissionMode (last seen before the tool_use) bypassPermissions; toolDenialKind automode-blocked / automode-unavailable / permission-rule / interrupted (no human answered: classifier, classifier timeout, settings rule, Esc) and unknown denial kinds. Counted: (1) toolDenialKind user-rejected, or is_error with the rejection marker text (the user answered No; any tool, any gap); (2) ExitPlanMode gap > 2 s (plan approval); (3) Edit/Write/MultiEdit/NotebookEdit gap > 2 s while permissionMode is default or unknown (auto/acceptEdits/plan show no edit prompt). Approved Bash prompts have no marker and are not counted.',
        approval_spec: 'spec rule as written: same exclusions; user rejections + Edit/Write/MultiEdit/NotebookEdit/ExitPlanMode gap > 2 s in ANY permission mode. Under auto mode those gaps are classifier/hook latency (median ~3 s, max 83 s, no human decision), so this variant is reported but not used as the headline.',
        approval_heuristic_rationale: "Bash toolUseResult has no duration field (keys: stdout, stderr, interrupted, isImage, noOutputExpected), so for approved prompts the gap cannot be split into permission wait vs execution. 97% of tool calls ran under permissionMode 'auto', where the classifier allows or blocks without asking a human; only explicit user-rejection markers are decisive for Bash. Coverage: see approval_detail.bash_with_decisive_signal vs bash_results. Spec rule (1) is kept as written although under auto mode Edit/Write gaps > 2 s are mostly classifier latency, not humans (see approval_detail.editlike_by_mode).",
        done_idle: 'end_turn message without a question -> next human prompt (same supersession rule). Not TTA.',
        censoring: 'censored = waits <= 2 h; waits > 2 h counted as away_dropped. Waits with no answer before the file ends are in unanswered_at_end.',
        blocks: 'a+b+c answered waits. blocked_sessions_per_minute uses censored waits, unioned per session, a session counts in every minute its wait interval touches; distribution is over live minutes.',
        away_gap: 'gap >= 20 min between consecutive human prompts across all sessions (merged); pile-up = answered a+b+c blocks + answered done-idle waits whose start lies strictly inside the gap.',
        tokens: 'usage deduped by message.id (Claude Code writes one record per content block with the same usage; max per field kept). Price = model list price (see prices). cache_creation split into 5m/1h when present; unsplit remainder priced as 5m. Non-Anthropic models (glm, deepseek) unpriced. Top-level sessions only: subagent spend excluded.',
        repo: 'git worktree toplevel = nearest ancestor of cwd with .git; repo identity = commondir of that .git (so worktrees of one repo share it). Resolved from the live filesystem; cwds outside any git repo have no repo.',
        live_hours: 'exact live time = sum over a session of consecutive-record gaps < 30 min (merged spans), clipped to the window; per-session rates for sessions with >= 0.5 live h.',
      },
      prices_usd_per_mtok_in_out_cw5m_cw1h_read: Object.fromEntries(PRICES),
      sanity,
      outliers_note: 'nonmonotonic_records = record timestamp more than 1 s earlier than the max seen so far in that file (sorted before use). dup_uuid_records_dropped = resumed/forked copies. compact_boundaries = context compactions (session continues in same file).',
    },
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log(JSON.stringify({ ok: true, out: OUT, runtime_s: out.methods.runtime_s, files: files.length, records: sanity.records }));
})().catch(e => { console.error('ERR', e && e.message); process.exit(1); });
