const http = require('http');
const port = Number(process.env.PORT) || 8080;
http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"ok":true}'); }
  res.writeHead(404); res.end();
}).listen(port, () => console.log(`kestrel on :${port}`));
