#!/Users/christopherharris/.hermes/node/bin/node
const fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const file = path.join("/Users/christopherharris/projects/vibepet/docs/ultra/round-1/fixes/chat-context/after/live-c/2-chat/contexts", Date.now() + '-' + process.pid + '.stdin.txt');
const c = spawn("/Users/christopherharris/.local/bin/claude", process.argv.slice(2), { stdio: ['pipe', 'inherit', 'inherit'] });
process.stdin.on('data', d => { fs.appendFileSync(file, d); c.stdin.write(d); }).on('end', () => c.stdin.end());
c.stdin.on('error', () => {}); c.on('error', () => process.exit(127)); c.on('exit', code => process.exit(code ?? 1));
for (const s of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(s, () => c.kill(s));
