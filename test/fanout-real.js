// node test/fanout-real.js [hours=24] — read-only: every recent session under ~/.claude/projects, phase before/after settle().
// Opens files for reading only; writes nothing.
const fs = require('fs'), os = require('os'), path = require('path');
const { classify, fanout, settle } = require('../agents');
const root = path.join(os.homedir(), '.claude', 'projects'), hours = +process.argv[2] || 24, now = Date.now();
const rows = [];
for (const d of fs.readdirSync(root)) {
  if (d.includes('private-tmp') || d.includes('scratchpad')) continue;
  let files; try { files = fs.readdirSync(path.join(root, d)); } catch { continue; }
  for (const f of files.filter(f => f.endsWith('.jsonl'))) {
    const fp = path.join(root, d, f), st = fs.statSync(fp);
    if (now - st.mtimeMs > hours * 3600e3) continue;
    let c; try { c = classify(fp, st.mtimeMs); } catch { continue; }
    if (!c) continue;
    const fo = fanout(fp, c.turnAt), after = settle(c, fo);
    rows.push({ age: Math.round((now - st.mtimeMs) / 60000) + 'm', session: f.slice(0, 8), dir: d.slice(-24), before: c.phase, after, fanout: fo ? `${fo.done}/${fo.total} done, ${fo.open} open` : '-' });
  }
}
console.table(rows.sort((a, b) => parseInt(a.age) - parseInt(b.age)));
const changed = rows.filter(r => r.before !== r.after);
console.log(`${rows.length} sessions in ${hours}h · ${rows.filter(r => r.fanout !== '-').length} with a subagents dir · ${changed.length} phase(s) changed by settle`);
