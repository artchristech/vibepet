// HTTPS dev server (mkcert-style local TLS): node https.js <port> <title>
const https = require('https'), fs = require('fs'), path = require('path');
const [port, title] = [+process.argv[2], process.argv[3] || 'secure app'];
const s = https.createServer({ key: fs.readFileSync(path.join(__dirname, 'k.pem')), cert: fs.readFileSync(path.join(__dirname, 'c.pem')) }, (q, r) => { r.setHeader('content-type', 'text/html'); r.end(`<!doctype html><title>${title}</title>`); });
s.listen(port, '127.0.0.1', () => console.log(JSON.stringify({ listenAt: Date.now(), pid: process.pid, port })));
setTimeout(() => process.exit(0), 900e3);
