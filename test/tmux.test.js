// node --test test/tmux.test.js — tmux.js: the registry's pane target, the attached client a jump picks, and the screen
// guard send-to runs before typing, on Claude Code 2.1.287 screens transcribed from the round-0 fleet
// (docs/ultra/round-0/panes/*.txt, fleet-states.md) plus their `capture-pane -e` form; then locateSession() returning the
// registry entry (and never guessing a pid that runs another session) against fake claude processes and a temp registry.
// Nothing here talks to a tmux server.
const test = require('node:test');
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn } = require('child_process');

// locateSession reads <VIBEPET_CLAUDE_DIR>/sessions, fixed when agents.js loads: point it at a temp root first
const ROOT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibepet-tmux-')));
process.env.VIBEPET_CLAUDE_DIR = ROOT;
fs.mkdirSync(path.join(ROOT, 'sessions'));
const { parseTarget, owns, pickClient, screenState, guard, typed, literal } = require('../tmux');
const { psAll, locateSession } = require('../agents');
test.after(() => fs.rmSync(ROOT, { recursive: true, force: true }));

const R = '─'.repeat(40), D = '╌'.repeat(40);
// kestrel: Bash ./deploy.sh --dry-run waiting for approval (panes/kestrel.txt); the past prompts above are transcript
const KESTREL = `❯ Run exactly ./deploy.sh --dry-run again with the Bash tool, nothing else first.

⏺ Bash(./deploy.sh --dry-run)
  ⎿  Interrupted · What should Claude do instead?

✻ Baked for 1s · done 2:56 PM

❯ Run exactly ./deploy.sh --dry-run again with the Bash tool, nothing else first.

⏺ Bash(./deploy.sh --dry-run)
  ⎿  Waiting…

${R}
 Bash command
 Run dry-run deploy script
${D}
 ./deploy.sh --dry-run
${D}
 This command requires approval

 Do you want to proceed?
 ❯ 1. Yes
   2. Yes, and don’t ask again for: ./deploy.sh *
   3. No

 Esc to cancel · Tab to amend
`;
// the same dialog as `capture-pane -p -e` gives it (live vp-kestrel, rules shortened)
const KESTREL_E = `\n\u001b[38;5;246m\u001b[49m⏺\u001b[39m \u001b[1mBash\u001b[0m(./deploy.sh --dry-run)\n\u001b[38;5;246m  ⎿  Waiting…\u001b[39m\n\n\u001b[38;5;153m${R}\n\u001b[39m \u001b[1m\u001b[38;5;153mBash command\u001b[0m\n \u001b[38;5;246mRun dry-run deploy script\u001b[39m\n\u001b[38;5;239m${D}\n\u001b[39m ./deploy.sh --dry-run\n\u001b[38;5;239m${D}\n\u001b[39m This command requires approval\n\n Do you want to proceed?\n \u001b[38;5;153m❯\u001b[39m \u001b[38;5;246m1.\u001b[39m \u001b[38;5;153mYes\u001b[39m\n   \u001b[38;5;246m2.\u001b[39m Yes, and don’t ask again for: ./deploy.sh *\n   \u001b[38;5;246m3.\u001b[39m No\n\n \u001b[38;5;246mEsc\u001b[39m \u001b[38;5;246mto\u001b[39m \u001b[38;5;246mcancel\u001b[39m \u001b[38;5;246m·\u001b[39m \u001b[38;5;246mTab\u001b[39m \u001b[38;5;246mto\u001b[39m \u001b[38;5;246mamend\u001b[39m\n\n\n`;
// beacon: AskUserQuestion SQLite / Postgres / Redis (panes/beacon.txt) — its ❯ 1. sits at column 0, under no rule
const BEACON = `✻ Cogitated for 2s · done 2:55 PM

❯ Use the AskUserQuestion tool again to ask me which database beacon should use (SQLite, Postgres, or Redis). Nothing else first.
${R}
 ☐ Database choice

Which database should beacon use to store check results?

❯ 1. SQLite
     Lightweight, file-based, good for local/single-server deployments
  2. Postgres
     Full-featured relational database, scales well, good for distributed systems
  3. Redis
     In-memory data store, fast for caching and time-series data
  4. Type something.
${R}
  5. Chat about this

Enter to select · ↑/↓ to navigate · Esc to cancel
`;
const BEACON_E = `\n\u001b[38;5;246m✻\u001b[39m \u001b[38;5;246mChurned for 1s · done 8:13 PM\u001b[39m\n\n\u001b[38;5;246m\u001b[48;5;237m❯ \u001b[38;5;231mUse the AskUserQuestion tool again to ask me which database beacon should use (SQLite, Postgres, or Redis). Nothing else first.\u001b[39m\n\u001b[38;5;246m\u001b[49m${R}\n\u001b[38;5;16m\u001b[48;5;153m ☐ Database choice \u001b[39m\u001b[49m\n\n\u001b[1m\u001b[38;5;231mWhich database should beacon use to store check results?\u001b[0m\n\n\u001b[38;5;153m❯\u001b[39m \u001b[38;5;246m1.\u001b[39m \u001b[38;5;153mSQLite\u001b[39m\n     \u001b[38;5;246mLightweight, file-based, good for local/single-server deployments\u001b[39m\n  \u001b[38;5;246m2.\u001b[39m Postgres\n     \u001b[38;5;246mFull-featured relational database\u001b[39m\n  \u001b[38;5;246m3.\u001b[39m Redis\n     \u001b[38;5;246mIn-memory data store\u001b[39m\n  \u001b[38;5;246m4.\u001b[39m \u001b[38;5;246mType\u001b[39m \u001b[38;5;246msomething.\u001b[39m\n\u001b[38;5;246m${R}\n\u001b[39m  5. Chat about this\n\n\u001b[38;5;246mEnter\u001b[39m \u001b[38;5;246mto\u001b[39m \u001b[38;5;246mselect\u001b[39m \u001b[38;5;246m·\u001b[39m \u001b[38;5;246m↑/↓\u001b[39m \u001b[38;5;246mto\u001b[39m \u001b[38;5;246mnavigate\u001b[39m \u001b[38;5;246m·\u001b[39m \u001b[38;5;246mEsc\u001b[39m \u001b[38;5;246mto\u001b[39m \u001b[38;5;246mcancel\u001b[39m`;
// vibepet: done, idle at its input box (capture-pane -e of the live pane: the box's ❯ is followed by a no-break space)
const box = (input, foot = '? for shortcuts · ← 1 agent') => `\u001b[38;5;231m\u001b[49m⏺\u001b[39m The app's main entry file is main.js.\n\n\u001b[38;5;246m✻\u001b[39m \u001b[38;5;246mCooked for 0s · done 9:13 PM\u001b[39m\n\n\u001b[38;5;244m${R}\n\u001b[39m❯ ${input}\n\u001b[38;5;244m${R}\n\u001b[39m  \u001b[38;5;246m⏸\u001b[39m \u001b[38;5;246mmanual\u001b[39m \u001b[38;5;246mmode\u001b[39m \u001b[38;5;246mon\u001b[39m \u001b[38;5;246m·\u001b[39m \u001b[38;5;246m${foot}\u001b[39m\n`;
const VIBEPET_E = box('');
// atlas: a 9-minute foreground build, busy (panes/atlas.txt)
const ATLAS = `⏺ Bash(./build.sh)
  ⎿  [build] batch 33/54 done
     [build] batch 34/54 done
     +31 lines (5m 50s · timeout 10m)
     (ctrl+b ctrl+b (twice) to run in background)

· Metamorphosing… (5m 54s · ↓ 143 tokens)

${R}
❯
${R}
  ⏸ manual mode on · esc to interrupt · ← 1 agent




`;
// vibepet as plain `capture-pane -p` shows it (panes/vibepet.txt): 'start it' is a grey suggestion, but plain text has no colour
const VIBEPET_PLAIN = `⏺ This project is a desktop AI pet application for developers built with Electron.

✻ Cogitated for 4s · done 2:25 PM

${R}
❯ start it
${R}
  ⏸ manual mode on · ? for shortcuts · ← 1 agent                get pinged when Claude finishes · enable push notifications in /config
`;

