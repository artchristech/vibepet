// fault injection at the network boundary for one fleet member: every request gets HTTP 400 at once (not retried), so
// a /loop fire is a real scheduler fire whose model call fails: $0. Logs time + method + path only: no header is read
// or written anywhere (the Authorization bearer stays unread in memory) and no body.
const http = require('http'), fs = require('fs');
const log = process.argv[3];
let n = 0;
const s = http.createServer((q, r) => {
  n++; fs.appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), n, method: q.method, path: String(q.url).split('?')[0] }) + '\n');
  q.resume();
  r.writeHead(400, { 'content-type': 'application/json', 'x-should-retry': 'false' });
  r.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'vibepet-ultra fault injection: no API in this run' } }));
});
s.listen(+process.argv[2] || 0, '127.0.0.1', () => console.log('PORT ' + s.address().port));
setTimeout(() => process.exit(0), 40 * 60e3);
