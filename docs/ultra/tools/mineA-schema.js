#!/usr/bin/env node
// Redacted schema skeleton of top-level Claude Code transcripts.
// Prints ONLY key paths, JSON value types, counts, and enum values for the
// allow-listed keys (type, subtype, role, stop_reason, tool name, model,
// permissionMode, version). Every other string is reduced to <str:len>.
'use strict';
const fs = require('fs'), path = require('path'), readline = require('readline');
const ROOT = process.env.MINE_ROOT || path.join(process.env.HOME, '.claude/projects');
const ENUM_KEYS = new Set(['type', 'subtype', 'role', 'stop_reason', 'model', 'permissionMode', 'version']);
const SAFE_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,40}$/;
const SAFE_ENUM = /^[A-Za-z0-9_.:\-]{1,48}$/;
const MAX_DEPTH = +process.env.DEPTH || 5;

function listFiles() {
  const out = [];
  for (const d of fs.readdirSync(ROOT)) {
    if (/private-tmp|scratchpad|-vibepet-ultra-fleet-/.test(d)) continue;
    const dp = path.join(ROOT, d);
    let ents; try { ents = fs.readdirSync(dp, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) if (e.isFile() && e.name.endsWith('.jsonl')) out.push(path.join(dp, e.name));
  }
  return out;
}
const paths = new Map(); // path -> {n, types:{}, enums:Map}
function note(p, v, key, underInput) {
  let s = paths.get(p); if (!s) { s = { n: 0, types: {}, enums: new Map(), lens: [] }; paths.set(p, s); }
  s.n++;
  const t = v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
  s.types[t] = (s.types[t] || 0) + 1;
  if (t === 'string') {
    const isEnum = !underInput && (ENUM_KEYS.has(key) || (key === 'name' && /content\[\]$/.test(p.replace(/\.name$/, '')))) && SAFE_ENUM.test(v);
    if (isEnum) s.enums.set(v, (s.enums.get(v) || 0) + 1);
    else if (s.lens.length < 2000) s.lens.push(v.length);
  }
}
function walk(v, p, key, depth, underInput) {
  note(p, v, key, underInput);
  if (depth >= MAX_DEPTH || v === null || typeof v !== 'object') return;
  if (Array.isArray(v)) { for (const x of v) walk(x, p + '[]', key, depth + 1, underInput); return; }
  for (const k of Object.keys(v)) {
    const kk = SAFE_KEY.test(k) ? k : '<key>';
    walk(v[k], p + '.' + kk, k, depth + 1, underInput || k === 'input');
  }
}
(async () => {
  const files = listFiles(); let recs = 0, errs = 0;
  for (const f of files) {
    const rl = readline.createInterface({ input: fs.createReadStream(f), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line) continue;
      let o; try { o = JSON.parse(line); } catch { errs++; continue; }
      recs++; walk(o, '$', '', 0, false);
    }
  }
  console.log(JSON.stringify({ files: files.length, recs, errs }));
  const minN = +process.env.MIN_N || 50;
  const filt = process.env.FILTER ? new RegExp(process.env.FILTER) : null;
  for (const [p, s] of [...paths].sort()) {
    if (s.n < minN) continue;
    if (filt && !filt.test(p)) continue;
    let line = `${p}  n=${s.n} ${Object.entries(s.types).map(([k, v]) => k + ':' + v).join(',')}`;
    if (s.enums.size) line += '  enum{' + [...s.enums].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, v]) => k + '=' + v).join(' ') + '}';
    else if (s.lens.length) { const l = s.lens.sort((a, b) => a - b); line += `  <str:p50=${l[l.length >> 1]} max=${l[l.length - 1]}>`; }
    console.log(line);
  }
})();
