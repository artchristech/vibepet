// node --test test/registry.test.js — Claude Code's session registry (registry.js) joined with transcripts (agents.js scan):
// liveness, needs-you while the dialog's tool_use is withheld, exits, true ages, one queue order. Fixtures only: the one
// live process used is this test's own (its pid and start time), nothing under the real ~/.claude is opened.
const test = require('node:test');
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const R = require('../registry'), A = require('../agents');

const T0 = Date.now(), iso = ms => new Date(ms).toISOString(), ago = ms => T0 - ms;
const tmp = t => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'vibepet-registry-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
// a transcript, its mtime set: records carry their own timestamps (Claude Code's clock)
function write(root, name, recs, mtimeAgo) {
  const dir = path.join(root, '-x-' + name); fs.mkdirSync(dir, { recursive: true });
  const id = name + '-0000', f = path.join(dir, id + '.jsonl');
  fs.writeFileSync(f, recs.map(r => JSON.stringify(r)).join('\n') + '\n');
  const t = ago(mtimeAgo) / 1000; fs.utimesSync(f, t, t);
  return id;
}
const cwd = n => '/x/' + n;
const prompt = (n, at) => ({ type: 'user', cwd: cwd(n), timestamp: iso(at), message: { role: 'user', content: 'go on' } });
const said = (n, at, text) => ({ type: 'assistant', cwd: cwd(n), timestamp: iso(at), message: { stop_reason: 'end_turn', content: [{ type: 'text', text }] } });
const tool = (n, at, name, input) => ({ type: 'assistant', cwd: cwd(n), timestamp: iso(at), message: { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't-' + at, name, input }] } });
const userText = (n, at, text) => ({ type: 'user', cwd: cwd(n), timestamp: iso(at), message: { role: 'user', content: text } });
const entry = (sid, pid, status, at, extra = {}) => ({ sessionId: sid, pid, status, statusUpdatedAt: at, tmux: `vp-x:@1.%${pid}`, tty: '/dev/ttys999', ...extra });

// ---------- the dialog, as Claude Code draws it at the bottom of a pane ----------
const APPROVAL = `❯ Run exactly ./deploy.sh --dry-run again with the Bash tool, nothing else first.
⏺ Bash(./deploy.sh --dry-run)
  ⎿  Waiting…
${'─'.repeat(80)}
 Bash command
 Run dry-run deploy script
${'╌'.repeat(80)}
 ./deploy.sh --dry-run
${'╌'.repeat(80)}
 This command requires approval
 Do you want to proceed?
 ❯ 1. Yes
   2. Yes, and don’t ask again for: ./deploy.sh *
   3. No
 Esc to cancel · Tab to amend`;
const QUESTION = `❯ Use the AskUserQuestion tool again to ask me which database beacon should use. Nothing else first.
${'─'.repeat(80)}
 ☐ Database choice
Which database should beacon use to store check results?
❯ 1. SQLite
     Lightweight, file-based, good for local/single-server deployments
  2. Postgres
     Full-featured relational database, scales well
  3. Redis
     In-memory data store, fast for caching and time-series data
  4. Type something.
${'─'.repeat(80)}
  5. Chat about this
Enter to select · ↑/↓ to navigate · Esc to cancel`;

test('parseDialog: the approval names its command; the question its text and choices (keys kept, free text dropped)', () => {
  assert.deepStrictEqual(R.parseDialog(APPROVAL.split('\n')), { kind: 'approval', ask: 'Bash: ./deploy.sh --dry-run',
    options: [{ key: '1', label: 'Yes' }, { key: '2', label: 'Yes, and don’t ask again for: ./deploy.sh *' }, { key: '3', label: 'No' }] });
  assert.deepStrictEqual(R.parseDialog(QUESTION.split('\n')), { kind: 'question', ask: 'Which database should beacon use to store check results? (SQLite / Postgres / Redis)',
    options: [{ key: '1', label: 'SQLite' }, { key: '2', label: 'Postgres' }, { key: '3', label: 'Redis' }] });
  // no dialog on screen (the prompt, a finished turn): nothing is made up
  assert.strictEqual(R.parseDialog(['❯ ', '⏺ Done.', '✻ Worked for 2s']), null);
  assert.strictEqual(R.parseDialog(APPROVAL.split('\n').slice(0, 12)), null, 'cut before its footer');
});

