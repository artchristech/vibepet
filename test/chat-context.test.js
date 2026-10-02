// node --test test/chat-context.test.js — what chat is told about the sessions (chat-context.js): a line per session with
// its title, folder, repo, true state and age, exact ask, edited files and fan-out; the Overlaps line, from receipts read off
// real transcript records (agents.js scan); which sessions a message is about. Fixtures only, in a temp dir.
const test = require('node:test');
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const C = require('../chat-context'), A = require('../agents');

const NOW = Date.UTC(2026, 9, 2, 8, 0, 0), H = 3600e3, M = 60e3, HOME = os.homedir();
const fleet = n => path.join(HOME, '.vibepet-ultra', 'fleet', n);
const s = (name, kind, extra = {}) => ({ id: name + '-id', name, kind, phase: A.NEEDS.has(kind) ? 'waiting' : kind === 'done' ? 'ready' : 'working',
  cwd: fleet(name), root: fleet(name), branch: 'main', since: NOW - H, mtime: NOW - H, ...extra });
const kestrel = s('kestrel', 'approval', { title: 'Deploy.sh dry run', ask: 'Bash: ./deploy.sh --dry-run', regName: 'kestrel-4d', since: NOW - (4 * H + 38 * M) });   // a derived registry name
const beacon = s('beacon', 'question', { title: 'Choose a database', since: NOW - (5 * H + 37 * M), ask: 'Which database should beacon use to store check results? (SQLite / Postgres / Redis)',
  options: [{ key: '1', label: 'SQLite' }, { key: '2', label: 'Postgres' }, { key: '3', label: 'Redis' }] });
const atlas = s('atlas', 'done', { title: 'Run build script', ask: 'interrupted', since: NOW - (4 * H + 47 * M) });
const delta = s('delta', 'done', { ask: 'All shards reconciled.', fanout: { total: 3, done: 3, open: 0, stuck: 0 } });

test('a session line: title, folder, repo/branch, true state and age, the exact ask, edited files, fan-out', () => {
  const k = C.sessionLine(kestrel, NOW);
  for (const want of ['- kestrel · "Deploy.sh dry run"', 'folder ~/.vibepet-ultra/fleet/kestrel', 'repo kestrel/main', 'needs approval for 4h 38m', 'asks: Bash: ./deploy.sh --dry-run', 'edited this turn: nothing'])
    assert.ok(k.includes(want), `${want} in ${k}`);
  const b = C.sessionLine(beacon, NOW);
  assert.ok(b.includes('waiting for an answer for 5h 37m · asks: Which database should beacon use to store check results? (SQLite / Postgres / Redis)'), b);
  // an ask cut short still carries every option
  assert.ok(C.sessionLine({ ...beacon, ask: 'Which database should beacon use to store check results and keep the history of every…?' }, NOW).includes('(options: SQLite / Postgres / Redis)'));
  // an approval's dialog choices (yes / always / no) aren't the ask: the command is
  assert.ok(C.sessionLine({ ...kestrel, options: [{ key: '1', label: 'Yes' }, { key: '3', label: 'No' }] }, NOW).includes('asks: Bash: ./deploy.sh --dry-run · edited'));
  assert.ok(C.sessionLine(atlas, NOW).includes('done for 4h 47m · its turn was interrupted'));
  assert.ok(C.sessionLine(delta, NOW).includes('last said: All shards reconciled. · edited this turn: nothing · fan-out 3/3 subagents done'));
  const e = C.sessionLine({ ...s('vibepet', 'running', { ask: 'Bash: node --test' }), receipt: { files: new Set([fleet('vibepet') + '/main.js', HOME + '/notes.md']), add: 12, del: 3 } }, NOW);
  assert.ok(e.includes('running Bash: node --test · edited this turn: main.js, ~/notes.md (+12 -3 lines)'), e);
  assert.ok(C.sessionLine({ ...kestrel, root: null }, NOW).includes('not in a git repo'));
  assert.ok(C.sessionLine({ ...kestrel, regName: 'deploy-bot', alias: true }, NOW).startsWith('- kestrel (@deploy-bot) · '), 'a name the user gave it is shown');
  // the one-line summary keeps its shape: canon's stub engine reads it
  assert.strictEqual(C.agentLine(kestrel, NOW), 'kestrel=needs approval for 4h 38m - Bash: ./deploy.sh --dry-run');
});

