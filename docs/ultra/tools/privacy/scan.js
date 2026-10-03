#!/usr/bin/env node
// Privacy scan of the vibepet-ultra evidence dir (EVID).
// Question: does any long free-text string in EVID come from a REAL transcript (anything under ~/.claude/projects
// except fixture-fleet dirs and this workflow's own session)?  Method: 7-word shingles of every long EVID string,
// looked up in (a) an allowlist corpus (vibepet repo files, fleet repos, fleet transcripts) and (b) the real corpus.
// Prints ONLY numbers, file paths inside EVID, JSON key paths, record enum values. Never any text.
// Also checks short strings (5-9 words) as whole sequences. Positive control: copy a real assistant text span into a
// scratch dir and run with --target <dir>; it must be flagged (ratio 1), a fleet span must not.
//   node scan.js [--target DIR] [--json OUT] [--allow-dirs a,b] [--allow file,file]
// Flagged = a long string with >=3 unexplained 7-word shingles and >=25% of its shingles unexplained, or a short string
// found whole. "Unexplained" = present in the real corpus and absent from the allowlist (vibepet repo + int worktree
// tracked files, fleet repos, fleet transcripts, node_modules, the Python stdlib).
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const { execFileSync } = require('child_process');

const K = 7, MIN_TOKENS = 10, SHORT_MIN = 5, SHORT_MAX = 9;
const HOME = os.homedir();
const tIdx = process.argv.indexOf('--target');
const EVID = tIdx > 0 ? process.argv[tIdx + 1] : path.join(HOME, 'projects/vibepet/docs/ultra');
const PROJ = path.join(HOME, '.claude/projects');
const FLEET_SEG = '-vibepet-ultra-fleet-';
// the orchestrating workflow's own session (its agents write EVID, so their transcripts are excluded, not allowlisted)
const WF_SESSION = process.env.VP_WF_SESSION || '2aec191f-bd46-4d22-b2da-e8c859fd18a3';

const tok = s => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const rawTok = line => line.toLowerCase().replace(/\\u[0-9a-f]{4}/g, ' ').replace(/\\[ntr"\\/]/g, ' ').split(/[^a-z0-9]+/).filter(Boolean);

// scan lines of a text: for every window of K tokens that are all in vocab, check the shingle set
function scanTokens(tokens, vocab, shingles, onHit) {
  let run = 0;
  for (let i = 0; i < tokens.length; i++) {
    if (vocab.has(tokens[i])) run++; else { run = 0; continue; }
    if (run >= K) { const sh = tokens.slice(i - K + 1, i + 1).join(' '); if (shingles.has(sh)) onHit(sh); }
    for (let n = SHORT_MIN; n <= Math.min(SHORT_MAX, run); n++) { const sh = 'S|' + tokens.slice(i - n + 1, i + 1).join(' '); if (shingles.has(sh)) onHit(sh); }
  }
}

if (!isMainThread) {
  const { files, shingleList, vocabList, raw } = workerData;
  const shingles = new Set(shingleList), vocab = new Set(vocabList);
  const hits = new Map();   // shingle -> [fileIdx, lineNo]
  let ok = 0, fail = 0, bytes = 0;
  for (const [fi, f] of files) {
    let data; try { data = fs.readFileSync(f, 'utf8'); ok++; bytes += data.length; } catch { fail++; continue; }
    const lines = data.split('\n');
    for (let ln = 0; ln < lines.length; ln++) {
      const l = lines[ln]; if (l.length < 20) continue;
      scanTokens(raw ? rawTok(l) : tok(l), vocab, shingles, sh => { if (!hits.has(sh)) hits.set(sh, [fi, ln]); });
    }
  }
  parentPort.postMessage({ hits: [...hits.entries()], ok, fail, bytes });
  return;
}

function walkFiles(dir, out, filter) {
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name === 'node_modules' || e.name === '.git' || e.name === '__pycache__') continue; walkFiles(p, out, filter); }
    else if (e.isFile() && filter(p)) out.push(p);
  }
  return out;
}