test('read(): live entries only — a dead pid, a dangling link and a reused pid are out; a half-written file keeps its last parse', async t => {
  const dir = tmp(t), me = process.pid;
  const start = execFileSync('/bin/ps', ['-o', 'lstart=', '-p', String(me)], { encoding: 'utf8', env: { TZ: 'UTC', LC_ALL: 'C' } }).trim();
  const put = (n, e) => fs.writeFileSync(path.join(dir, n + '.json'), typeof e === 'string' ? e : JSON.stringify(e));
  put(me, { pid: me, sessionId: 'live', procStart: start, status: 'idle', statusUpdatedAt: ago(5000) });
  put(424242, { pid: 424242, sessionId: 'dead', status: 'busy', statusUpdatedAt: ago(1000) });   // above macOS's pid ceiling: never alive
  put(424243, { pid: me, sessionId: 'reused', procStart: 'Mon Jan  1 00:00:00 2024', status: 'waiting', statusUpdatedAt: ago(1000) });   // our pid, another start
  fs.symlinkSync(path.join(dir, 'gone', '777.json'), path.join(dir, '777.json'));   // its claude exited, the link dangles
  put(5, { pid: -1, sessionId: 'group' }); put(6, { pid: 1, sessionId: 'launchd' });   // kill(-1, 0) would ask every process; 1 isn't a claude
  let m = await R.read(dir);
  assert.deepStrictEqual([...m.keys()], ['live']);
  assert.strictEqual(m.get('live').pid, me);
  assert.match(String(m.get('live').tty), /^(\/dev\/ttys?\w+|null)$/);
  put(me, '{"pid": ' + me + ', "sessi');   // caught mid-rewrite
  m = await R.read(dir);
  assert.deepStrictEqual([...m.keys()], ['live'], 'a torn read must not look like an exit');
  fs.rmSync(path.join(dir, me + '.json'));
  assert.strictEqual((await R.read(dir)).size, 0);
  assert.deepStrictEqual(await R.read(path.join(dir, 'nope')), new Map(), 'no registry at all (an older CLI): empty, not an error');
});

test('sameStart: procStart in UTC (as Claude Code writes it) or local time; anything else is another process', () => {
  const t = Date.parse('2026-10-01T20:27:24Z');
  assert.ok(R.sameStart('Thu Oct  1 20:27:24 2026', t));
  assert.ok(R.sameStart(new Date(t).toString().slice(0, 24).replace(/ 0(\d) /, '  $1 '), t), 'local');
  assert.ok(!R.sameStart('Thu Oct  1 20:27:24 2025', t));
  assert.ok(R.sameStart(undefined, t), 'nothing to compare: kill(pid, 0) decides');
});

test('scan + registry: a withheld approval and a withheld question need you at once, with the pane\'s ask and the registry\'s clock', t => {
  const root = tmp(t), d = { approval: R.parseDialog(APPROVAL.split('\n')), question: R.parseDialog(QUESTION.split('\n')) };
  // both transcripts end at the user prompt (the tool_use is withheld while the dialog is open) and were last written an hour ago
  const k = write(root, 'kestrel', [said('kestrel', ago(70 * 60e3), 'Ok.'), prompt('kestrel', ago(62 * 60e3))], 60 * 60e3);
  const b = write(root, 'beacon', [prompt('beacon', ago(95 * 60e3 + 2000))], 95 * 60e3);
  const reg = new Map([[k, entry(k, 101, 'waiting', ago(62 * 60e3), { waitingFor: 'permission prompt', dialog: d.approval })],
    [b, entry(b, 102, 'waiting', ago(95 * 60e3), { waitingFor: 'input needed', dialog: d.question })]]);
  const out = A.scan(root, new Map(), null, reg);
  const pick = n => out.find(s => s.name === n);
  assert.deepStrictEqual(out.map(s => s.name), ['beacon', 'kestrel'], 'oldest block first');
  assert.deepStrictEqual([pick('kestrel').kind, pick('kestrel').phase, pick('kestrel').ask, pick('kestrel').since], ['approval', 'stalled', 'Bash: ./deploy.sh --dry-run', ago(62 * 60e3)]);
  assert.deepStrictEqual(pick('kestrel').options.map(o => o.key), ['1', '2', '3']);
  assert.deepStrictEqual([pick('beacon').kind, pick('beacon').phase, pick('beacon').since], ['question', 'waiting', ago(95 * 60e3)]);
  assert.strictEqual(pick('beacon').ask, 'Which database should beacon use to store check results? (SQLite / Postgres / Redis)');
  assert.deepStrictEqual(pick('beacon').options.map(o => o.label), ['SQLite', 'Postgres', 'Redis']);
  assert.deepStrictEqual([pick('kestrel').alive, pick('kestrel').pid, pick('kestrel').term], [true, 101, { tmux: 'vp-x:@1.%101' }]);
  // no pane to read: the registry still says needs you, and where to look
  const bare = A.scan(root, new Map(), null, new Map([[k, entry(k, 101, 'waiting', ago(1000), { waitingFor: 'permission prompt' })]]));
  assert.deepStrictEqual([bare[0].kind, bare[0].ask], ['approval', 'needs approval - see terminal']);
});