test('every session gets a line, at most 15 and within the byte budget; the rest are named', () => {
  const four = C.sessions([beacon, kestrel, delta, atlas], NOW);
  assert.match(four, /^Sessions, in the order they need you/);
  assert.deepStrictEqual(four.split('\n').slice(1, -1).map(l => l.split(' ')[1]), ['beacon', 'kestrel', 'delta', 'atlas']);
  assert.strictEqual(four.split('\n').pop(), 'Needs you now: beacon first: answer "Which database should beacon use to store check results? (SQLite / Postgres / Redis)". ' +
    'Next: kestrel: approve the Bash command `./deploy.sh --dry-run`. Asked who needs the user first, give the first and its ask, then who\'s next and theirs. Give commands verbatim in backticks.');
  const last = l => C.sessions(l, NOW).split('\n').pop();
  assert.strictEqual(last([kestrel, atlas]), 'Needs you now: kestrel: approve the Bash command `./deploy.sh --dry-run`. Give commands verbatim in backticks.');
  assert.match(last([{ ...kestrel, ask: 'Edit: /x/kestrel/src/server.js' }]), /kestrel: approve the Edit `\/x\/kestrel\/src\/server\.js`\./);
  assert.match(last([{ ...kestrel, kind: 'plan', ask: 'Plan: Add a /version route.' }]), /kestrel: approve the plan "Add a \/version route\."\./);
  assert.match(last([{ ...kestrel, ask: 'needs approval - see terminal' }]), /^Needs you now: kestrel: needs approval - see terminal\. /);
  assert.strictEqual(C.sessions([delta, atlas], NOW).split('\n').pop(), 'Needs you now: nothing.');
  const many = Array.from({ length: 20 }, (_, i) => s('s' + i, 'done', { title: 'x'.repeat(80), ask: 'y'.repeat(120) }));
  const out = C.sessions(many, NOW).split('\n');
  assert.strictEqual(out.length, 1 + 15 + 1 + 1);
  assert.match(out[16], /^- and 5 more: s15 \(done\), s16 \(done\)/);
  const tight = C.sessions(many, NOW, 15, 1500).split('\n');
  assert.ok(tight.join('\n').length < 1500 + 400, `${tight.join('\n').length} bytes`);
  assert.match(tight[tight.length - 2], /^- and \d+ more: /);
});

// two real transcripts in one folder of one repo, each with an Edit on src/server.js and its tool_result, read by agents.js
const iso = ms => new Date(ms).toISOString();
function transcript(root, dname, id, cwd, title, recs) {
  const dir = path.join(root, dname); fs.mkdirSync(dir, { recursive: true });
  const at = Date.now() - 60e3, lines = [{ type: 'ai-title', aiTitle: title }, { type: 'user', cwd, timestamp: iso(at), message: { role: 'user', content: 'go on' } }, ...recs(at)];
  fs.writeFileSync(path.join(dir, id + '.jsonl'), lines.map(r => JSON.stringify(r)).join('\n') + '\n');
}
const edit = (cwd, at, id, file) => [
  { type: 'assistant', cwd, timestamp: iso(at + 1000), message: { stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name: 'Edit', input: { file_path: file, old_string: 'a', new_string: 'b\nc' } }] } },
  { type: 'user', cwd, timestamp: iso(at + 2000), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'The file has been updated.' }] } },
  { type: 'assistant', cwd, timestamp: iso(at + 3000), message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done.' }] } }];

test('Overlaps: two receipts touching one path in one repo name both sessions and the file', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibepet-chatctx-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = '/x/kestrel', file = repo + '/src/server.js';
  transcript(root, '-x-kestrel', 'aaaa-1', repo, 'Add a version route', at => edit(repo, at, 'e1', file));
  transcript(root, '-x-kestrel', 'bbbb-2', repo, 'Add a health check', at => edit(repo, at, 'e2', 'src/server.js'));   // relative: resolved against its cwd
  transcript(root, '-x-beacon', 'cccc-3', '/x/beacon', 'Pinger', at => edit('/x/beacon', at, 'e3', '/x/beacon/src/server.js'));   // same path, other repo
  const list = A.scan(root, new Map()).map(a => ({ ...a, root: a.cwd }));
  assert.strictEqual(list.length, 3);
  assert.ok(list.every(a => a.receipt?.files.size === 1), 'each turn edited one file');
  const line = C.overlaps(list);
  assert.match(line, /^Overlaps: kestrel\/src\/server\.js: /, line);
  assert.ok(line.includes('kestrel ("Add a version route") edited it this turn') && line.includes('kestrel ("Add a health check") edited it this turn'), line);
  assert.ok(!line.includes('beacon'), 'a same-named file in another repo is no overlap');
  // the edit a session waits on counts too: about to edit
  const asking = s('kestrel-b', 'approval', { cwd: repo, root: repo, ask: 'Edit: /x/kestrel/src/server.js' });
  assert.match(C.overlaps([list.find(a => a.title === 'Add a version route'), asking]), /^Overlaps: kestrel\/src\/server\.js: kestrel edited it this turn, kestrel-b is asking to edit it\.$/);
  assert.strictEqual(C.pendingEdit({ kind: 'approval', cwd: repo, ask: 'Edit file: src/server.js' }), file);   // a dialog read off the pane
  assert.strictEqual(C.pendingEdit({ kind: 'approval', cwd: repo, ask: 'Bash: ./deploy.sh --dry-run' }), null);
});