test('parseTarget: the registry tmux field → session, window, pane', () => {
  assert.deepStrictEqual(parseTarget('vp-kestrel:@8.%8'), { session: 'vp-kestrel', window: '@8', pane: '%8' });
  assert.deepStrictEqual(parseTarget('my work:@12.%40'), { session: 'my work', window: '@12', pane: '%40' });
  assert.deepStrictEqual(parseTarget('%3'), { session: null, window: null, pane: '%3' });
  for (const bad of [undefined, '', 'vp-kestrel', 'vp-kestrel:0.0', 'vp-kestrel:@8', '%8; kill-server', 'a:b:@1.%2']) assert.strictEqual(parseTarget(bad), null, String(bad));
});

test('owns: the pane pid must be claude itself or one of its ancestors', () => {
  const procs = new Map([[500, { ppid: 400 }], [400, { ppid: 300 }], [300, { ppid: 1 }], [900, { ppid: 1 }]]);
  assert.ok(owns(procs, 400, 500));
  assert.ok(owns(procs, 300, 500));
  assert.ok(owns(procs, 500, 500));
  assert.ok(!owns(procs, 900, 500));
  assert.ok(!owns(procs, 400, 777));   // a pid ps doesn't know
});

test('pickClient: a client already on the session, else the most recently used one', () => {
  const out = '/dev/ttys012 4101 1790900000 vp-vibepet\n/dev/ttys013 4102 1790900500 main\n/dev/ttys014 4103 1790900100 vp-kestrel\n';
  assert.deepStrictEqual(pickClient(out, 'vp-kestrel'), { tty: '/dev/ttys014', pid: 4103, activity: 1790900100, session: 'vp-kestrel' });
  assert.strictEqual(pickClient(out, 'vp-beacon').tty, '/dev/ttys013');
  assert.strictEqual(pickClient('/dev/ttys012 4101 1790900000 my work\n', 'my work').session, 'my work');
  assert.strictEqual(pickClient('', 'vp-kestrel'), null);
  assert.strictEqual(pickClient(null, 'vp-kestrel'), null);
});

