// dark mode look of the new chat pieces (stub engine, $0): a reply with markdown + What Net sees, a 429 card, history
const fs = require('fs'), os = require('os'), path = require('path');
const WT = '/Users/christopherharris/.vibepet-ultra/wt/r1-chat-bar', OUT = __dirname + '/outD';
for (const k of Object.keys(process.env)) if (/^CLAUDE(CODE$|_CODE_|_PID$|_EFFORT$)/.test(k)) delete process.env[k];
const { launch } = require(WT + '/test/ultra/launch');
const src = fs.readFileSync(WT + '/test/chat.test.js', 'utf8'), a = src.indexOf('const STUB = `') + 'const STUB = '.length, b = src.indexOf('`;\nfunction rig') + 1;
const STUB = eval(src.slice(a, b)), sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT + '/log', { recursive: true });
  const bin = OUT + '/claude'; fs.writeFileSync(bin, STUB, { mode: 0o755 });
  const ud = path.join(os.homedir(), '.vibepet-ultra/userdata/r1-chat-bar-devD'); fs.rmSync(ud, { recursive: true, force: true });
  const v = await launch({ appDir: WT, root: path.join(os.homedir(), '.vibepet-ultra/root/.claude'), userData: ud, state: { setupDone: true, muted: true, model: 'claude-haiku-4-5', engine: 'claude', hotkey: null },
    env: { ANTHROPIC_API_KEY: '', VIBEPET_CLAUDE_BIN: bin, STUB_DIR: OUT + '/log', STUB_MODE: 'ok,rate', STUB_REPLY: 'Two sessions need you:\n- [kestrel](https://vibepet.net) waits on approval\n- **beacon** asks which database\n\n```bash\n./deploy.sh --dry-run\n```' } });
  await v.win.emulateMedia({ colorScheme: 'dark' });
  await v.openHome(); await sleep(500);
  await v.win.locator('#chatInput').fill('who needs me?'); await v.win.locator('#chatInput').press('Enter');
  await v.win.waitForFunction(() => !document.querySelector('#msgs .msg.pet.live'), null, { timeout: 20e3 });
  await v.win.evaluate(() => { const d = document.querySelector('#msgs .msg.pet .sees'); d.open = true; });
  await sleep(300); await v.shot(OUT + '/dark-reply.png');
  await v.evalMain(() => globalThis.__vibepet.require('./chat-engine'));   // no-op: keep the warm process
  await v.win.evaluate(() => window.vpChat.newChat()); await sleep(300);
  // a rate-limit card: the stub's second spawn answers 429 (a fresh process for the new chat)
  await v.win.locator('#chatInput').fill('and now?'); await v.win.locator('#chatInput').press('Enter');
  await v.win.waitForFunction(() => /Rate limited/.test(document.querySelector('#msgs .msg.pet .st .say')?.textContent || ''), null, { timeout: 20e3 }).catch(() => {});
  await sleep(300); await v.shot(OUT + '/dark-rate.png');
  await v.win.keyboard.press('Escape'); await sleep(300);
  await v.win.locator('#chatHistBtn').click(); await sleep(400); await v.shot(OUT + '/dark-history.png');
  console.log(JSON.stringify(await v.close()));
})();
