// node --test test/overrides.test.js — test-isolation env overrides (overrides.js): defaults are the shipped paths,
// each override is honoured by the modules that read Claude Code's data, and no module builds a ~/.claude path itself.
// Fixtures only: nothing here opens a file under the real ~/.claude.
const test = require('node:test');
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const O = require('../overrides');

const ROOT = path.join(__dirname, '..');
const HOME = os.homedir();

test('unset: the shipped paths, no userData override, the saved jump key', () => {
  assert.strictEqual(O.claudeDir({}), path.join(HOME, '.claude'));
  assert.strictEqual(O.projectsDir({}), path.join(HOME, '.claude', 'projects'));
  assert.strictEqual(O.sessionsDir({}), path.join(HOME, '.claude', 'sessions'));
  assert.strictEqual(O.isolated({}), false);
  assert.strictEqual(O.userData({}), null);
  assert.strictEqual(O.hotkey({}), undefined);
  for (const blank of ['', '   ']) {   // an empty export is the same as none
    const env = { VIBEPET_CLAUDE_DIR: blank, VIBEPET_USER_DATA: blank, VIBEPET_HOTKEY: blank };
    assert.deepStrictEqual([O.claudeDir(env), O.isolated(env), O.userData(env), O.hotkey(env)], [path.join(HOME, '.claude'), false, null, undefined]);
  }
});

test('VIBEPET_CLAUDE_DIR moves projects/ and sessions/ together; ~ and relative paths resolve', () => {
  const env = { VIBEPET_CLAUDE_DIR: '/x/fleet/root/.claude' };
  assert.strictEqual(O.claudeDir(env), '/x/fleet/root/.claude');
  assert.strictEqual(O.projectsDir(env), '/x/fleet/root/.claude/projects');
  assert.strictEqual(O.sessionsDir(env), '/x/fleet/root/.claude/sessions');
  assert.strictEqual(O.isolated(env), true);
  assert.strictEqual(O.claudeDir({ VIBEPET_CLAUDE_DIR: '~/.vp-root/.claude' }), path.join(HOME, '.vp-root', '.claude'));
  assert.strictEqual(O.claudeDir({ VIBEPET_CLAUDE_DIR: 'rel/.claude' }), path.resolve('rel/.claude'));
  assert.strictEqual(O.claudeDir({ VIBEPET_CLAUDE_DIR: ' /x/r/ ' }), '/x/r');
});

test('VIBEPET_USER_DATA and VIBEPET_HOTKEY', () => {
  assert.strictEqual(O.userData({ VIBEPET_USER_DATA: '/x/ud/a' }), '/x/ud/a');
  assert.strictEqual(O.userData({ VIBEPET_USER_DATA: '~/ud' }), path.join(HOME, 'ud'));
  for (const off of ['off', 'OFF', ' Off ']) assert.strictEqual(O.hotkey({ VIBEPET_HOTKEY: off }), null, off);
  assert.strictEqual(O.hotkey({ VIBEPET_HOTKEY: 'Alt+Command+K' }), 'Alt+Command+K');
});

// ---- the modules: each one runs in a child with the env set, the way the app reads it (once, at require time)
const fixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibepet-overrides-'));
  const claude = path.join(root, '.claude'), proj = path.join(claude, 'projects', '-x-app');
  fs.mkdirSync(proj, { recursive: true }); fs.mkdirSync(path.join(claude, 'sessions'));
  const iso = s => new Date(Date.parse('2026-01-01T10:00:00Z') + s * 1000).toISOString();
  fs.writeFileSync(path.join(proj, 'sess-1.jsonl'), [
    { type: 'user', cwd: root, timestamp: iso(0), message: { role: 'user', content: 'add dark mode' } },
    { type: 'assistant', cwd: root, timestamp: iso(5), message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done.' }] } },
  ].map(r => JSON.stringify(r)).join('\n') + '\n');
  return { root, claude, file: path.join(proj, 'sess-1.jsonl') };
};
const node = (code, env) => {
  const clean = { ...process.env }; delete clean.VIBEPET_CLAUDE_DIR;
  return JSON.parse(execFileSync(process.execPath, ['-e', code], { cwd: ROOT, env: { ...clean, ...env }, encoding: 'utf8', timeout: 20e3 }));
};

test('agents.js: a pid is matched to its session through <root>/sessions/<pid>.json', t => {
  const fx = fixture(); t.after(() => fs.rmSync(fx.root, { recursive: true, force: true }));
  const PID = 424242;   // above macOS's pid ceiling (99999): never a real process, never a real registry file
  fs.writeFileSync(path.join(fx.claude, 'sessions', PID + '.json'), JSON.stringify({ pid: PID, sessionId: 'sess-1' }));
  const code = `require('./agents').locateSession({ id: 'sess-1' }, new Map([[${PID}, { pid: ${PID}, ppid: 1, tty: '/dev/ttys999', start: 0, comm: '/opt/x/claude' }]]))
    .then(r => console.log(JSON.stringify(r)))`;
  assert.deepStrictEqual(node(code, { VIBEPET_CLAUDE_DIR: fx.claude }), { pid: PID, tty: '/dev/ttys999' });
  assert.strictEqual(node(code, {}), null, 'unset: ~/.claude/sessions has no such pid');
});

