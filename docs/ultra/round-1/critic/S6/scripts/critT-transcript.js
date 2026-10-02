// S6 critic: ground truth for r1-S6-11/12 from the vibepet FLEET transcript (a -vibepet-ultra-fleet- dir: allowed), and a replay
// of the app's own ports.taskInfo on that transcript cut where the task was still running.
const fs = require('fs'), path = require('path');
const ports = require('/Users/christopherharris/.vibepet-ultra/int/ports');
const T = '/Users/christopherharris/.claude/projects/-Users-christopherharris--vibepet-ultra-fleet-vibepet/6101876b-19c6-42a1-824f-6f1c7d4fd83e.jsonl';
if (!T.includes('-vibepet-ultra-fleet-')) throw new Error('not a fleet transcript');
const lines = fs.readFileSync(T, 'utf8').split('\n').filter(Boolean);
const ID = 'bhl322btn';
const recs = lines.map((l, i) => { try { return { i, j: JSON.parse(l), l }; } catch { return null; } }).filter(Boolean);
const brief = r => { const c = r.j.message && r.j.message.content; const parts = typeof c === 'string' ? [c] : Array.isArray(c) ? c.map(x => x.type === 'text' ? x.text : x.type === 'tool_use' ? 'TOOL_USE ' + JSON.stringify(x.input) : x.type === 'tool_result' ? 'TOOL_RESULT ' + (typeof x.content === 'string' ? x.content : JSON.stringify(x.content)) : x.type) : [];
  return { line: r.i, t: r.j.timestamp, type: r.j.type, origin: r.j.origin ? JSON.stringify(r.j.origin).slice(0, 80) : undefined, text: parts.join(' | ').slice(0, 500), version: r.j.version }; };
const rel = recs.filter(r => r.l.includes(ID) || (r.j.timestamp >= '2026-10-02T01:53:30' && r.j.timestamp <= '2026-10-02T01:55:10'));
const out = { transcript: path.basename(T), records: rel.map(brief) };
const notifIdx = lines.findIndex(l => l.includes(`<task-id>${ID}</task-id>`));
out.notificationLine = notifIdx;
out.hasParenForm = lines.some(l => l.includes(`(ID: ${ID})`));
out.runningForm = (lines.join('\n').match(new RegExp(`[A-Za-z ]{0,50}with ID: ${ID}[^"\\\\]{0,60}`)) || [])[0];
out.replay_running = ports.taskInfo(lines.slice(0, notifIdx).join('\n'), ID);   // what the app computed while the task ran
out.replay_after = ports.taskInfo(lines.join('\n'), ID);                       // after the task-notification
console.log(JSON.stringify(out, null, 1));
fs.writeFileSync('/Users/christopherharris/projects/vibepet/docs/ultra/round-1/critic/S6/truth/vibepet-bg-task.json', JSON.stringify(out, null, 1));
