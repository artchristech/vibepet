#!/usr/bin/env node
'use strict';
// timings: turn probe.js recordings into per-trial latencies (markdown table rows).
//   node test/fleet/timings.js <probe-*.jsonl ...>
// All times are wall-clock ms. Sources and their resolution:
//   gen      = transcript record `timestamp` of the tool_use block (Claude Code's clock: block received)
//   reg      = registry statusUpdatedAt of the waiting/busy/idle flip (Claude Code's clock)
//   write    = when probe.js saw the record appended to the .jsonl (25 ms poll)
//   pane     = when probe.js first saw the dialog in `tmux capture-pane` (50 ms poll)
//   child    = when probe.js first saw a tool process under claude (250 ms poll)
// Second table ("pending record"): every registry flip to `waiting` seen by any probe, paired with
// the tool_use record that caused it, wherever (in whichever later probe) that record was finally
// written. Probes tail files from their end, so a record written while no probe ran is "unseen".
const fs = require('fs');
const path = require('path');

const files = process.argv.slice(2);
if (!files.length) { console.error('usage: timings.js <probe jsonl...>'); process.exit(2); }
const load = (f) => fs.readFileSync(f, 'utf8').trim().split('\n').map(l => JSON.parse(l));
const labelOf = (f) => path.basename(f).replace(/^probe-/, '').replace(/-\d{4}-\d\d-\d\dT.*$/, '');
const rows = [];
for (const f of files) {
  const evs = load(f);
  const label = labelOf(f);
  const at = (pred) => { const e = evs.find(pred); return e ? e.at : null; };
  const send = at(e => e.ev === 'send-enter') || at(e => e.ev === 'keys-sent');
  const busy = evs.find(e => e.ev === 'reg' && e.status === 'busy');
  const waiting = evs.find(e => e.ev === 'reg' && e.status === 'waiting' && e.statusUpdatedAt >= evs[0].at);
  const idle = [...evs].reverse().find(e => e.ev === 'reg' && e.status === 'idle' && busy && e.at > busy.at);
  const tool = evs.find(e => e.ev === 'rec' && e.src === 'main' && e.tools && e.tools.length);
  const endTurn = evs.find(e => e.ev === 'rec' && e.src === 'main' && e.stop_reason === 'end_turn' && e.blocks && e.blocks.includes('text'));
  const userRec = evs.find(e => e.ev === 'rec' && e.src === 'main' && e.type === 'user' && e.blocks && e.blocks.includes('text'));
  const paneDlg = at(e => e.ev === 'pane-first' && (e.cls === 'approval' || e.cls === 'question') && e.t > 100);
  const paneRun = at(e => e.ev === 'pane-first' && e.cls === 'running');
  const child = at(e => e.ev === 'procs' && e.procs.some(p => /shell-snapshots|^sh:|build\.sh|slow\.sh|tick\.sh/.test(p)));
  const sub = at(e => e.ev === 'rec' && String(e.src).startsWith('sub:'));
  const d = (a, b) => (a != null && b != null ? a - b : null);
  rows.push({
    label,
    tool: tool ? tool.tools.join('+') : (endTurn ? 'end_turn' : '-'),
    'send→reg busy': d(busy && busy.statusUpdatedAt, send),
    'send→user rec written': d(userRec && userRec.at, send),
    'tool_use gen→reg waiting': d(waiting && waiting.statusUpdatedAt, tool && tool.recTs),
    'reg waiting→pane dialog': d(paneDlg, waiting && waiting.statusUpdatedAt),
    'reg waiting→tool_use written': d(tool && tool.at, waiting && waiting.statusUpdatedAt),
    'tool_use gen→written': d(tool && tool.at, tool && tool.recTs),
    'tool_use written→child': d(child, tool && tool.at),
    'send→pane spinner': d(paneRun, send),
    'first subagent rec': d(sub, send),
    'end_turn gen→reg idle': d(idle && idle.statusUpdatedAt, endTurn && endTurn.recTs),
    'reg idle→end_turn written': d(endTurn && endTurn.at, idle && idle.statusUpdatedAt),
  });
}
const table = (rs) => {
  const cols = Object.keys(rs[0]);
  console.log('| ' + cols.join(' | ') + ' |');
  console.log('|' + cols.map(() => '---').join('|') + '|');
  for (const r of rs) console.log('| ' + cols.map(c => (r[c] == null ? '' : r[c])).join(' | ') + ' |');
};
table(rows);

// ---------------------------------------------------------------- pending-record pairing
const byMember = new Map();
for (const f of files) {
  const evs = load(f);
  const m = evs[0].member;
  if (!byMember.has(m)) byMember.set(m, []);
  byMember.get(m).push({ label: labelOf(f), t0: evs[0].at, evs });
}
const pend = [];
for (const [member, probes] of byMember) {
  probes.sort((a, b) => a.t0 - b.t0);
  const recs = [];
  for (const p of probes) for (const e of p.evs) if (e.ev === 'rec' && e.src === 'main' && e.tools && e.recTs) recs.push(Object.assign({ probe: p.label }, e));
  for (const p of probes) {
    const flip = p.evs.find(e => e.ev === 'reg' && e.status === 'waiting' && e.statusUpdatedAt >= p.t0);
    if (!flip) continue;
    const flipAt = flip.statusUpdatedAt;
    const dlg = p.evs.find(e => e.ev === 'pane-first' && (e.cls === 'approval' || e.cls === 'question') && e.at >= flipAt - 2000);
    const rec = recs.find(r => r.recTs <= flipAt + 500 && r.recTs >= flipAt - 15000);
    const sameProbe = rec && rec.probe === p.label;
    const end = p.evs[p.evs.length - 1].at;
    pend.push({
      trial: p.label, waitingFor: flip.waitingFor || '(not logged)',
      'tool_use gen→reg waiting': rec ? flipAt - rec.recTs : null,
      'reg waiting→pane dialog': dlg ? dlg.at - flipAt : null,
      'pane dialog→tool_use written': rec && dlg ? rec.at - dlg.at : null,
      'record written while dialog up': rec ? (sameProbe ? 'yes' : `NO - written ${Math.round((rec.at - flipAt) / 1000)} s after the flip, during ${rec.probe}`) : `NO - not written within the ${Math.round((end - flipAt) / 1000)} s probe window, never seen later`,
    });
  }
}
if (pend.length) { console.log(''); table(pend); }
