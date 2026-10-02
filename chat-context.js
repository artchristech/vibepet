// chat-context — what chat is told about the sessions. main.js (buildContext) reads git and transcripts; this formats:
// one line per live session (what it is, where, its true state and age, the exact ask, the files it edited this turn, its
// fan-out), an Overlaps line (two sessions touching one file in one repo), and which sessions a message is about, so their
// own repo and transcript ride along. Pure: no git, no files.
const path = require('path');
const os = require('os');
const { NEEDS } = require('./agents');

// the chat model's view of each session, in queue order: its state, for how long on Claude Code's clock, what it asks
const SAYS = { approval: 'needs approval', plan: 'needs plan approval', question: 'waiting for an answer', input: 'waiting for an answer', done: 'done', running: 'running', exited: 'exited' };
const span = ms => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h ${Math.floor(s % 3600 / 60)}m`; };
const agentLine = (a, now = Date.now()) => `${a.name}=${SAYS[a.kind] || a.phase} for ${span(now - a.since)}${a.ask ? ' - ' + a.ask.replace(/;\s*/g, ', ') : ''}`;

const HOME = os.homedir();
const tilde = p => p && (p === HOME || p.startsWith(HOME + path.sep)) ? '~' + p.slice(HOME.length) : p;
const inRepo = (f, root) => !!root && f.startsWith(root + path.sep);
const fileOf = (f, root) => inRepo(f, root) ? path.relative(root, f) : tilde(f);
const stateOf = a => SAYS[a.kind] || a.phase;

// what it waits on (the command, or the question and its options: an approval's are always yes / always / no), what it
// last said, or the tool it's running
function askOf(a) {
  if (!a.ask) return '';
  if (NEEDS.has(a.kind)) { const o = a.kind === 'question' || a.kind === 'input' ? (a.options || []).map(x => x.label) : []; return `asks: ${a.ask}${o.length && !o.every(l => a.ask.includes(l)) ? ` (options: ${o.join(' / ')})` : ''}`; }
  if (a.kind === 'done') return a.ask === 'interrupted' ? 'its turn was interrupted' : `last said: ${a.ask}`;
  return a.kind === 'running' ? `running ${a.ask}` : a.ask;
}
function edited(a) {
  const f = a.receipt ? [...a.receipt.files].map(x => fileOf(x, a.root)) : [];
  return `edited this turn: ${f.length ? `${f.slice(0, 6).join(', ')}${f.length > 6 ? ` +${f.length - 6} more` : ''} (+${a.receipt.add} -${a.receipt.del} lines)` : 'nothing'}`;
}
// '- name (@name you gave it) · "title" · folder · repo/branch · state age · ask · edited · fan-out'
function sessionLine(a, now = Date.now()) {
  const fo = a.fanout;
  return '- ' + [a.name + (a.alias && a.regName !== a.name ? ` (@${a.regName})` : ''), a.title && `"${a.title}"`, a.cwd && `folder ${tilde(a.cwd)}`,
    a.root ? `repo ${path.basename(a.root)}/${a.branch || '?'}` : 'not in a git repo', `${stateOf(a)} for ${span(now - a.since)}`, askOf(a), edited(a),
    fo?.total && `fan-out ${fo.done}/${fo.total} subagents done${fo.stuck ? `, ${fo.stuck} stuck on an approval` : ''}`].filter(Boolean).join(' · ');
}
// what to do for a session that needs you: answer its question, or approve its command, in backticks (Haiku keeps a
// backticked command verbatim, and paraphrases 'Bash: ./deploy.sh --dry-run' into 'a deploy dry-run')
function todo(a) {
  const q = askOf(a).replace(/^asks: /, ''), m = /^(\w+): (.+)$/.exec(a.ask || '');
  if (a.kind === 'question' || a.kind === 'input') return `answer "${q}"`;
  if (a.kind === 'plan') return `approve the plan "${q.replace(/^Plan: /, '')}"`;
  return m ? `approve the ${m[1]}${m[1] === 'Bash' ? ' command' : ''} \`${m[2]}\`` : q || stateOf(a);
}
// every session (≤15, ≤8 KB of lines; the rest by name only) under a header that says how to read them, then the ones that
// need you and what to do for each: what "which session needs me (first)?" is answered from
const HEAD = 'Sessions, in the order they need you (needs you first, then done, running, exited; longest-waiting first). Ages are on Claude Code\'s own clock; "edited this turn" = files the session changed since its last prompt:';
function sessions(list, now = Date.now(), max = 15, budget = 8000) {
  const out = [HEAD], needs = list.filter(a => NEEDS.has(a.kind));
  let size = HEAD.length, i = 0;
  for (; i < Math.min(list.length, max); i++) { const l = sessionLine(list[i], now); if (size + l.length > budget) break; out.push(l); size += l.length + 1; }
  if (i < list.length) out.push(`- and ${list.length - i} more: ${list.slice(i).map(a => `${a.name} (${stateOf(a)})`).join(', ')}`);
  const [first, ...next] = needs.slice(0, max), to = (a, tag = '') => `${a.name}${tag}: ${todo(a)}`;
  out.push(!first ? 'Needs you now: nothing.' : `Needs you now: ${next.length ? `${to(first, ' first')}. Next: ${next.map(a => to(a)).join('; then ')}. Asked who needs the user first, give the first and its ask, then who's next and theirs.`
    : `${to(first)}.`} Give commands verbatim in backticks.`);
  return out.join('\n');
}

// the edit a session asks approval for: the transcript's 'Edit: /abs/file' or a dialog's 'Edit file: src/x.js', as a path
function pendingEdit(a) {
  const m = a.kind === 'approval' && /^(?:(?:multi)?edit|write|create|notebookedit)(?: file)?: (.+)$/i.exec(a.ask || '');
  return m && !m[1].endsWith('…') ? path.resolve(a.cwd || '/', m[1].trim()) : null;
}
// two sessions touching one file in one repo, from the files each edited this turn and the edit each asks to make: the
// truthful answer to "are two of my sessions about to edit the same file?" until the Collision Radar card ships
function overlaps(list) {
  const by = new Map();   // absolute path -> Map(session -> what it did to it)
  const add = (f, a, how) => { const m = by.get(f) || new Map(); by.set(f, m); m.set(a, m.has(a) ? `${m.get(a)} and ${how}` : how); };
  for (const a of list) { for (const f of a.receipt?.files || []) add(f, a, 'edited it this turn'); const p = pendingEdit(a); if (p) add(p, a, 'is asking to edit it'); }
  const twice = new Set(list.map(a => a.name).filter((n, i, all) => all.indexOf(n) !== i));
  const who = a => twice.has(a.name) && a.title ? `${a.name} ("${a.title}")` : a.name;
  const hits = [...by].filter(([, m]) => m.size > 1);
  if (hits.length) return 'Overlaps: ' + hits.map(([f, m]) => { const r = [...m.keys()].find(a => inRepo(f, a.root))?.root;
    return `${r ? path.basename(r) + '/' + path.relative(r, f) : tilde(f)}: ${[...m].map(([a, how]) => `${who(a)} ${how}`).join(', ')}`; }).join('; ') + '.';
  const repos = new Map();
  for (const a of list) if (a.root) repos.set(a.root, [...(repos.get(a.root) || []), a]);
  const shared = [...repos].filter(([, xs]) => xs.length > 1);
  return 'Overlaps: none. ' + (shared.length ? shared.map(([r, xs]) => `${xs.map(who).join(' and ')} share repo ${path.basename(r)}, but no file was touched by two of them`).join('; ') + '.'
    : `No two sessions share a repo (${list.length} session${list.length === 1 ? '' : 's'} in ${repos.size} repo${repos.size === 1 ? '' : 's'}${list.length > repos.size ? ', the rest outside git' : ''}).`);
}

// the sessions a message is about, ≤3: named in it (folder name or @name, the registry's name, or the whole title), else
// for the agent/next quick asks the ones that need you, longest-waiting first (else the latest active one)
function about(text, mode, list) {
  const t = String(text || '').toLowerCase(), esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const says = w => !!w && w.length > 1 && new RegExp(`(?:^|[^\\w-])@?${esc(w.toLowerCase())}(?![\\w-])`).test(t);
  const named = list.filter(a => says(a.name) || says(a.regName) || (a.title?.length > 3 && t.includes(a.title.toLowerCase())));
  if (named.length) return { why: 'named in your message', list: named.slice(0, 3) };
  if (mode !== 'agent' && mode !== 'next') return { why: '', list: [] };
  const needs = list.filter(a => NEEDS.has(a.kind));
  if (needs.length) return { why: 'needs you', list: needs.slice(0, 3) };
  const latest = list.filter(a => a.kind !== 'exited').sort((a, b) => (b.mtime || 0) - (a.mtime || 0))[0];
  return { why: 'the latest active session', list: latest ? [latest] : [] };
}
// a session's own repo, beside the watched one: its uncommitted work (diff stat, untracked files), then the commits made in
// it since the session began apart from the older ones, so a seed commit isn't read as the session's work.
// log: 'sha<TAB>commit time (s)<TAB>subject (age)' lines; since: when the session began (its transcript's birth), or null
function repoText(a, { stat, untracked, log }, since = null, now = Date.now()) {
  const u = (untracked || '').split('\n').filter(Boolean), name = `${a.name}'s repo ${path.basename(a.root)} (branch ${a.branch || '?'}, ${tilde(a.root)})`;
  if (stat == null && !log) return `${name}: no commits yet, or git couldn't read it.`;
  const rows = (log || '').split('\n').filter(Boolean).map(l => { const [h, ct, ...t] = l.split('\t'); return { at: +ct * 1000, l: `${h} ${t.join(' ')}` }; });
  const after = since ? rows.filter(r => r.at >= since) : [], before = since ? rows.filter(r => r.at < since) : rows;
  return `${name}: ${stat ? 'uncommitted changes:\n' + stat.split('\n').slice(-20).join('\n') : 'clean, nothing uncommitted'}` +
    `${u.length ? `\nUntracked files: ${u.slice(0, 10).join(', ')}${u.length > 10 ? ` +${u.length - 10} more` : ''}` : stat ? '' : ', no untracked files'}.` +
    (since ? `\nCommits in it since ${a.name}'s session began (${span(now - since)} ago):${after.length ? '\n' + after.map(r => r.l).join('\n') : ' none.'}` : '') +
    (before.length ? `\n${since ? 'Older commits' : 'Recent commits'}:\n${before.map(r => r.l).join('\n')}` : since ? '' : '\nRecent commits: (none)');
}

module.exports = { SAYS, span, agentLine, sessionLine, sessions, pendingEdit, overlaps, about, repoText };
