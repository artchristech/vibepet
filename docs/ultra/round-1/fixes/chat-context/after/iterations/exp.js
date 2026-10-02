// Q1 phrasing experiment: the app's exact claude -p call (system prompt, flags, Haiku) on the captured stdin, needs line varied
const fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
for (const k of Object.keys(process.env)) if (/^CLAUDE(CODE$|_CODE_|_PID$|_EFFORT$)/.test(k)) delete process.env[k];
const src = fs.readFileSync(process.argv[2], 'utf8');
const main = fs.readFileSync('/Users/christopherharris/.vibepet-ultra/wt/r1-chat-context/main.js', 'utf8');
const SYS = eval('(' + main.match(/const SYSTEM = (name => `[\s\S]*?`);/)[1] + ')')('Net') + '\n\nThe user\'s message starts with a <live_context> block the app attached: their live repo and agent state.';
const B = 'Which database should beacon use to store check results? (SQLite / Postgres / Redis)', K = 'Bash: ./deploy.sh --dry-run';
const V = {
  todo: `Needs you now: beacon first: answer "${B}"; then kestrel: approve "${K}". Quote these asks exactly.`,
  queue: `Needs you now, the whole queue (who needs the user first = this queue, in order): 1. beacon: answer "${B}" 2. kestrel: approve "${K}". Quote each ask exactly.`,
  next: `Needs you now: beacon first: answer "${B}". Next: kestrel: approve "${K}". Asked who needs the user first, give the first and its ask, then who's next and theirs.`,
};
const dir = path.join(os.tmpdir(), 'vibepet-chat'); fs.mkdirSync(dir, { recursive: true });
const run = input => new Promise(res => { let out = ''; const c = spawn(path.join(os.homedir(), '.local/bin/claude'), ['-p', '--no-session-persistence', '--tools', '', '--setting-sources', '', '--strict-mcp-config', '--output-format', 'json', '--model', 'claude-haiku-4-5-20251001', '--system-prompt', SYS], { cwd: dir, stdio: ['pipe', 'pipe', 'ignore'] });
  c.stdout.on('data', d => out += d); c.on('close', () => { try { res(JSON.parse(out).result); } catch { res('ERR ' + out.slice(0, 200)); } }); c.stdin.end(input); });
(async () => {
  const jobs = [];
  for (const [k, line] of Object.entries(V)) for (let i = 0; i < 3; i++) jobs.push((async () => { const t = Date.now(); const r = await run(src.replace(/^Needs you now: .*$/m, line)); return { k, i, ms: Date.now() - t, kestrel: /kestrel/i.test(r), cmd: /deploy\.sh --dry-run/.test(r), store: /store check results|storing check results|for check results/i.test(r), r }; })());
  for (const x of await Promise.all(jobs)) console.log(JSON.stringify(x));
  console.log('load', os.loadavg().map(x => x.toFixed(2)).join(' '));
})();
