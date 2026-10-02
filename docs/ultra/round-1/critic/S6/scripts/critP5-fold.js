// S6 critic, P5 (r1-S6-06): is the localhost section in view? Live fleet rows (whatever they are now) + 8 long-titled servers,
// panel fresh and after one non-note message (Rename, a pure-UI path).
const C = require('./clib'); const fs = require('fs'), path = require('path');
const R = { flow: 'P5', startedAt: C.iso(), load: [C.load()], steps: [] };
const step = (name, data) => { const x = { name, at: C.iso(), load: C.load(), ...data }; R.steps.push(x); console.log(JSON.stringify(x).slice(0, 900)); return x; };
const geo = v => v.win.evaluate(() => { const n = document.querySelector('#now'), s = n.querySelector('.srvs'); const nr = n.getBoundingClientRect();
  const chips = [...n.querySelectorAll('.srv')].map(e => { const r = e.getBoundingClientRect(); return { port: +e.dataset.port, visible: r.top >= nr.top && r.bottom <= nr.bottom + 0.5 }; });
  return { fresh: document.getElementById('chat').classList.contains('fresh'), chatH: Math.round(document.getElementById('chat').getBoundingClientRect().height), nowH: n.clientHeight, nowScrollH: n.scrollHeight, scrollTop: n.scrollTop,
    rows: n.querySelectorAll('.nr').length, chipsVisible: chips.filter(c => c.visible).length, chipsHidden: chips.filter(c => !c.visible).map(c => c.port), hint: /more|below|scroll/i.test(n.innerText) }; });
(async () => {
  let v;
  try {
    R.truthStart = C.truthLine(C.fleetStatus());
    v = await C.start({ fresh: true });
    await v.openHome();
    const titles = ['Acme storefront admin dashboard (dev)', 'Payments service local preview', 'Docs site — Docusaurus dev server', 'Storybook for the design system',
      'Marketing landing page preview', 'GraphQL playground for the API', 'Customer portal — Next.js dev', 'Analytics notebook (Jupyter)'];
    for (let i = 0; i < 8; i++) { const s = C.serve('node', [C.OUT + '/scripts/fx/titled.js', String(47461 + i), titles[i]], { cwd: C.FLEET + (i % 2 ? '/atlas' : '/delta'), tag: 'long' + i }); await C.waitListen(s, 47461 + i); }
    await C.waitFor(async () => (await v.chips()).length >= 8, 30e3, 200); await C.sleep(3300);
    step('fresh', { rows: await v.rows(), geo: await geo(v) });
    await v.snapShot('p5-01-fold-fresh');
    // one non-note message: ⋯ → Rename Net… → "Nettie"
    await v.win.click('#homeMore'); await C.sleep(300);
    const r = await v.clickMenu(['^Settings', '^Rename']); await C.sleep(400);
    if (r.ok) { await v.win.fill('#renameInput', 'Nettie'); await v.win.press('#renameInput', 'Enter'); }
    await C.sleep(3500);
    step('after-message', { rename: r, rows: await v.rows(), geo: await geo(v) });
    await v.snapShot('p5-02-fold-after-message');
    R.truthEnd = C.truthLine(C.fleetStatus());
  } catch (e) { step('error', { e: String(e.stack || e).slice(0, 1500) }); }
  finally {
    await C.stopAll();
    if (v) { try { step('close', await v.close()); } catch (e) { step('close-error', { e: String(e).slice(0, 300) }); } }
    R.endedAt = C.iso(); R.load.push(C.load());
    fs.writeFileSync(path.join(C.OUT, 'raw', 'critP5-fold.json'), JSON.stringify(R, null, 1));
  }
})();