test('scan + registry: done stays listed while its claude lives; busy is running however quiet, never stalled; interrupted is done', t => {
  const root = tmp(t);
  const v = write(root, 'vibepet', [prompt('vibepet', ago(53 * 60e3)), said('vibepet', ago(52 * 60e3), 'The app is a desktop pet. It watches agents.')], 52 * 60e3);
  const a = write(root, 'atlas', [prompt('atlas', ago(4 * 60e3)), tool('atlas', ago(4 * 60e3 - 1500), 'Bash', { command: './build.sh' })], 4 * 60e3 - 1500);
  const i = write(root, 'delta', [prompt('delta', ago(30 * 60e3)), tool('delta', ago(30 * 60e3 - 900), 'Bash', { command: './slow.sh' }),
    userText('delta', ago(29 * 60e3), '[Request interrupted by user for tool use]')], 29 * 60e3);
  const c = write(root, 'ember', [prompt('ember', ago(9 * 60e3)), said('ember', ago(8 * 60e3), 'Ticked.'),
    userText('ember', ago(2 * 60e3), '<command-name>/cost</command-name>'), userText('ember', ago(2 * 60e3), '<local-command-stdout>$0.01</local-command-stdout>')], 2 * 60e3);
  const reg = new Map([[v, entry(v, 201, 'idle', ago(52 * 60e3 - 80))], [a, entry(a, 202, 'busy', ago(4 * 60e3 + 900))],
    [i, entry(i, 203, 'idle', ago(29 * 60e3 - 10))], [c, entry(c, 204, 'idle', ago(8 * 60e3 - 50))]]);
  const out = A.scan(root, new Map(), null, reg), pick = n => out.find(s => s.name === n);
  assert.deepStrictEqual([pick('vibepet').kind, pick('vibepet').phase, pick('vibepet').since, pick('vibepet').ask], ['done', 'ready', ago(52 * 60e3 - 80), 'The app is a desktop pet.']);
  // the running clock starts at the tool call, not at the busy flip before it, and has no 90 s stall
  assert.deepStrictEqual([pick('atlas').kind, pick('atlas').phase, pick('atlas').since, pick('atlas').ask], ['running', 'working', ago(4 * 60e3 - 1500), 'Bash: ./build.sh']);
  assert.deepStrictEqual([pick('delta').kind, pick('delta').ask], ['done', 'interrupted']);
  assert.deepStrictEqual([pick('ember').kind, pick('ember').ask], ['done', 'Ticked.'], 'a local command after the turn (/cost) is not a new turn');
  assert.deepStrictEqual(out.map(s => s.name), ['vibepet', 'delta', 'ember', 'atlas'], 'done oldest first (52, 29, 8 min), then running');
  // a restart (fresh sessions map): every since is the same, read off Claude Code's clock, not first sight
  const again = A.scan(root, new Map(), null, reg);
  assert.deepStrictEqual(again.map(s => [s.name, s.since]), out.map(s => [s.name, s.since]));
});

test('scan + registry: an entry that disappears is exited within one tick, listed last for 10 min, never running', t => {
  const root = tmp(t), sessions = new Map(), changes = [];
  const e = write(root, 'ember', [prompt('ember', ago(20 * 60e3)), tool('ember', ago(20 * 60e3 - 800), 'Bash', { command: './tick.sh' })], 20 * 60e3 - 800);
  const k = write(root, 'kestrel', [prompt('kestrel', ago(60e3)), said('kestrel', ago(55e3), 'Done.')], 55e3);
  const h = write(root, 'kite', [prompt('kite', ago(30e3)), said('kite', ago(20e3), 'Printed.')], 20e3);
  const reg = new Map([[e, entry(e, 301, 'idle', ago(19 * 60e3))], [k, entry(k, 302, 'idle', ago(55e3))], [h, entry(h, 303, 'busy', ago(30e3), { kind: 'print' })]]);
  A.scan(root, sessions, (s, p) => changes.push([s.name, p.kind, s.kind]), reg);
  reg.delete(e); reg.delete(h);   // its claude exited: Claude Code removed the registry file (or the pid died)
  const t1 = Date.now(), out = A.scan(root, sessions, (s, p) => changes.push([s.name, p.kind, s.kind]), reg);
  const ex = out.find(s => s.name === 'ember');
  assert.deepStrictEqual([ex.kind, ex.phase, ex.alive, out[out.length - 1].name], ['exited', 'exited', false, 'ember']);
  assert.ok(!out.some(s => s.name === 'kite'), 'a headless run (registry kind print) ends by design: no exited row');
  assert.ok(ex.since >= t1 - 50 && ex.since <= Date.now(), 'exit time: this tick (no /exit record to read it from)');
  assert.deepStrictEqual(changes, [['ember', 'done', 'exited'], ['kite', 'running', 'exited']]);
  assert.strictEqual(A.scan(root, sessions, null, reg).find(s => s.name === 'ember').since, ex.since, 'the exit time holds');
  sessions.get(e).exitAt = sessions.get(e).since = Date.now() - A.EXIT_MS - 1000;   // ten minutes on
  assert.ok(!A.scan(root, sessions, null, reg).some(s => s.name === 'ember'), 'shown its 10 min: out');
  assert.ok(!A.scan(root, sessions, null, reg).some(s => s.name === 'ember'), 'and stays out (its tail would read as stalled)');
});

