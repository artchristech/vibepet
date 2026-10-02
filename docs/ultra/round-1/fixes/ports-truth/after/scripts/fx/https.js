// node https.js PORT KEY CERT "Title": a local HTTPS dev server on 127.0.0.1
const https = require('https'), fs = require('fs'); const [port, key, cert, title] = process.argv.slice(2);
https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, (q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(`<title>${title}</title>ok`); })
  .listen(+port, '127.0.0.1', () => console.log('LISTENING ' + Date.now()));
process.on('SIGTERM', () => process.exit(143));
