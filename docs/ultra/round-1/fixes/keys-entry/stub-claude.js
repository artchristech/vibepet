#!/usr/bin/env node
// keys-entry recapture's chat engine (VIBEPET_CLAUDE_BIN): no model, no network, $0. Only commands are typed in this
// recapture; this is the backstop in case text ever reached the chat.
let n = 0; process.stdin.on('data', d => { n += d.length; }); process.stdin.on('end', () => process.stdout.write(`stub reply (${n} bytes in)\n`));
