// loop-rows recapture: ember's Home row vs the truth, from watch.js's timeline + the fleet transcript's fire records
// (structure only: record types, timestamps). Usage: node analyze.js <watch dir> <transcript> <member> > analysis.json
const fs = require('fs');
const [dir, transcript, member = 'ember'] = process.argv.slice(2);
const L = fs.readFileSync(dir + '/timeline.jsonl', 'utf8').trim().split('\n').map(l => JSON.parse(l));
const t0 = Date.parse(L[0].at);
const recs = fs.readFileSync(transcript, 'utf8').trim().split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const iso = ms => new Date(ms).toISOString(), at = s => Date.parse(s.at);
// fires in the window: scheduled_task_fire timestamps (the scheduler's clock), the turn's end (turn_duration after it)
const fires = recs.filter(r => r.type === 'system' && r.subtype === 'scheduled_task_fire' && Date.parse(r.timestamp) >= t0).map(r => Date.parse(r.timestamp));
const ends = fires.map(f => { const r = recs.find(x => x.type === 'system' && x.subtype === 'turn_duration' && Date.parse(x.timestamp) > f); return r ? Date.parse(r.timestamp) : null; });
const row = s => s.ui.find(u => u.name === member) || null, reg = s => s.truth.find(t => t.member === member) || null;
const firedS = lab => { const m = String(lab || '').match(/fired (?:(\d+)m )?(\d+)s ago|fired (\d+)m ago/); return !m ? null : m[3] ? +m[3] * 60 : (+(m[1] || 0)) * 60 + +m[2]; };
const nextS = lab => { const m = String(lab || '').match(/next ≈(?:(\d+)m )?(\d+)s/); return m ? (+(m[1] || 0)) * 60 + +m[2] : /next ≈now/.test(lab || '') ? 0 : null; };
// busy spells in the registry (truth), as watch saw them
const spells = []; let cur = null;
for (const s of L) { const r = reg(s); if (r?.status === 'busy') { if (!cur) spells.push(cur = { from: at(s), to: at(s), statusAt: r.statusAt }); else cur.to = at(s); } else cur = null; }
const out = { member, window: { from: L[0].at, to: L[L.length - 1].at, samples: L.length }, fires: [], between: {}, exit: {}, events: {}, spellsSeenBusy: spells.map(x => ({ from: iso(x.from), to: iso(x.to) })) };
// every fire: did the row's 'fired' reset after it, and how long after the turn's end (the registry idle flip)
fires.forEach((f, i) => {
  const end = ends[i], idleFlip = L.map(reg).find(r => r && r.status === 'idle' && r.statusAt >= f)?.statusAt || null;
  const after = L.filter(s => at(s) >= (idleFlip || end || f));
  const first = after.find(s => row(s)?.kind === 'loop' && firedS(row(s).label) != null && firedS(row(s).label) <= (at(s) - f) / 1000 + 4);
  const before = [...L].reverse().find(s => at(s) < f && row(s)?.kind === 'loop' && nextS(row(s).label) != null);
  const predicted = before ? at(before) + nextS(row(before).label) * 1000 : null;
  const snapNext = before ? row(before).loop?.next : null;
  const seenBusy = spells.some(x => x.to >= f - 1000 && x.from <= (idleFlip || end || f) + 1000);
  out.fires.push({ fire: iso(f), turnEnd: end && iso(end), idleFlip: idleFlip && iso(idleFlip), durMs: idleFlip ? idleFlip - f : end ? end - f : null, busySeenByWatch: seenBusy,
    resetShownAt: first ? first.at : null, resetLabel: first ? row(first).label : null, resetAfterIdleMs: first && idleFlip ? at(first) - idleFlip : null,
    nextShownBefore: before ? { at: before.at, label: row(before).label } : null, predictedFromLabel: predicted && iso(predicted), errorS: predicted ? Math.round((predicted - f) / 100) / 10 : null,
    snapshotNext: snapNext && iso(snapNext), snapshotErrorS: snapNext ? Math.round((snapNext - f) / 100) / 10 : null });
});
// between fires: every sample with an idle registry while the claude lives
const idle = L.filter(s => reg(s)?.status === 'idle');
const sigs = {}; for (const s of idle) { const k = row(s)?.sig || 'none'; sigs[k] = (sigs[k] || 0) + 1; }
out.between = { idleSamples: idle.length, sigs, labels: [...new Set(idle.map(s => (row(s)?.label || '').replace(/\d+/g, 'N')))],
  inPending: idle.filter(s => row(s) && (s.order.pending || []).includes(row(s).id)).length, inHeld: idle.filter(s => row(s) && (s.order.held || []).includes(row(s).id)).length,
  yellow: idle.filter(s => ['ready', 'needs'].includes(row(s)?.sig)).length };
for (const s of L) for (const e of s.events || []) if (e.agent === member || (row(s) && e.id === row(s).id)) out.events[e.kind] = (out.events[e.kind] || 0) + 1;
out.banners = L[L.length - 1].banners - L[0].banners;
// after the exit: the registry entry is gone; what does the row read
const gone = L.filter((s, i) => i > 0 && !reg(s) && L.slice(0, i).some(reg));
out.exit = { samples: gone.length, firstAt: gone[0]?.at || null, sigs: [...new Set(gone.map(s => row(s)?.sig || 'none'))], labels: [...new Set(gone.map(s => (row(s)?.label || '(no row)').replace(/\d+/g, 'N')))],
  everDone: L.filter(s => row(s)?.kind === 'done').length };
console.log(JSON.stringify(out, null, 2));
