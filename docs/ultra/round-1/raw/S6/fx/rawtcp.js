// a TCP listener that never speaks HTTP (a db / ws-only / custom protocol shape): node rawtcp.js <port> [lifeMs]
const net = require('net');
const port = +process.argv[2], life = +(process.argv[3] || 900e3);
const s = net.createServer(c => { c.on('error', () => {}); /* accept and say nothing */ });
s.listen(port, '127.0.0.1', () => console.log(JSON.stringify({ listenAt: Date.now(), pid: process.pid, port })));
setTimeout(() => process.exit(0), life);