// ---------------- EVID segments
const segs = [];   // {file, loc, n, sh:Set}
function addSeg(file, loc, text) {
  const t = tok(text);
  if (t.length >= SHORT_MIN && t.length <= SHORT_MAX) { segs.push({ file, loc, n: 1, sh: new Set(['S|' + t.join(' ')]), short: true }); return; }
  if (t.length < MIN_TOKENS) return;
  const sh = new Set(); for (let i = 0; i + K <= t.length; i++) sh.add(t.slice(i, i + K).join(' '));
  segs.push({ file, loc, n: sh.size, sh });
}
function walkJson(file, v, p) {
  if (typeof v === 'string') addSeg(file, p || '$', v);
  else if (Array.isArray(v)) v.forEach((x, i) => walkJson(file, x, `${p}[${i}]`));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walkJson(file, x, `${p}.${k}`);
}
const evidFiles = walkFiles(EVID, [], p => !/\.(png|pyc|DS_Store)$/i.test(p));
for (const f of evidFiles) {
  const rel = path.relative(EVID, f), data = fs.readFileSync(f, 'utf8');
  if (f.endsWith('.json')) { try { walkJson(rel, JSON.parse(data), '$'); continue; } catch {} }
  if (f.endsWith('.jsonl')) {
    data.split('\n').forEach((l, i) => { if (!l.trim()) return; try { walkJson(rel, JSON.parse(l), `L${i + 1}`); } catch { addSeg(rel, `L${i + 1}`, l); } });
    continue;
  }
  data.split('\n').forEach((l, i) => addSeg(rel, `L${i + 1}`, l));
}
const shMap = new Map(); const vocab = new Set();
segs.forEach((s, i) => { for (const sh of s.sh) { if (!shMap.has(sh)) shMap.set(sh, []); shMap.get(sh).push(i); for (const w of sh.replace(/^S\|/, '').split(' ')) vocab.add(w); } });
console.log(`EVID: ${evidFiles.length} text files, ${segs.filter(s => !s.short).length} long strings (>=${MIN_TOKENS} words), ${segs.filter(s => s.short).length} short strings (${SHORT_MIN}-${SHORT_MAX} words), ${shMap.size} distinct keys`);

