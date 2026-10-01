// node test/ports.test.js — lsof/ps/session-jsonl parser fixtures + one live read-only poll of this machine.
const assert = require('assert');
const p = require('../ports');

// lsof -nP -iTCP -sTCP:LISTEN -Fpcn: v4+v6 dupes fold, sorted by port, IPv6 brackets stripped
const listen = p.parseListen(['p19095', 'cnode', 'n127.0.0.1:5173', 'n[::1]:5173', 'p686', 'cnode', 'n*:4444', 'p501', 'cControlCe', 'n*:7000', 'n[::]:7000', 'nbogus', ''].join('\n'));
assert.deepStrictEqual(listen.map(r => [r.pid, r.cmd, r.host, r.port]), [[686, 'node', '*', 4444], [19095, 'node', '127.0.0.1', 5173], [501, 'ControlCe', '*', 7000]]);

// lsof -a -d cwd -Fn -p …: pid → names (lsof -F also emits an f line per file)
const cwd = p.parsePidFiles('p686\nfcwd\nn/Users/x/projects\np19095\nfcwd\nn/Users/x/projects/spider bench\n');
assert.deepStrictEqual([cwd.get(686), cwd.get(19095)], [['/Users/x/projects'], ['/Users/x/projects/spider bench']]);

// ps etime forms
assert.deepStrictEqual(['00:05', '12:34', '01:02:03', '4-01:00:00'].map(p.etimeMs), [5e3, 754e3, 3723e3, (4 * 24 + 1) * 3600e3]);
const ps = p.parsePs('  686 4-06:04:44 node /Users/x/projects/notepad/server.js\n19095 01:02:03 node /x/node_modules/.bin/vite --port 5173\n');
assert.deepStrictEqual(ps.map(r => [r.pid, r.args.split(' ')[0]]), [[686, 'node'], [19095, 'node']]);
assert.strictEqual(p.kindOf(ps[1].args, 'node'), 'vite');
assert.strictEqual(p.kindOf('/opt/homebrew/bin/python3 -m http.server 8000', 'Python'), 'http.server');
assert.strictEqual(p.kindOf('node server.js', 'node'), 'node');

assert.strictEqual(p.titleOf('<html><head><TITLE>\n  Spider  bench </TITLE>'), 'Spider bench');
assert.strictEqual(p.titleOf('{"ok":true}'), '');
assert.strictEqual(p.projOfDir('-Users-x-projects-passfit'), 'passfit');
assert.strictEqual(p.projOfDir('-Users-x-projects-vibepet-site'), 'vibepet-site');

// announcements: new and gone listeners, keyed by pid:port
const vite = { pid: 1, port: 5173, kind: 'vite', project: 'spiderbench' }, py = { pid: 2, port: 8000, kind: 'http.server', project: null };
assert.deepStrictEqual(p.diff([py], [py, vite]), ['vite (spiderbench) on :5173 is up']);
assert.deepStrictEqual(p.diff([py, vite], [vite]), ['http.server on :8000 went down']);
assert.deepStrictEqual(p.diff([vite], [vite]), []);

// session jsonl: shell task moved to background, then its notification; async Agent launch
const J = [
  JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'toolu_01A', name: 'Bash', input: { command: 'npm run dev', description: 'start dev server', run_in_background: true } }] } }),
  JSON.stringify({ type: 'user', message: { content: [{ tool_use_id: 'toolu_01A', type: 'tool_result', content: 'Command running in background (ID: bfv2z86fl). Output is being written to: /tmp/x/tasks/bfv2z86fl.output' }] } }),
  JSON.stringify({ type: 'queue-operation', content: '<task-notification>\n<task-id>bfv2z86fl</task-id>\n<tool-use-id>toolu_01A</tool-use-id>\n<status>failed</status>\n<summary>Background command "npm run dev &amp;&amp; echo" failed</summary>' }),
  JSON.stringify({ type: 'user', toolUseResult: { isAsync: true, status: 'async_launched', agentId: 'a77511008ebcf72df', description: 'vibepet \"localhost\" watch' } }),
  JSON.stringify({ type: 'user', message: { content: [{ tool_use_id: 'toolu_01B', type: 'tool_result', content: 'moved to the background (ID: bz1fd6hp6).' }] } }),
  JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'toolu_01B', name: 'Bash', input: { command: 'ffmpeg -i in.mov out.mp4' } }] } }),
].join('\n');
assert.deepStrictEqual(p.taskInfo(J, 'bfv2z86fl'), { status: 'failed', desc: 'start dev server', summary: 'npm run dev && echo" failed' });
assert.deepStrictEqual(p.taskInfo(J, 'a77511008ebcf72df'), { status: null, desc: 'vibepet "localhost" watch', summary: null });
assert.deepStrictEqual(p.taskInfo(J, 'bz1fd6hp6'), { status: null, desc: 'ffmpeg -i in.mov out.mp4', summary: null });
assert.deepStrictEqual(p.taskInfo(J, 'bnope0000'), { status: null, desc: null, summary: null });
console.log('parsers ok');

(async () => {   // live, read-only: shape only (whatever is running on this machine)
  const t0 = Date.now(), { servers, procs } = await p.listServers(), tasks = await p.listTasks();
  for (const s of servers) assert(s.pid > 0 && s.port > 0 && s.kind, JSON.stringify(s));
  // a task's name comes out of a real transcript: a failure reports its shape, never its text
  for (const t of tasks) assert(t.id && t.name && ['running', 'done', 'completed', 'failed', 'killed', 'stopped'].includes(t.status) || t.status, JSON.stringify({ id: !!t.id, name: !!t.name, status: t.status }));
  console.log('live ok', { ms: Date.now() - t0, servers: servers.map(s => `${s.kind}:${s.port}${s.title ? ' "' + s.title + '"' : ''}`).slice(0, 6),
    procs: procs.length, tasks: tasks.filter(t => t.running).length + ' running / ' + tasks.length });
})().catch(e => { console.error(e); process.exit(1); });
