// why does Home close / refuse to open? sample window + document state for 120 s
const C = require('./clib');
(async () => {
  const v = await C.start({ fresh: true });
  await v.win.evaluate(() => { window.__ev = []; window.addEventListener('blur', () => window.__ev.push(['blur', Date.now()])); window.addEventListener('focus', () => window.__ev.push(['focus', Date.now()]));
    document.addEventListener('visibilitychange', () => window.__ev.push(['vis', document.visibilityState, Date.now()])); });
  await v.evalMain(() => { const w = globalThis.__vibepet.win(); globalThis.__wev = []; for (const e of ['blur', 'focus', 'hide', 'show', 'move', 'minimize']) w.on(e, () => globalThis.__wev.push([e, Date.now()])); });
  const h = await v.openHome(); console.log('open', h.mode, C.iso());
  for (let i = 0; i < 60; i++) {
    await C.sleep(2000);
    const m = await v.homeMode();
    const w = await v.evalMain(() => { const w = globalThis.__vibepet.win(); return { vis: w.isVisible(), focused: w.isFocused(), b: w.getBounds(), ev: globalThis.__wev.splice(0) }; });
    const d = await v.win.evaluate(() => ({ hasFocus: document.hasFocus(), chatHidden: document.getElementById('chat').classList.contains('hidden'), ev: window.__ev.splice(0) }));
    if (!m || w.ev.length || d.ev.length || i % 10 === 0) console.log(C.iso(), JSON.stringify({ mode: m, w, d }));
    if (!m) { try { const r = await v.openHome({ timeout: 3000 }); console.log('reopen ok', r.mode); } catch (e) { console.log('reopen FAIL', e.message.split('\n')[0]); } }
  }
  await v.close();
})();
