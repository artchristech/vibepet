// Q1 after a first reply that already gave both asks (final live-a stdin): does 'even if you said so before' bring kestrel back?
const fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
for (const k of Object.keys(process.env)) if (/^CLAUDE(CODE$|_CODE_|_PID$|_EFFORT$)/.test(k)) delete process.env[k];
const main = fs.readFileSync('/Users/christopherharris/.vibepet-ultra/wt/r1-chat-context/main.js', 'utf8');
const SYS = eval('(' + main.match(/const SYSTEM = (name => `[\s\S]*?`);/)[1] + ')')('Net') + '\n\nThe user\'s message starts with a <live_context> block the app attached: their live repo and agent state.';
const files = fs.readdirSync(process.argv[2]).filter(f => f.endsWith('.stdin.txt')).sort((a, b) => parseInt(a) - parseInt(b));
const q1 = fs.readFileSync(path.join(process.argv[2], files[1]), 'utf8');
const cur = q1.match(/^Needs you now: .*$/m)[0];
const V = { shipped: cur, again: cur.replace("then who's next and theirs.", "then who's next and theirs, even if you said so before.") };
const dir = path.join(os.tmpdir(), 'vibepet-chat'); fs.mkdirSync(dir, { recursive: true });
const run = input => new Promise(res => { let out = ''; const c = spawn(path.join(os.homedir(), '.local/bin/claude'), ['-p', '--no-session-persistence', '--tools', '', '--setting-sources', '', '--strict-mcp-config', '--output-format', 'json', '--model', 'claude-haiku-4-5-20251001', '--system-prompt', SYS], { cwd: dir, stdio: ['pipe', 'pipe', 'ignore'] });
  c.stdout.on('data', d => out += d); c.on('close', () => { try { res(JSON.parse(out).result); } catch { res('ERR ' + out.slice(0, 200)); } }); c.stdin.end(input); });
(async () => {
  const jobs = [];
  for (const [k, line] of Object.entries(V)) for (let i = 0; i < 5; i++) jobs.push(run(q1.replace(cur, line)).then(r => ({ k, i, kestrel: /kestrel/i.test(r), cmd: /deploy\.sh --dry-run/.test(r), opts: /SQLite/.test(r) && /Postgres/.test(r) && /Redis/.test(r), r })));
  const all = await Promise.all(jobs);
  for (const x of all) console.log(JSON.stringify(x));
  for (const k of Object.keys(V)) { const xs = all.filter(x => x.k === k); console.log(k, 'kestrel', xs.filter(x => x.kestrel).length + '/' + xs.length, 'cmd', xs.filter(x => x.cmd).length + '/' + xs.length, 'beaconOpts', xs.filter(x => x.opts).length + '/' + xs.length); }
  console.log('load', os.loadavg().map(x => x.toFixed(2)).join(' '));
})();
