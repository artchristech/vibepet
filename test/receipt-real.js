// node test/receipt-real.js [n=12] — read-only: the receipt of each live session under ~/.claude/projects, as the pill would show it.
// Uses scan() on a throwaway Map; opens files for reading only; writes nothing.
const os = require('os'), path = require('path');
const { scan } = require('../agents');
const n = +process.argv[2] || 12;
for (const s of scan(path.join(os.homedir(), '.claude', 'projects'), new Map()).slice(0, n)) {
  const r = s.receipt, c = r?.check;
  console.log(JSON.stringify({ title: s.title || s.name, phase: s.phase, files: r ? (r.truncated ? '≥' : '') + r.files.size : 0,
    cmd: c?.cmd, ok: c?.ok, stale: r?.stale }));
}
