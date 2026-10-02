// theater-data timing: Theater… → session → first frame, and main's timeline build, for one build. Run it ABAB against
// the base and the fix so load hits both alike: node timing.js <appDir> <out.json> [--runs N] [--label L]
// Same path as recapture.js (canon's instrument; the menu item clicked in main; a first-frame stamp injected in each
// Theater page), no screenshots. $0: nothing is typed anywhere, no fleet member takes a turn.
'use strict';
const path = require('path'), os = require('os'), fs = require('fs'), { execSync } = require('child_process');
const args = process.argv.slice(2), opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const [APP, OUT] = args.filter((a, i) => !a.startsWith('--') && !['--runs', '--label'].includes(args[i - 1]));
const RUNS = +(opt('--runs') || 5) || 5, LABEL = opt('--label') || path.basename(APP);
const ULTRA = path.join(os.homedir(), '.vibepet-ultra'), ROOT = path.join(ULTRA, 'root', '.claude'), userData = path.join(ULTRA, 'userdata', 'r1-theater-data-timing');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const load = () => execSync('uptime').toString().trim().replace(/^.*load averages?: /, '');
const { launch } = require(path.join(APP, 'test', 'ultra', 'launch.js'));
const { instrument, SEED } = require(path.join(APP, 'test', 'ultra', 'canon.js'));
const R = { label: LABEL, app: APP, at: new Date().toISOString(), runs: RUNS, loadStart: load(), opens: {} };

function hookTimeline({ ipcMain }) {
  const H = ipcMain._invokeHandlers, h = H && H.get('theater-timeline'), C = globalThis.__canon;
  if (typeof h !== 'function' || C.tlHooked) return;
  ipcMain.removeHandler('theater-timeline');
  ipcMain.handle('theater-timeline', async (e, ...a) => {
    const t = Date.now(); let out, err; const e2 = Object.create(e); e2._reply = v => { out = v; }; e2._throw = x => { err = x; };
    let ret; try { ret = await h(e2, ...a); } catch (x) { err = x; }
    if (out === undefined) out = ret;
    C.calls.push({ kind: 'ipc:theater-timeline', at: t, ms: Date.now() - t, beats: out?.beats?.length });
    if (err) throw err; return out;
  });
  C.tlHooked = true;
}
const items = () => { const C = globalThis.__canon, m = C.menus[C.menus.length - 1], th = m?.items.find(i => /^Theater/.test(i.label || '')); return th?.submenu ? th.submenu.items.map(i => i.toolTip) : []; };
function clickTheater(_e, file) {
  const C = globalThis.__canon, m = C.menus[C.menus.length - 1], th = m?.items.find(i => /^Theater/.test(i.label || '')), it = th?.submenu?.items.find(i => i.toolTip === file);
  if (!it) return null; const at = Date.now(); it.click(); return at;
}
function firstFrame() {
  if (!/theater\/player\.html$/.test(location.href)) return;
  const mo = new MutationObserver(() => { if (!window.__ff && document.querySelector('#beats .b')) { mo.disconnect(); requestAnimationFrame(() => { window.__ff = performance.timeOrigin + performance.now(); }); } });
  document.addEventListener('DOMContentLoaded', () => mo.observe(document.body, { subtree: true, childList: true }));
}
const med = a => { const s = a.filter(x => x != null).sort((x, y) => x - y); return s.length ? s[(s.length - 1) >> 1] : null; };

(async () => {
  fs.rmSync(userData, { recursive: true, force: true });
  for (const k of Object.keys(process.env)) if (/^CLAUDE(CODE$|_CODE_|_PID$|_EFFORT$)/.test(k)) delete process.env[k];
  const v = await launch({ appDir: APP, root: ROOT, userData, state: SEED, env: { ANTHROPIC_API_KEY: '' } });
  try {
    await v.evalMain(instrument); await v.evalMain(hookTimeline); await v.app.context().addInitScript(firstFrame);
    await v.evalMain(() => globalThis.__vibepet.win().webContents.send('event', { kind: 'openChat' }));
    for (let i = 0; i < 100 && !(await v.homeMode()); i++) await sleep(50);
    await sleep(2500);
    const pop = async () => { const n0 = await v.evalMain(() => globalThis.__canon.menus.length); await v.win.locator('#homeMore').click(); for (let i = 0; i < 60 && (await v.evalMain(() => globalThis.__canon.menus.length)) <= n0; i++) await sleep(50); };
    await pop();
    const files = await v.evalMain(items), want = ['kestrel', 'beacon', 'vibepet', 'ember', 'delta'];
    for (let run = 0; run < RUNS; run++) for (const name of want) {
      const file = files.find(f => f && f.includes('-vibepet-ultra-fleet-' + name + path.sep)); if (!file) continue;
      await pop();
      const opened = v.app.waitForEvent('window', { timeout: 15e3, predicate: p => /theater\/player\.html$/.test(p.url()) });
      const at = await v.evalMain(clickTheater, file), th = await opened.catch(() => null);
      if (!th) continue;
      await th.waitForFunction(() => window.__ff, null, { timeout: 15e3 }).catch(() => {});
      const ff = await th.evaluate(() => window.__ff || null), call = (await v.evalMain(() => globalThis.__canon.calls.filter(x => x.kind === 'ipc:theater-timeline'))).filter(x => x.at >= at).pop();
      (R.opens[name] ||= []).push({ firstFrameMs: ff ? Math.round(ff - at) : null, mainBuildMs: call?.ms ?? null, beats: call?.beats ?? null, load: load() });
      await th.close().catch(() => {}); await sleep(250);
    }
    R.median = Object.fromEntries(Object.entries(R.opens).map(([n, a]) => [n, { firstFrameMs: med(a.map(o => o.firstFrameMs)), mainBuildMs: med(a.map(o => o.mainBuildMs)), n: a.length, beats: a[0]?.beats }]));
  } finally { R.close = await v.close().catch(e => ({ error: e.message })); R.loadEnd = load(); fs.writeFileSync(OUT, JSON.stringify(R, null, 2)); console.log(LABEL, JSON.stringify(R.median), R.loadStart, '->', R.loadEnd); }
})().catch(e => { console.error(e); process.exit(1); });