// ---------------- corpora
const isFleet = p => p.split(path.sep).some(s => s.includes(FLEET_SEG));
const isWf = p => p.includes(WF_SESSION);
const textish = p => !/\.(png|jpg|jpeg|gif|webp|pdf|zip|gz|pyc|DS_Store|mp4|mov|wav|mp3|db|sqlite|node)$/i.test(p);
const realFiles = walkFiles(PROJ, [], p => !isFleet(p) && !isWf(p) && textish(p));
const fleetTranscripts = walkFiles(PROJ, [], p => isFleet(p) && textish(p));
const repoFiles = [];
for (const repo of [path.join(HOME, 'projects/vibepet'), path.join(HOME, '.vibepet-ultra/int')]) {
  for (const f of execFileSync('git', ['-C', repo, 'ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean)) {
    const p = path.join(repo, f); if (textish(p) && fs.existsSync(p) && fs.statSync(p).isFile() && fs.statSync(p).size < 20e6) repoFiles.push(p);
  }
}
const fleetRepoFiles = walkFiles(path.join(HOME, '.vibepet-ultra/fleet'), [], p => textish(p) && fs.statSync(p).size < 20e6);
const aIdx = process.argv.indexOf('--allow');
const extraAllow = aIdx > 0 ? process.argv[aIdx + 1].split(',').filter(p => fs.existsSync(p)) : [];
const dIdx = process.argv.indexOf('--allow-dirs');
const DEFAULT_LIBS = [path.join(HOME, '.vibepet-ultra/int/node_modules'), '/Library/Frameworks/Python.framework/Versions/3.11/lib/python3.11'];
const libFiles = (dIdx > 0 ? process.argv[dIdx + 1].split(',') : DEFAULT_LIBS.filter(d => fs.existsSync(d))).flatMap(d => { const out = []; (function w(x) { let es; try { es = fs.readdirSync(x, { withFileTypes: true }); } catch { return; } for (const e of es) { const p = path.join(x, e.name); if (e.isDirectory()) w(p); else if (/\.(js|cjs|mjs|ts|md|json|py|txt)$/.test(p)) { try { if (fs.statSync(p).size < 20e6) out.push(p); } catch {} } } })(d); return out; });
console.log(`library allowlist: ${libFiles.length} files`);
const allowFiles = [...repoFiles, ...fleetRepoFiles, ...fleetTranscripts, ...extraAllow, ...libFiles];
const sizeOf = fl => fl.reduce((s, f) => { try { return s + fs.statSync(f).size; } catch { return s; } }, 0);
console.log(`real corpus: ${realFiles.length} files, ${(sizeOf(realFiles) / 1e9).toFixed(2)} GB (fleet dirs + workflow session ${WF_SESSION.slice(0, 8)} excluded)`);
console.log(`allowlist: ${repoFiles.length} repo files, ${fleetRepoFiles.length} fleet-repo files, ${fleetTranscripts.length} fleet transcript files, ${extraAllow.length} extra`);

function pass(files, raw, nWorkers) {
  const idx = files.map((f, i) => [i, f]);
  // balance by size
  const sized = idx.map(([i, f]) => { let s = 0; try { s = fs.statSync(f).size; } catch {} return [i, f, s]; }).sort((a, b) => b[2] - a[2]);
  const buckets = Array.from({ length: nWorkers }, () => ({ s: 0, files: [] }));
  for (const [i, f, s] of sized) { buckets.sort((a, b) => a.s - b.s); buckets[0].s += s; buckets[0].files.push([i, f]); }
  const shingleList = [...shMap.keys()], vocabList = [...vocab];
  return Promise.all(buckets.map(b => new Promise((res, rej) => {
    const w = new Worker(__filename, { workerData: { files: b.files, shingleList, vocabList, raw } });
    w.on('message', res); w.on('error', rej);
  }))).then(rs => { const m = new Map(); let ok = 0, fail = 0, bytes = 0; for (const r of rs) { ok += r.ok; fail += r.fail; bytes += r.bytes; for (const [sh, loc] of r.hits) if (!m.has(sh)) m.set(sh, loc); } console.log(`  read ${ok} files (${(bytes / 1e9).toFixed(2)} G chars), ${fail} unreadable`); return m; });
}

(async () => {
  const t0 = Date.now();
  const allowHits = await pass(allowFiles, true, 6);
  console.log(`allowlist pass: ${allowHits.size} shingles explained (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  const t1 = Date.now();
  const realHits = await pass(realFiles, true, 7);
  console.log(`real pass: ${realHits.size} shingles also in real corpus, ${[...realHits.keys()].filter(s => !allowHits.has(s)).length} of them unexplained (${((Date.now() - t1) / 1000).toFixed(1)} s)`);

  const perFile = new Map(), flagged = [];
  segs.forEach((s, i) => {
    let real = 0, unexplained = 0; const srcFiles = new Set();
    for (const sh of s.sh) if (realHits.has(sh)) { real++; if (!allowHits.has(sh)) { unexplained++; srcFiles.add(realHits.get(sh)[0]); } }
    const pf = perFile.get(s.file) || { segs: 0, flagged: 0, maxRatio: 0 };
    pf.segs++;
    const ratio = s.n ? unexplained / s.n : 0;
    pf.maxRatio = Math.max(pf.maxRatio, ratio);
    if (s.short ? unexplained === 1 : (unexplained >= 3 && ratio >= 0.25)) { pf.flagged++; flagged.push({ i, short: !!s.short, file: s.file, loc: s.loc, shingles: s.n, unexplained, ratio: +ratio.toFixed(2), srcFiles: [...srcFiles] }); }
    perFile.set(s.file, pf);
  });
  // describe the source of each flagged segment's first unexplained hit by enum values only
  const codeness = (file, loc) => {
    const m = /^L(\d+)$/.exec(loc); if (!m) return null;
    try { const line = fs.readFileSync(path.join(EVID, file), 'utf8').split('\n')[+m[1] - 1] || ''; const p = (line.match(/[(){}\[\]=:;,'"_.<>|+*\/\\-]/g) || []).length; return +(p / Math.max(1, line.length)).toFixed(2); } catch { return null; }
  };
  const dirId = new Map();
  const describe = (fi, ln) => {
    const f = realFiles[fi], rel = path.relative(PROJ, f), dir = rel.split(path.sep)[0];
    if (!dirId.has(dir)) dirId.set(dir, dirId.size + 1);
    const where = dir.includes('vibepet') ? `vibepet-dir#${dirId.get(dir)}` : `dir#${dirId.get(dir)}`;
    const kind = rel.includes(`${path.sep}subagents${path.sep}`) ? 'subagent' : rel.includes('tool-results') ? 'tool-results' : rel.includes(`${path.sep}memory${path.sep}`) ? 'memory' : path.extname(f).slice(1);
    let rec = '';
    if (f.endsWith('.jsonl')) {
      try {
        const line = fs.readFileSync(f, 'utf8').split('\n')[ln]; const j = JSON.parse(line);
        const c = j.message && j.message.content;
        const blocks = Array.isArray(c) ? c.map(b => b.type === 'tool_use' ? `tool_use:${b.name}` : b.type).join('+') : typeof c;
        rec = `type=${j.type} role=${j.message && j.message.role} blocks=${blocks} ts=${j.timestamp || '-'}`;
      } catch { rec = 'unparsed'; }
    }
    return `${where} ${kind} ${rec}`;
  };
  const report = { at: new Date().toISOString(), K, MIN_TOKENS, evidFiles: evidFiles.length, segments: segs.length, flagged: flagged.length, perFile: Object.fromEntries([...perFile.entries()].filter(([, v]) => v.flagged).map(([k, v]) => [k, v])), items: [] };
  for (const fl of flagged) {
    const s = segs[fl.i]; let first = null;
    for (const sh of s.sh) if (realHits.has(sh) && !allowHits.has(sh)) { first = realHits.get(sh); break; }
    report.items.push({ short: fl.short, codeness: codeness(fl.file, fl.loc), file: fl.file, loc: fl.loc, shingles: fl.shingles, unexplained: fl.unexplained, ratio: fl.ratio, sourceFiles: fl.srcFiles.length, firstSource: first ? describe(first[0], first[1]) : null });
  }
  const jIdx = process.argv.indexOf('--json');
  fs.writeFileSync(jIdx > 0 ? process.argv[jIdx + 1] : path.join(__dirname, 'report.json'), JSON.stringify(report, null, 1));
  console.log(`flagged: ${flagged.length} strings in ${Object.keys(report.perFile).length} files`);
  for (const it of report.items.slice(0, 120)) console.log(` ${it.short ? 'SHORT' : 'LONG '} code=${it.codeness} ${it.file}  ${it.loc.slice(0, 70)}  shingles=${it.shingles} unexplained=${it.unexplained} ratio=${it.ratio} srcFiles=${it.sourceFiles}  <- ${it.firstSource}`);
  console.log(`total ${((Date.now() - t0) / 1000).toFixed(1)} s`);
})();
