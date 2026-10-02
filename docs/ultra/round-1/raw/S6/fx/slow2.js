// a dev server that compiles on start (Next.js / webpack shape): every request in the first <compileMs> waits until the
// compile ends, then everything is instant. node slow2.js <port> <title> <compileMs>
const http = require('http');
const [port, title, compileMs] = [+process.argv[2], process.argv[3] || 'slow app', +(process.argv[4] || 20000)];
const t0 = Date.now();
const s = http.createServer((q, r) => { const send = () => { r.setHeader('content-type', 'text/html'); r.end(`<!doctype html><title>${title}</title>`); };
  const left = t0 + compileMs - Date.now(); left > 0 ? setTimeout(send, left) : send(); });
s.listen(port, () => console.log(JSON.stringify({ listenAt: Date.now(), pid: process.pid, port })));
setTimeout(() => process.exit(0), 900e3);
