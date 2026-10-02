// gate probe ($0): do a row's Replay/Goal/Diff slots stay put when Mark done / Undo change that row, at several scroll
// positions of the Now list? Fresh Home (no chat), send-to stubbed, isolated root + userData. Clicks only Mark done / Undo
// (local goal IPC) and a Goal edit; never send-to.
const path = require('path');
const fs = require('fs');
const WT = '/Users/christopherharris/.vibepet-ultra/wt/r1-row-actions';
const { launch } = require(path.join(WT, 'test/ultra/launch'));
const OUT = process.argv[2];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SEED = { setupDone: true, muted: true, alerts: 'all', model: 'claude-haiku-4-5-20251001', engine: 'claude', pos: null, name: 'Net',
  pet: 'net', size: 'm', feel: 'calm', animations: false, game: false, goals: {}, hotkey: null, onTop: true, gesture: { on: false, sens: 'med', templates: [] } };

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const ud = '/Users/christopherharris/.vibepet-ultra/userdata/gate-r1-row-actions-slots';
  try { fs.rmSync(path.join(ud, 'ledger.jsonl'), { force: true }); } catch {}
  const v = await launch({ appDir: WT, root: '/Users/christopherharris/.vibepet-ultra/root/.claude', userData: ud, state: SEED, env: { ANTHROPIC_API_KEY: '' } });
  const R = { runs: [] };
  try {
    await v.evalMain(({ ipcMain }) => {   // send-to: record only
      ipcMain.removeHandler('send-to');
      ipcMain.handle('send-to', () => ({ ok: false, why: 'gate probe: send-to stubbed' }));
    });
    R.open = await v.openHome();
    const W = v.win;
    const id = await W.evaluate(() => (snap.agents.find(a => a.name === 'delta') || {}).id);
    if (!id) throw new Error('no delta row');
    const sel = `#now .nr[data-id="${id}"]`;
    await W.waitForSelector(`${sel} .nx [data-do=done]`, { timeout: 15e3 });
    const m = () => W.evaluate(id => {
      const n = document.getElementById('now'), c = document.getElementById('chat').getBoundingClientRect(), r = x => Math.round(x * 10) / 10;
      const row = document.querySelector(`#now .nr[data-id="${id}"]`), b = k => row?.querySelector(`.ns [data-do=${k}]`)?.getBoundingClientRect();
      return { scrollTop: n.scrollTop, maxScroll: n.scrollHeight - n.clientHeight, nowH: n.clientHeight, fresh: document.getElementById('chat').classList.contains('fresh'),
        bubble: !document.getElementById('bubble').classList.contains('hidden'),
        rowH: row ? r(row.getBoundingClientRect().height) : null,
        slots: ['replay', 'goal', 'diff'].map(k => { const x = b(k); return x ? [r(x.x), r(x.y), r(x.y - c.y)] : null; }) };
    }, id);
    const scrollTo = how => W.evaluate(([id, how]) => {
      const n = document.getElementById('now'), row = document.querySelector(`#now .nr[data-id="${id}"]`);
      if (how === 'top') n.scrollTop = 0;
      else if (how === 'max') n.scrollTop = n.scrollHeight;
      else if (how === 'rowAtBottom') { const rb = row.getBoundingClientRect(), nb = n.getBoundingClientRect(); n.scrollTop += rb.bottom - nb.bottom; }
      else if (how === 'rowAtTop') { const rb = row.getBoundingClientRect(), nb = n.getBoundingClientRect(); n.scrollTop += rb.top - nb.top; }
      return n.scrollTop;
    }, [id, how]);
    const clickDone = async () => {
      // dispatch through the real handler without Playwright's auto-scroll: a trusted click at the button's centre
      const b = await W.locator(`${sel} .nx [data-do=done]`).boundingBox();
      await W.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
      return W.waitForFunction(id => !!document.querySelector(`#now .nr[data-id="${id}"] .ng.done`), id, { timeout: 8000 }).then(() => true).catch(() => false);
    };
    const clickUndo = async () => {
      const b = await W.locator(`${sel} .nnote [data-do=undo]`).boundingBox().catch(() => null);
      if (!b) return 'no undo button';
      await W.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
      return W.waitForFunction(id => { const r = document.querySelector(`#now .nr[data-id="${id}"]`); return !!r && !r.querySelector('.ng.done') && !!r.querySelector('.nx [data-do=done]'); }, id, { timeout: 8000 }).then(() => true).catch(() => false);
    };
    for (const how of ['top', 'rowAtTop', 'max', 'rowAtBottom', 'max', 'rowAtBottom']) {
      await W.waitForFunction(() => document.getElementById('bubble').classList.contains('hidden'), null, { timeout: 12e3 }).catch(() => {});
      await scrollTo(how); await sleep(400);
      const before = await m();
      const done = await clickDone(); await sleep(350);
      const after = await m();
      await v.shot(path.join(OUT, `done-${R.runs.length}-${how}.png`)).catch(() => {});
      await sleep(5200);   // the 5 s note (with Undo) runs out: the row's height changes again
      const later = await m();
      const undone = await W.evaluate(id => window.pet.goalUndo(id), id).catch(e => ({ error: e.message }));   // Undo by IPC (the row's 5 s button is gone)
      await sleep(1500);
      const moved = (a, b) => JSON.stringify(a.slots.map(s => s && s[1])) !== JSON.stringify(b.slots.map(s => s && s[1]));
      R.runs.push({ how, done, undone, movedOnDone: moved(before, after), movedWhenNoteEnds: moved(after, later), before, after, later });
      console.log(how, 'done', done, '| moved on Mark done:', moved(before, after), (after.slots[0] || [])[1] - (before.slots[0] || [])[1], '| moved when note ends:', moved(after, later), (later.slots[0] || [])[1] - (after.slots[0] || [])[1], '| scroll', before.scrollTop, '→', after.scrollTop, '→', later.scrollTop, 'max', before.maxScroll, '→', after.maxScroll, '→', later.maxScroll, 'fresh', before.fresh, 'bubble', before.bubble, after.bubble);
    }
  } catch (e) { R.error = e.message; console.log('error', e.message); }
  finally { R.close = await v.close().catch(e => ({ error: e.message })); fs.writeFileSync(path.join(OUT, 'slots-probe.json'), JSON.stringify(R, null, 1)); console.log('close', JSON.stringify(R.close)); }
})();
