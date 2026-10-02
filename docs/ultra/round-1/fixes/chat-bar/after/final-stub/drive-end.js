// (g) on the final code, $0: a chat left at its end reopens at its end after a relaunch; one left mid-way, mid-way
const fs = require('fs'), os = require('os'), path = require('path');
const WT = '/Users/christopherharris/.vibepet-ultra/wt/r1-chat-bar', OUT = __dirname + '/outE';
for (const k of Object.keys(process.env)) if (/^CLAUDE(CODE$|_CODE_|_PID$|_EFFORT$)/.test(k)) delete process.env[k];
const { launch } = require(WT + '/test/ultra/launch');
const src = fs.readFileSync(WT + '/test/chat.test.js', 'utf8'), a = src.indexOf('const STUB = `') + 'const STUB = '.length, b = src.indexOf('`;\nfunction rig') + 1;
const STUB = eval(src.slice(a, b)), sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT + '/log', { recursive: true });
  const bin = OUT + '/claude'; fs.writeFileSync(bin, STUB, { mode: 0o755 });
  const ud = path.join(os.homedir(), '.vibepet-ultra/userdata/r1-chat-bar-devE'); fs.rmSync(ud, { recursive: true, force: true });
  const opts = { appDir: WT, root: path.join(os.homedir(), '.vibepet-ultra/root/.claude'), userData: ud, state: { setupDone: true, muted: true, model: 'claude-haiku-4-5', engine: 'claude', hotkey: null },
    env: { ANTHROPIC_API_KEY: '', VIBEPET_CLAUDE_BIN: bin, STUB_DIR: OUT + '/log', STUB_MODE: 'ok', STUB_REPLY: 'A reply long enough to take a few lines in the panel. '.repeat(4) } };
  const pos = W => W.evaluate(() => { const m = document.getElementById('msgs'); return { top: Math.round(m.scrollTop), max: m.scrollHeight - m.clientHeight, n: m.querySelectorAll('.msg').length }; });
  let v = await launch(opts); await v.openHome(); await sleep(500);
  for (let i = 0; i < 6; i++) { await v.win.locator('#chatInput').fill('question ' + (i + 1)); await v.win.locator('#chatInput').press('Enter'); await v.win.waitForFunction(() => !document.querySelector('#msgs .msg.pet.live'), null, { timeout: 20e3 }); }
  await sleep(800); const endA = await pos(v.win); await v.close();
  v = await launch(opts); await v.openHome(); await sleep(800); const endB = await pos(v.win);
  await v.win.evaluate(() => { const m = document.getElementById('msgs'); m.scrollTop = Math.round((m.scrollHeight - m.clientHeight) / 3); }); await sleep(900);
  const midA = await pos(v.win); await v.close();
  v = await launch(opts); await v.openHome(); await sleep(800); const midB = await pos(v.win); await v.close();
  console.log(JSON.stringify({ endA, endB, endKept: Math.abs(endB.max - endB.top) <= 2, midA, midB, midKept: midA.top === midB.top }));
})();
