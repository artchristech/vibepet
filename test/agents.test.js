// node test/agents.test.js — classify() fixtures + locateSession() against this machine's live claude processes.
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { classify, psAll, locateSession } = require('../agents');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibepet-test-'));
const tail = (name, recs, ageMs) => {
  const f = path.join(dir, name + '.jsonl');
  fs.writeFileSync(f, recs.map(r => JSON.stringify(r)).join('\n') + '\n');
  return classify(f, Date.now() - ageMs);
};
const user = { type: 'user', cwd: '/x/app', message: { role: 'user', content: 'go' } };
const said = text => ({ type: 'assistant', cwd: '/x/app', message: { stop_reason: 'end_turn', content: [{ type: 'text', text }] } });

const w = tail('waiting', [user, said('Tests pass.\n\nI can also refactor the **parser**. ' + 'x'.repeat(200) + ' — should I go ahead?')], 5000);
assert.strictEqual(w.phase, 'waiting'); assert(w.ask.endsWith('?') && w.ask.length <= 120, w.ask);

const s = tail('stalled', [user, { type: 'assistant', cwd: '/x/app', message: { stop_reason: 'tool_use',
  content: [{ type: 'text', text: 'running tests' }, { type: 'tool_use', name: 'Bash', input: { command: 'npm test', description: 'run tests' } }] } }], 120000);
assert.deepStrictEqual([s.phase, s.ask], ['stalled', 'Bash: npm test']);

const r = tail('ready', [user, said('Done: the roster now renders under the pill. It hides the bubble while open.\n\n- a\n- b'),
  { type: 'ai-title', aiTitle: 'Roster in the pill', sessionId: 'r' }], 5000);
assert.deepStrictEqual([r.phase, r.ask, r.title], ['ready', 'Done: the roster now renders under the pill.', 'Roster in the pill']);
assert(r.ask.length <= 120);
assert.strictEqual(tail('working', [user], 1000).ask, undefined);
console.log('classify ok', { waiting: w.ask.slice(-40), stalled: s.ask, ready: r.ask, title: r.title });

(async () => {
  const procs = await psAll();
  const live = [...procs.values()].find(p => path.basename(p.comm) === 'claude' && p.tty);
  if (!live) { console.log('locate: no live claude CLI with a tty on this machine — skipped'); return; }
  const cwd = (await require('../agents').run('/usr/sbin/lsof', ['-a', '-p', String(live.pid), '-d', 'cwd', '-Fn'])).split('\n').find(l => l.startsWith('n')).slice(1);
  const f = path.join(dir, 'probe.jsonl'); fs.writeFileSync(f, '');
  const hit = await locateSession({ id: 'probe-' + Date.now(), cwd, file: f }, procs);
  assert(hit && procs.has(hit.pid) && /^\/dev\/ttys\d+$/.test(hit.tty), JSON.stringify(hit));
  assert.strictEqual(await locateSession({ id: 'none-' + Date.now(), cwd: dir, file: f }, procs), null);
  console.log('locate ok', { cwd, pid: hit.pid, tty: hit.tty, none: null });
})().catch(e => { console.error(e); process.exit(1); }).finally(() => fs.rmSync(dir, { recursive: true, force: true }));
