// node titled.js PORT "Title" [host|-] [--exit-after MS]  → HTML page with <title>; prints LISTENING <ms>
const http = require('http'); const [port, title = 'fixture', host = '-'] = process.argv.slice(2);
const ex = process.argv.indexOf('--exit-after');
const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(`<!doctype html><html><head><title>${title}</title></head><body>${title} pid ${process.pid}</body></html>`); });
const cb = () => { console.log('LISTENING ' + Date.now()); if (ex > 0) setTimeout(() => { console.log('EXITING ' + Date.now()); process.exit(0); }, +process.argv[ex + 1]); };
host === '-' ? srv.listen(+port, cb) : srv.listen(+port, host, cb);
process.on('SIGTERM', () => process.exit(143)); process.on('SIGINT', () => process.exit(130));
