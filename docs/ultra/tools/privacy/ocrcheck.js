#!/usr/bin/env node
// Privacy check of evidence screenshots, without looking at them.
// Input: the OCR of every PNG (ocr.swift writes it locally; it is never printed). Every OCR token is compared with the
// fleet/harness vocabulary (fleet transcripts, fleet repos, the int worktree's tracked files, the live fleet sessions'
// registry names). Tokens that are not in it are then looked up in the real corpus (~/.claude/projects minus fleet dirs
// and the workflow session): a token found there that is not an English word is the only thing worth a human look.
// Prints ONLY counts and PNG paths.   node ocrcheck.js <ocr.jsonl> [--json OUT]
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
const H = os.homedir(), P = path.join(H, '.claude/projects'), ULTRA = path.join(H, '.vibepet-ultra');
const WF_SESSION = process.env.VP_WF_SESSION || '2aec191f-bd46-4d22-b2da-e8c859fd18a3';
const EVID = path.join(H, 'projects/vibepet/docs/ultra') + path.sep;
const tok = s => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const V = new Set();
const add = p => { try { for (const t of tok(fs.readFileSync(p, 'utf8').replace(/\\[ntr"]/g, ' '))) V.add(t); } catch {} };
const walk = (d, fn, skip = () => false) => { let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; } for (const e of es) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!skip(e.name)) walk(p, fn, skip); } else fn(p); } };
for (const d of fs.readdirSync(P).filter(d => d.includes('-vibepet-ultra-fleet-'))) walk(path.join(P, d), add);
walk(path.join(ULTRA, 'fleet'), add, n => n === 'node_modules' || n === '.git');
for (const f of execFileSync('git', ['-C', path.join(ULTRA, 'int'), 'ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean)) add(path.join(ULTRA, 'int', f));
for (const f of fs.readdirSync(path.join(ULTRA, 'root/.claude/sessions')).filter(f => /^\d+\.json$/.test(f))) {
  try { const j = JSON.parse(fs.readFileSync(path.join(ULTRA, 'root/.claude/sessions', f), 'utf8')); if (String(j.cwd || '').startsWith(ULTRA)) for (const t of tok(String(j.name || ''))) V.add(t); } catch {}
}
const rows = fs.readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const unknown = new Map();   // token -> Set(png)
let tokens = 0, unk = 0;
const perPng = rows.map(r => {
  const t = r.lines.flatMap(tok); tokens += t.length;
  const u = t.filter(x => !V.has(x) && !/^\d+[a-z]{0,2}$/.test(x)); unk += u.length;
  for (const x of u) if (x.length >= 4) { if (!unknown.has(x)) unknown.set(x, new Set()); unknown.get(x).add(r.file); }
  return { png: r.file.replace(EVID, ''), tokens: t.length, unknown: u.length };
});
// real-corpus lookup of the unknown tokens (counts only)
const inReal = new Map([...unknown.keys()].map(t => [t, 0]));
walk(P, f => { if (f.includes(WF_SESSION)) return; let s; try { s = fs.readFileSync(f, 'utf8').toLowerCase(); } catch { return; } const seen = new Set(); for (const t of s.replace(/\\[ntr"]/g, ' ').split(/[^a-z0-9]+/)) if (inReal.has(t) && !seen.has(t)) { seen.add(t); inReal.set(t, inReal.get(t) + 1); } }, n => n.includes('-vibepet-ultra-fleet-'));
const dict = new Set(fs.existsSync('/usr/share/dict/words') ? fs.readFileSync('/usr/share/dict/words', 'utf8').toLowerCase().split('\n') : []);
let noise = 0, english = 0, look = 0; const lookPngs = new Map();
for (const [t, pngs] of unknown) {
  if (!inReal.get(t)) noise++; else if (dict.has(t)) english++; else { look++; for (const p of pngs) lookPngs.set(p.replace(EVID, ''), (lookPngs.get(p.replace(EVID, '')) || 0) + 1); }
}
const out = {
  at: new Date().toISOString(), pngs: rows.length, ocrTokens: tokens, notInFleetVocabulary: unk,
  share: +(unk / Math.max(1, tokens)).toFixed(4), pngsAllTokensKnown: perPng.filter(p => !p.unknown).length,
  unknownDistinct4plus: unknown.size, unknownOcrNoise: noise, unknownEnglish: english, unknownInRealCorpusNonDictionary: look,
  pngsToLookAt: [...lookPngs.entries()].sort((a, b) => b[1] - a[1]).map(([png, n]) => ({ png, tokens: n })),
};
const j = process.argv.indexOf('--json'); if (j > 0) fs.writeFileSync(process.argv[j + 1], JSON.stringify(out, null, 1));
console.log(`PNGs ${out.pngs}: OCR tokens ${tokens}, ${unk} (${(100 * out.share).toFixed(1)}%) outside the fleet/harness vocabulary; ${out.pngsAllTokensKnown} PNGs fully explained`);
console.log(`unknown tokens (4+ chars): ${unknown.size} = ${noise} OCR noise (absent from the real corpus) + ${english} English words + ${look} non-dictionary words that also occur in the real corpus`);
console.log(`PNGs holding one of those ${look}: ${out.pngsToLookAt.length} (view a few: a pixel font misread, or a leak)`);