test('guard: an approval prompt takes approve / always / deny, nothing else', () => {
  for (const s of [KESTREL, KESTREL_E]) {
    assert.deepStrictEqual(screenState(s).perm, { onYes: true, always: true });
    for (const a of ['approve', 'always', 'deny']) assert.strictEqual(guard(s, a, null, 'kestrel'), null, a);
    assert.strictEqual(guard(s, 'option', '1', 'kestrel'), "kestrel isn't showing a question");
    assert.strictEqual(guard(s, 'text', null, 'kestrel'), 'kestrel is showing an approval prompt, not its input box');
    assert.strictEqual(guard(s, 'interrupt', null, 'kestrel'), "kestrel isn't busy");
  }
  // ↓↓ moved the highlight to No: Enter would deny, so approve refuses; a prompt whose 2. is No has no 'always'
  const onNo = KESTREL.replace(' ❯ 1. Yes', '   1. Yes').replace('   3. No', ' ❯ 3. No');
  assert.strictEqual(guard(onNo, 'approve', null, 'kestrel'), "kestrel's approval prompt has another option selected");
  assert.strictEqual(guard(onNo, 'deny', null, 'kestrel'), null);
  const yesNo = KESTREL.replace('   2. Yes, and don’t ask again for: ./deploy.sh *\n   3. No', '   2. No');
  assert.strictEqual(guard(yesNo, 'always', null, 'kestrel'), `kestrel's approval prompt has no "don't ask again" option`);
  assert.strictEqual(guard(yesNo, 'approve', null, 'kestrel'), null);
});

test('guard: an AskUserQuestion list takes its own option digits only; a text reply is refused', () => {
  for (const s of [BEACON, BEACON_E]) {
    assert.deepStrictEqual(screenState(s).ask.keys, ['1', '2', '3', '4', '5']);
    assert.strictEqual(screenState(s).box, null);
    assert.strictEqual(guard(s, 'option', '2', 'beacon'), null);
    assert.strictEqual(guard(s, 'option', 7, 'beacon'), "beacon's question has no option 7");
    assert.strictEqual(guard(s, 'text', null, 'beacon'), 'beacon is showing a question: pick one of its options');
    assert.strictEqual(guard(s, 'approve', null, 'beacon'), "beacon isn't showing an approval prompt");
    assert.strictEqual(guard(s, 'deny', null, 'beacon'), "beacon isn't showing an approval prompt");
  }
});

test('guard: an idle input box takes text; approve, option and interrupt are refused', () => {
  assert.deepStrictEqual(screenState(VIBEPET_E).box, { draft: false });
  assert.strictEqual(guard(VIBEPET_E, 'text', null, 'vibepet'), null);
  assert.strictEqual(guard(VIBEPET_E, 'approve', null, 'vibepet'), "vibepet isn't showing an approval prompt");
  assert.strictEqual(guard(VIBEPET_E, 'option', '1', 'vibepet'), "vibepet isn't showing a question");
  assert.strictEqual(guard(VIBEPET_E, 'interrupt', null, 'vibepet'), "vibepet isn't busy");
  // 'Do you want to proceed?' + '1. Yes' in the transcript, above a live input box, is not a prompt
  const told = box('').replace("The app's main entry file is main.js.", 'Ready to deploy.\n\n  Do you want to proceed?\n  1. Yes\n  2. No');
  assert.strictEqual(guard(told, 'approve', null, 'vibepet'), "vibepet isn't showing an approval prompt");
  assert.strictEqual(guard('', 'text', null, 'x'), "x isn't showing its input box");
});