test('Overlaps: none, and why (different repos, or one repo and no shared file)', () => {
  assert.strictEqual(C.overlaps([beacon, kestrel, delta, atlas]), 'Overlaps: none. No two sessions share a repo (4 sessions in 4 repos).');
  const r = '/x/kestrel', a1 = s('kestrel', 'done', { cwd: r, root: r, receipt: { files: new Set([r + '/a.js']), add: 1, del: 0 } }), a2 = s('kestrel-b', 'done', { cwd: r, root: r, receipt: { files: new Set([r + '/b.js']), add: 1, del: 0 } });
  assert.strictEqual(C.overlaps([a1, a2]), 'Overlaps: none. kestrel and kestrel-b share repo kestrel, but no file was touched by two of them.');
});

test('the sessions a message is about: named (folder, @name, registry name, title), else the ones that need you', () => {
  const all = [beacon, kestrel, delta, atlas, s('vibepet', 'done'), s('pet', 'done', { mtime: NOW })];
  const names = r => r.list.map(a => a.name);
  assert.deepStrictEqual(C.about('what did atlas change?', 'chat', all), { why: 'named in your message', list: [atlas] });
  assert.deepStrictEqual(names(C.about("what's atlas's status", 'chat', all)), ['atlas']);
  assert.deepStrictEqual(names(C.about('@kestrel-4d go on', 'chat', all)), ['kestrel']);
  assert.deepStrictEqual(names(C.about('is the Deploy.sh dry run safe?', 'chat', all)), ['kestrel']);
  assert.deepStrictEqual(names(C.about('how is vibepet doing', 'chat', all)), ['vibepet'], 'pet is not named by vibepet');
  assert.deepStrictEqual(names(C.about('kestrel-b?', 'chat', all)), [], 'kestrel is not named by kestrel-b');
  assert.deepStrictEqual(C.about('which session needs me first?', 'chat', all), { why: '', list: [] });
  assert.deepStrictEqual(C.about('What is my coding agent doing right now?', 'agent', all), { why: 'needs you', list: [beacon, kestrel] });
  assert.deepStrictEqual(C.about('next step?', 'next', [delta, atlas, all[5]]), { why: 'the latest active session', list: [all[5]] });
});

test("a session's own repo: clean or its diff stat and untracked files; commits since the session began apart from older ones", () => {
  const seed = `61815a9\t${(NOW - 12 * H) / 1000}\tatlas: tile renderer and build script (12 hours ago)`, mine = `9f00d1e\t${(NOW - H) / 1000}\tatlas: faster tiles (1 hour ago)`;
  assert.strictEqual(C.repoText(atlas, { stat: '', untracked: '', log: seed }, NOW - 11 * H - 46 * M, NOW),
    "atlas's repo atlas (branch main, ~/.vibepet-ultra/fleet/atlas): clean, nothing uncommitted, no untracked files.\nCommits in it since atlas's session began (11h 46m ago): none.\nOlder commits:\n61815a9 atlas: tile renderer and build script (12 hours ago)");
  assert.match(C.repoText(atlas, { stat: '', untracked: '', log: mine + '\n' + seed }, NOW - 2 * H, NOW), /began \(2h 0m ago\):\n9f00d1e atlas: faster tiles \(1 hour ago\)\nOlder commits:\n61815a9 /);
  const dirty = C.repoText(atlas, { stat: ' tiles.js | 4 ++--\n 1 file changed, 2 insertions(+), 2 deletions(-)', untracked: 'out.png\n', log: seed });   // no birth time: just recent
  assert.match(dirty, /: uncommitted changes:\n tiles\.js \| 4 \+\+--\n 1 file changed.*\nUntracked files: out\.png\.\nRecent commits:\n61815a9 atlas: tile/);
  assert.match(C.repoText(atlas, { stat: null, untracked: null, log: null }), /no commits yet/);
});