test('scan: /exit in the tail is an exit at its record time, with or without a registry; /clear in the same claude is not', t => {
  const root = tmp(t), recent = ago(90e3), old = ago(40 * 60e3);
  const exitRecs = (n, at) => [prompt(n, at - 60e3), said(n, at - 50e3, 'Done.'), userText(n, at, '<command-name>/exit</command-name>\n<command-message>exit</command-message>'),
    userText(n, at, '<local-command-stdout>Bye!</local-command-stdout>')];
  write(root, 'ember', exitRecs('ember', recent), 90e3);
  write(root, 'atlas', exitRecs('atlas', old), 40 * 60e3);
  const out = A.scan(root, new Map(), null, new Map());
  assert.deepStrictEqual(out.map(s => [s.name, s.kind, s.since]), [['ember', 'exited', recent]], 'atlas exited 40 min ago: not listed');
  // seen alive, then its pid shows up under another session id: the same claude moved on (/clear, /resume), nobody exited
  const sessions = new Map(), a = write(root, 'beacon', [prompt('beacon', ago(5000)), said('beacon', ago(4000), 'Ok.')], 4000);
  A.scan(root, sessions, null, new Map([[a, entry(a, 401, 'idle', ago(4000))]]));
  const moved = A.scan(root, sessions, null, new Map([['other-session', entry('other-session', 401, 'busy', ago(100))]]));
  assert.ok(!moved.some(s => s.name === 'beacon'));
});

test('scan without a registry entry: a written AskUserQuestion needs you at once (not after 90 s); other tools keep the 90 s rule', t => {
  const root = tmp(t);
  write(root, 'beacon', [prompt('beacon', ago(3000)), tool('beacon', ago(2000), 'AskUserQuestion', { questions: [{ question: 'Which database?', header: 'DB',
    options: [{ label: 'SQLite', description: 'file' }, { label: 'Postgres', description: 'server' }] }] })], 2000);
  write(root, 'kestrel', [prompt('kestrel', ago(3000)), tool('kestrel', ago(2000), 'Bash', { command: 'npm test' })], 2000);
  const out = A.scan(root, new Map(), null, new Map()), pick = n => out.find(s => s.name === n);
  assert.deepStrictEqual([pick('beacon').kind, pick('beacon').phase, pick('beacon').ask, pick('beacon').since], ['question', 'waiting', 'Which database? (SQLite / Postgres)', ago(2000)]);
  assert.deepStrictEqual(pick('beacon').options, [{ key: '1', label: 'SQLite' }, { key: '2', label: 'Postgres' }]);
  assert.deepStrictEqual([pick('kestrel').kind, pick('kestrel').since], ['running', ago(2000)]);
  assert.deepStrictEqual(out.map(s => s.name), ['beacon', 'kestrel']);
});

test('the one queue order: needs you (approval, question, plan, input together, oldest block first) → done → running → exited', () => {
  const s = (id, kind, since) => ({ id, kind, since });
  const list = [s('r', 'running', 1), s('x', 'exited', 0), s('d2', 'done', 50), s('q', 'question', 30), s('d1', 'done', 10), s('a', 'approval', 20), s('i', 'input', 40), s('p', 'plan', 35)];
  assert.deepStrictEqual(list.sort(A.byQueue).map(x => x.id), ['a', 'q', 'p', 'i', 'd1', 'd2', 'r', 'x']);
});

test('the packaged app ships registry.js', () => {
  assert.ok(require('../package.json').build.files.includes('registry.js'));
});
