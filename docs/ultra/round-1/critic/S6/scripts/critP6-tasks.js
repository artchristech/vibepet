// S6 critic, P6: a running Claude Code background task (atlas's build, started by the atlas fleet session) in ⋯ → Localhost.
const C = require('./clib'); const fs = require('fs'), path = require('path'); const { execFileSync } = require('child_process');
const R = { flow: 'P6', startedAt: C.iso(), load: [C.load()], steps: [] };
const step = (name, data) => { const x = { name, at: C.iso(), load: C.load(), ...data }; R.steps.push(x); console.log(JSON.stringify(x).slice(0, 1500)); return x; };
(async () => {
  let v;
  try {
    const st = C.fleetStatus(); R.truthStart = C.truthLine(st);
    const atlas = st.members.find(m => m.name === 'atlas');
    v = await C.start({ fresh: true });
    await v.openHome();
    await C.waitFor(async () => (await v.cache()).at > 0, 30e3, 300);
    await C.sleep(3500);
    const t = Date.now(); await v.win.click('#homeMore'); await C.sleep(400);
    const m = await v.menuData(); const loc = m && m.find(i => /^Localhost/.test(i.label || ''));
    const tasks = (await v.cache()).tasks;
    step('menu', { localhost: loc, tasks });
    // the transcript format this Claude Code writes for a running background Bash, vs. what taskInfo matches
    const ports = require(C.INT + '/ports');
    const running = tasks.filter(x => x.running);
    const out = [];
    for (const tk of running) {
      const txt = fs.readFileSync(atlas.transcript, 'utf8');
      const lines = txt.split('\n').filter(l => l.includes(tk.id));
      out.push({ id: tk.id, linesWithId: lines.length, hasIDparen: txt.includes(`(ID: ${tk.id})`), runningPhrase: (txt.match(new RegExp(`[^"]{0,60}with ID: ${tk.id}[^"]{0,40}`)) || [])[0] || null,
        toolUseDesc: (() => { const tr = lines.find(l => /"tool_use_id"/.test(l)); const id = tr && (tr.match(/"tool_use_id":"(toolu_\w+)"/) || [])[1]; const tu = id && txt.split('\n').find(l => l.includes(`"id":"${id}"`)); return tu ? (tu.match(/"description":"((?:[^"\\]|\\.)*)"/) || [])[1] || null : null; })(),
        taskInfo: ports.taskInfo(txt, tk.id), cc: (txt.match(/"version":"([^"]+)"/) || [])[1] });
    }
    step('taskInfo-vs-transcript', { out });
    await v.snapShot('p6-home-with-running-task');
    R.truthEnd = C.truthLine(C.fleetStatus());
  } catch (e) { step('error', { e: String(e.stack || e).slice(0, 1500) }); }
  finally {
    if (v) { try { step('close', await v.close()); } catch (e) { step('close-error', { e: String(e).slice(0, 300) }); } }
    R.endedAt = C.iso(); R.load.push(C.load());
    fs.writeFileSync(path.join(C.OUT, 'raw', 'critP6-tasks.json'), JSON.stringify(R, null, 1));
  }
})();
