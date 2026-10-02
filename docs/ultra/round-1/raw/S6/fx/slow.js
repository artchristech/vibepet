// a dev server whose first response is slow (Next.js-style compile on first hit): node slow.js <port> <title> <firstMs>
const http = require('http');
const [port, title, firstMs] = [+process.argv[2], process.argv[3] || 'slow app', +(process.argv[4] || 3000)];
let warm = false;
const s = http.createServer((q, r) => { const send = () => { r.setHeader('content-type', 'text/html'); r.end(`<!doctype html><title>${title}</title>`); };
  if (warm) return send(); setTimeout(() => { warm = true; send(); }, firstMs); });
s.listen(port, () => console.log(JSON.stringify({ listenAt: Date.now(), pid: process.pid, port })));
setTimeout(() => process.exit(0), 900e3);
