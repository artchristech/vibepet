// node tcp.js PORT: listens, never speaks HTTP (holds the socket silently)
require('net').createServer(s => { s.on('error', () => {}); }).listen(+process.argv[2], () => console.log('LISTENING ' + Date.now()));
process.on('SIGTERM', () => process.exit(143));