test('theater: replays a session under the watched root, refuses one outside it', t => {
  const fx = fixture(); t.after(() => fs.rmSync(fx.root, { recursive: true, force: true }));
  const tl = f => `require('./theater').timeline(${JSON.stringify(f)}).then(t => console.log(JSON.stringify({ ok: t.meta.file })), e => console.log(JSON.stringify({ err: e.message })))`;
  const env = { VIBEPET_CLAUDE_DIR: fx.claude };
  assert.deepStrictEqual(node(tl(fx.file), env), { ok: 'sess-1' });
  // refused before any read: the real root while isolated, a look-alike sibling, and the fixture when not isolated
  assert.deepStrictEqual(node(tl(path.join(HOME, '.claude', 'projects', '-nope', 'none.jsonl')), env), { err: 'not a session file' });
  assert.deepStrictEqual(node(tl(path.join(fx.claude, 'projects-x', 'a', 'b.jsonl')), env), { err: 'not a session file' });
  assert.deepStrictEqual(node(tl(fx.file), {}), { err: 'not a session file' });
});

test('ports: an isolated root lists only its own sessions\' background tasks (none from this machine\'s real ones)', t => {
  const fx = fixture(); t.after(() => fs.rmSync(fx.root, { recursive: true, force: true }));
  // the child prints a count only: if isolation ever broke, a failure message must not carry real task text
  assert.strictEqual(node(`require('./ports').listTasks().then(r => console.log(r.length))`, { VIBEPET_CLAUDE_DIR: fx.claude }), 0);
  // names only, to show the check isn't vacuous: how many real task outputs sit in Claude Code's tmp right now
  const TMP = `/private/tmp/claude-${process.getuid()}`, ls = d => { try { return fs.readdirSync(d); } catch { return []; } };
  const real = ls(TMP).flatMap(pd => ls(path.join(TMP, pd)).flatMap(sd => ls(path.join(TMP, pd, sd, 'tasks')).filter(f => f.endsWith('.output'))));
  t.diagnostic(`${real.length} task outputs from this machine's own sessions stayed out`);
});

test('ports: an isolated root lists the servers its own sessions run, not the rest of the machine\'s', async t => {
  const { spawn } = require('child_process');
  const fx = fixture(), outside = fs.mkdtempSync(path.join(os.tmpdir(), 'vibepet-outside-')), kids = [];
  t.after(() => { for (const k of kids) k.kill('SIGKILL'); for (const d of [fx.root, outside]) fs.rmSync(d, { recursive: true, force: true }); });
  // a session ran in <root>/app (lsof reports physical paths: name its session dir after the realpath); its dev server
  // listens from app/web, a sub-dir. Another server, not any watched session's, listens from a dir outside.
  const app = path.join(fs.realpathSync(fx.root), 'app'), web = path.join(app, 'web');
  fs.mkdirSync(web, { recursive: true });
  fs.mkdirSync(path.join(fx.claude, 'projects', require('../ports').sessionDirOf(app)));
  const serve = cwd => new Promise((res, rej) => {
    const k = spawn(process.execPath, ['-e', "require('http').createServer((q, r) => r.end('<title>fx</title>')).listen(0, '127.0.0.1', function () { console.log(this.address().port) })"],
      { cwd, stdio: ['ignore', 'pipe', 'ignore'] });
    kids.push(k); k.once('error', rej); k.stdout.once('data', d => res(+String(d).trim()));
  });
  const ports = [await serve(web), await serve(outside)];
  const seen = env => node(`require('./ports').listServers().then(r => console.log(JSON.stringify(${JSON.stringify(ports)}.map(p => r.servers.some(s => s.port === p)))))`, env);
  assert.deepStrictEqual(seen({ VIBEPET_CLAUDE_DIR: fx.claude }), [true, false], 'isolated: its session\'s server only');
  assert.deepStrictEqual(seen({}), [true, true], 'unset: every server on the machine, as shipped');
});

test('no module builds a path into ~/.claude except through overrides.js', () => {
  const files = ['.', 'content', 'theater', 'renderer'].flatMap(d => fs.readdirSync(path.join(ROOT, d)).filter(f => f.endsWith('.js')).map(f => path.join(d, f)));
  const hits = [];
  for (const f of files) fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n').forEach((l, i) => {
    const code = l.replace(/\/\/.*$/, '');   // comments may say ~/.claude; code may not
    if (/\.claude\b/.test(code) || /homedir\(\).*['"`/](?:projects|sessions)\b/.test(code)) hits.push(`${f}:${i + 1}`);
  });
  // allowed: the override itself, and findClaude()'s lookup of the `claude` binary (~/.claude/local/claude is an install, not data)
  const allowed = hits.filter(h => h.startsWith('overrides.js:') || /^main\.js:/.test(h) && /\.claude\/local\/claude/.test(fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8').split('\n')[+h.split(':')[1] - 1]));
  assert.deepStrictEqual(hits.filter(h => !allowed.includes(h)), []);
  assert.ok(allowed.some(h => h.startsWith('overrides.js:')), 'the guard still sees overrides.js (pattern not stale)');
});

test('the packaged app ships overrides.js', () => {
  assert.ok(require('../package.json').build.files.includes('overrides.js'));
});
