// does approveGroups batch two different pending commands? ask = agents.js's display string (plain + cap 120)
const acts = require('/Users/christopherharris/.vibepet-ultra/wt/r1-row-actions/renderer/acts.js');
const plain = t => t.replace(/\*\*|__|`/g, '').replace(/^\s*(?:[-*>#]+|\d+\.)\s*/, '').replace(/\s+/g, ' ').trim();
function cap(t, n = 120) { if (t.length <= n) return t; return t.endsWith('?') ? t.slice(0, n - 2).trimEnd() + '…?' : t.slice(0, n - 1).trimEnd() + '…'; }
const ask = (name, cmd) => cap(`${name}: ${plain(cmd)}`);
const base = 'cd /Users/me/projects/some-long-project-name && npm run build -- --mode production --config ./config/build.production.js';
const cases = {
  truncated: [base + ' && npm test', base + ' && rm -rf ~/projects'],
  backticks: ['echo `rm -rf build`', 'echo rm -rf build'],
  whitespace: ['git commit -m "a  b"', 'git commit -m "a b"'],
  editSameFile: null,
};
for (const [k, v] of Object.entries(cases)) {
  if (!v) continue;
  const agents = v.map((c, i) => ({ id: 's' + i, kind: 'approval', ask: ask('Bash', c) }));
  const g = acts.approveGroups(agents);
  console.log(k, '| asks equal:', agents[0].ask === agents[1].ask, '| batched:', [...g.values()].map(x => x.length).join(',') || 'no', '|', JSON.stringify(agents[0].ask));
}
// Edit/Write: the ask is only the path (toolAsk uses i.file_path), so two different edits to one file look identical
const e = [{ id: 'a', kind: 'approval', ask: 'Edit: /repo/package.json' }, { id: 'b', kind: 'approval', ask: 'Edit: /repo/package.json' }];
console.log('editSameFile | batched:', [...acts.approveGroups(e).values()].map(x => x.length).join(','));
