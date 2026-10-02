// node slow.js PORT "Title" DELAYMS: every request waits until DELAYMS after start (a first compile), then answers at once
const http = require('http'); const [port, title, delay] = process.argv.slice(2); const t0 = Date.now();
http.createServer((q, r) => { const w = Math.max(0, t0 + +delay - Date.now()); setTimeout(() => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(`<title>${title}</title>ok`); }, w); })
  .listen(+port, () => console.log('LISTENING ' + Date.now()));
process.on('SIGTERM', () => process.exit(143));
