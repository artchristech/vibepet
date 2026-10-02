// dev scenarios with the scenario stub from test/chat.test.js: queue, Esc stop, markdown, scroll pill, composer keys,
// history (⌘N, list, search, open, clear), then a relaunch on the same userData. $0, isolated fleet root.
const fs = require('fs'), os = require('os'), path = require('path');
const WT = '/Users/christopherharris/.vibepet-ultra/wt/r1-chat-bar', OUT = __dirname + '/out2';
for (const k of Object.keys(process.env)) if (/^CLAUDE(CODE$|_CODE_|_PID$|_EFFORT$)/.test(k)) delete process.env[k];
const { launch } = require(WT + '/test/ultra/launch');
const src = fs.readFileSync(WT + '/test/chat.test.js', 'utf8'), a = src.indexOf('const STUB = `') + 'const STUB = '.length, b = src.indexOf('`;\nfunction rig') + 1;
const STUB = eval(src.slice(a, b));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const REPLY = 'Here is what I see:\n- [kestrel](https://vibepet.net) waits on approval\n- **beacon** asks which database\n- delta is done\n\nTo check the deploy:\n```bash\n./deploy.sh --dry-run\n```\nThat runs nothing for real, so it is safe to approve. ' + 'More words to stream for a while. '.repeat(12);
(async () => {
  fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT + '/stublog', { recursive: true });
  const bin = OUT + '/claude'; fs.writeFileSync(bin, STUB, { mode: 0o755 });
  const ud = path.join(os.homedir(), '.vibepet-ultra/userdata/r1-chat-bar-dev2');
  fs.rmSync(ud, { recursive: true, force: true });
  const env = { ANTHROPIC_API_KEY: '', VIBEPET_CLAUDE_BIN: bin, STUB_DIR: OUT + '/stublog', STUB_MODE: 'slow', STUB_REPLY: REPLY };
  const state = { setupDone: true, muted: true, model: 'claude-haiku-4-5', engine: 'claude', animations: false, game: false, hotkey: null };
  let v = await launch({ appDir: WT, root: path.join(os.homedir(), '.vibepet-ultra/root/.claude'), userData: ud, state, env });
  let W = v.win; const errs = [], R = {};
  const watch = w => { w.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); }); w.on('pageerror', e => errs.push('PAGEERROR ' + e.message)); };
  watch(W);
  await v.evalMain(({ clipboard, shell }) => { globalThis.__clip = []; clipboard.writeText = t => globalThis.__clip.push(String(t)); shell.openExternal = async u => (globalThis.__open ||= []).push(String(u)); });
  try {
    await v.openHome(); await sleep(600);
    // A: send, queue a second during the stream, Esc stops the first; the second then runs
    await W.locator('#chatInput').fill('first question');
    await W.locator('#chatInput').press('Enter');
    await W.waitForFunction(() => (document.querySelector('#msgs .msg.pet.live .md')?.textContent || '').length > 20, null, { timeout: 15000 });
    await W.locator('#chatInput').fill('second question');
    await W.locator('#chatInput').press('Enter');
    R.queued = await W.evaluate(() => [...document.querySelectorAll('#msgs .msg.user')].map(e => e.className + ' | ' + e.textContent));
    await v.shot(OUT + '/a1-queued.png');
    const t0 = await W.evaluate(() => performance.now());
    await W.keyboard.press('Escape');
    R.stop = await W.evaluate(t0 => { const m = document.querySelector('#msgs .msg.pet.stopped'); return { ms: performance.now() - t0, stopped: !!m, tag: m?.querySelector('.tag')?.textContent, open: !document.getElementById('chat').classList.contains('hidden') }; }, t0);
    await v.shot(OUT + '/a2-stopped.png');
    await W.waitForFunction(() => { const p = [...document.querySelectorAll('#msgs .msg.pet')]; return p.length >= 2 && !p.at(-1).classList.contains('live'); }, null, { timeout: 30000 });
    R.after = await W.evaluate(() => [...document.querySelectorAll('#msgs .msg')].map(e => e.className.replace('msg ', '') + ' | ' + (e.querySelector('.md')?.textContent || e.textContent).slice(0, 50)));
    // B: markdown of the full reply
    R.md = await W.evaluate(() => { const m = [...document.querySelectorAll('#msgs .msg.pet')].at(-1); return { ul: !!m.querySelector('.md ul'), a: m.querySelector('.md a')?.dataset.href, lang: m.querySelector('pre .lang')?.textContent, copy: !!m.querySelector('pre .copy') }; });
    await v.shot(OUT + '/b-markdown.png');
    // C: scrolled up 200 px, a reply arrives: the view stays, '↓ new' shows
    await W.evaluate(() => { const m = document.getElementById('msgs'); m.scrollTop = m.scrollHeight; });
    await sleep(200);
    await W.locator('#chatInput').fill('third question');
    await W.locator('#chatInput').press('Enter');
    await W.waitForFunction(() => (document.querySelector('#msgs .msg.pet.live .md')?.textContent || '').length > 5, null, { timeout: 15000 });
    const before = await W.evaluate(() => { const m = document.getElementById('msgs'); m.scrollTop = m.scrollHeight - m.clientHeight - 200; return m.scrollTop; });
    await sleep(150);
    await W.waitForFunction(() => !document.querySelector('#msgs .msg.pet.live'), null, { timeout: 30000 });
    R.scroll = await W.evaluate(b => { const m = document.getElementById('msgs'); return { before: b, after: m.scrollTop, pill: !document.getElementById('newPill').classList.contains('hidden') }; }, before);
    await v.shot(OUT + '/c-pill.png');
    // D: composer keys
    await W.locator('#chatInput').fill('');
    await W.locator('#chatInput').type('line one');
    await W.keyboard.press('Shift+Enter');
    await W.locator('#chatInput').type('line two');
    R.shiftEnter = await W.evaluate(() => ({ value: document.getElementById('chatInput').value, h: document.getElementById('chatInput').offsetHeight, users: document.querySelectorAll('#msgs .msg.user').length }));
    await v.shot(OUT + '/d1-shift-enter.png');
    await W.locator('#chatInput').fill('');
    await W.locator('#chatInput').press('ArrowUp');
    R.up = await W.evaluate(() => document.getElementById('chatInput').value);
    await W.locator('#chatInput').fill('');
    await W.keyboard.press('Meta+Shift+C');
    R.clip = await v.evalMain(() => globalThis.__clip.slice());
    await W.keyboard.press('Meta+k');
    R.cmdK = await W.evaluate(() => ({ value: document.getElementById('chatInput').value, slash: !document.getElementById('slash').classList.contains('hidden') }));
    await W.locator('#chatInput').fill(''); await W.locator('#chatInput').dispatchEvent('input');   // (the menu's own Esc is the command bar's)
    // link click → the browser (recorded), never this window
    await W.locator('#msgs .msg.pet .md a').first().click();
    R.link = await v.evalMain(() => globalThis.__open || []);
    // E: ⌘N, history list, search, open, clear
    await W.keyboard.press('Meta+n');
    R.newChat = await W.evaluate(() => ({ msgs: document.querySelectorAll('#msgs .msg').length, fresh: document.getElementById('chat').classList.contains('fresh') }));
    await W.locator('#chatInput').fill('a question in chat two');
    await W.locator('#chatInput').press('Enter');
    await W.waitForFunction(() => !document.querySelector('#msgs .msg.pet.live') && document.querySelectorAll('#msgs .msg.pet').length >= 1, null, { timeout: 30000 });
    await W.locator('#chatHistBtn').click(); await sleep(300);
    R.hist = await W.evaluate(() => ({ items: [...document.querySelectorAll('#histList button')].map(b => b.textContent), keep: document.getElementById('histKeep').textContent }));
    await v.shot(OUT + '/e1-history.png');
    await W.locator('#histQ').fill('third'); await sleep(300);
    R.search = await W.evaluate(() => [...document.querySelectorAll('#histList button b')].map(b => b.textContent));
    await v.shot(OUT + '/e2-search.png');
    await W.locator('#histList button').first().click(); await sleep(400);
    R.reopened = await W.evaluate(() => [...document.querySelectorAll('#msgs .msg.user')].map(e => e.textContent.slice(0, 30)));
    // scroll to the middle of chat one and close: restored after relaunch
    R.scrollSaved = await W.evaluate(() => { const m = document.getElementById('msgs'); m.scrollTop = Math.round((m.scrollHeight - m.clientHeight) / 2); return m.scrollTop; });
    await sleep(900);
    await v.shot(OUT + '/e3-reopened.png');
    const c1 = await v.close(); R.close1 = c1;
    // F: relaunch on the same userData
    v = await launch({ appDir: WT, root: path.join(os.homedir(), '.vibepet-ultra/root/.claude'), userData: ud, state, env });
    W = v.win; watch(W);
    await v.openHome(); await sleep(800);
    R.relaunch = await W.evaluate(() => { const m = document.getElementById('msgs'); return { msgs: [...m.querySelectorAll('.msg')].map(e => e.className.replace('msg ', '').trim()), code: m.querySelectorAll('pre code').length, labels: [...m.querySelectorAll('.msg.user')].map(e => e.textContent.slice(0, 20)), scrollTop: m.scrollTop }; });
    await v.shot(OUT + '/f-relaunch.png');
    // clear
    await W.locator('#chatHistBtn').click(); await sleep(200);
    await W.locator('#histClear').click(); await W.locator('#histClear').click(); await sleep(400);
    R.cleared = await W.evaluate(() => ({ items: document.querySelectorAll('#histList button').length, msgs: document.querySelectorAll('#msgs .msg').length, none: document.querySelector('#histList .none')?.textContent }));
    await v.shot(OUT + '/f2-cleared.png');
  } catch (e) { console.error('ERR', e.message); await v.shot(OUT + '/zz-error.png').catch(() => {}); }
  finally {
    console.log(JSON.stringify(R, null, 1));
    console.log('errors:', errs.slice(0, 10));
    console.log('close', JSON.stringify(await v.close()));
  }
})().catch(e => { console.error('FAIL', e); process.exit(1); });