test('guard: a grey prompt suggestion is not a draft; typed text is', () => {
  assert.strictEqual(guard(box('\u001b[7m\u001b[38;5;246ms\u001b[27mtart it\u001b[39m'), 'text', null, 'vibepet'), null);   // inverse cursor cell + grey
  assert.strictEqual(guard(box('\u001b[2mstart it\u001b[22m'), 'text', null, 'vibepet'), null);   // dim
  assert.strictEqual(guard(box('\u001b[38;2;140;140;140mstart it\u001b[39m'), 'text', null, 'vibepet'), null);   // truecolour grey
  for (const d of ['run the tests', '\u001b[38;5;231mrun the tests\u001b[39m', '\u001b[38;5;211m! npm test\u001b[39m', '\u001b[38;5;246mgrey\u001b[0m then typed'])
    assert.strictEqual(guard(box(d), 'text', null, 'vibepet'), 'vibepet has unsent text in its input box', JSON.stringify(d));
  assert.strictEqual(guard(VIBEPET_PLAIN, 'text', null, 'vibepet'), 'vibepet has unsent text in its input box');   // why send() captures with -e
  assert.ok(!typed('\u001b[39m❯ ') && typed('\u001b[39m❯ hi'));
});

test('guard: a busy session takes interrupt, and text (Claude Code queues it)', () => {
  assert.deepStrictEqual(screenState(ATLAS), { box: { draft: false }, perm: null, ask: null, busy: true });
  assert.strictEqual(guard(ATLAS, 'interrupt', null, 'atlas'), null);
  assert.strictEqual(guard(ATLAS, 'text', null, 'atlas'), null);
  assert.strictEqual(guard(ATLAS, 'approve', null, 'atlas'), "atlas isn't showing an approval prompt");
  assert.strictEqual(guard(box('', 'esc to interrupt · ← 1 agent'), 'interrupt', null, 'delta'), null);
  assert.strictEqual(guard(ATLAS, 'reboot', null, 'atlas'), 'unknown action reboot');
});

test('literal: a reply ending in ";" survives tmux argument parsing', () => {
  assert.strictEqual(literal('run it;'), 'run it\\;');
  assert.strictEqual(literal('a; b'), 'a; b');
});

// ---------- locateSession → the registry entry; a pid whose registry names another session is never guessed ----------
const fake = cwd => new Promise((res, rej) => { const p = spawn('/bin/sleep', ['60'], { argv0: 'claude', cwd, stdio: 'ignore' }); p.on('spawn', () => res(p)); p.on('error', rej); });
const reg = (pid, e) => fs.writeFileSync(path.join(ROOT, 'sessions', pid + '.json'), JSON.stringify({ pid, ...e }));

test('locateSession: exact registry hit carries the entry; exited sessions get null; an unregistered claude is found by cwd', async t => {
  const repoA = path.join(ROOT, 'repoA'), repoB = path.join(ROOT, 'repoB'), file = path.join(ROOT, 'old.jsonl');
  for (const d of [repoA, repoB]) fs.mkdirSync(d);
  fs.writeFileSync(file, '');
  const A = await fake(repoA), B = await fake(repoB);
  t.after(() => { A.kill('SIGKILL'); B.kill('SIGKILL'); });
  reg(A.pid, { sessionId: 'sA', cwd: repoA, tmux: 'vp-test:@1.%1', status: 'waiting', waitingFor: 'permission prompt' });
  let procs = await psAll();
  for (let i = 0; i < 20 && !(procs.get(A.pid)?.comm === 'claude' && procs.get(B.pid)?.comm === 'claude'); i++) { await new Promise(r => setTimeout(r, 100)); procs = await psAll(); }
  const a = await locateSession({ id: 'sA', cwd: repoA, file }, procs);
  assert.strictEqual(a.pid, A.pid);
  assert.deepStrictEqual([a.reg.sessionId, a.reg.tmux, a.reg.waitingFor], ['sA', 'vp-test:@1.%1', 'permission prompt']);
  // another session of the same folder that has exited: A runs sA, so it isn't that session (before: the cwd guess took A)
  assert.strictEqual(await locateSession({ id: 'sGone', cwd: repoA, file }, procs), null);
  const b = await locateSession({ id: 'sOld', cwd: repoB, file }, procs);
  assert.deepStrictEqual([b.pid, b.reg], [B.pid, null]);
  // /clear: the cached pid now runs another session, so sA has exited
  reg(A.pid, { sessionId: 'sNext', cwd: repoA, tmux: 'vp-test:@1.%1', status: 'idle' });
  assert.strictEqual(await locateSession({ id: 'sA', cwd: repoA, file }, procs), null);
});
