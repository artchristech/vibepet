// fixture HTTP server for the S6 drive: node fx/server.js <port> [host] [title] [lifeMs]
// prints one JSON line when listening: {listenAt, pid, address, port}; serves <title> on every path.
const http = require('http');
const [port, host, title, life] = [+process.argv[2], process.argv[3] || '', process.argv[4] || '', +(process.argv[5] || 900e3)];
const body = title ? `<!doctype html><title>${title}</title><p>${title}</p>` : '';
const s = http.createServer((q, r) => {
  if (!title) { r.writeHead(404); return r.end(); }
  r.setHeader('content-type', 'text/html'); r.end(body);
});
s.on('error', e => { console.log(JSON.stringify({ error: e.code, at: Date.now(), pid: process.pid })); process.exit(3); });
const cb = () => console.log(JSON.stringify({ listenAt: Date.now(), pid: process.pid, address: s.address().address, port: s.address().port }));
host ? s.listen(port, host, cb) : s.listen(port, cb);
setTimeout(() => process.exit(0), life);   // never outlives the drive
