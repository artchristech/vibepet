// goal — is a session still doing what it was started for? Pure functions; main.js feeds them transcript tails.
// Drift v0 is lexical and deliberately shy: it only speaks when the evidence is big and one-sided, else 'unknown'.

// words that say nothing about *what* the work is
const STOP = new Set(('the a an and or but for with from into onto this that these those there here then than also just only very really ' +
  'make made makes making do does did doing done get got gets getting let lets use using used want need needs should could would will can ' +
  'please thanks now new old all any some more most other each every one two three it its it\'s we our you your i me my they them their is are was were be been ' +
  'on in at to of by as if so up out off over not no yes what why how when where which who whats look find see check tell give take keep put run ' +
  'work thing things stuff way ways like about app project code file files fix build add update change changes improve better good bad right ' +
  'idea ideas thoughts think bit lot okay ok cool nice sure yeah').split(/\s+/));

const stem = w => w.replace(/(?:ing|ed|es|s)$/, '').replace(/(.)\1$/, '$1');
// 'receipt.test.js' → receipt test js; 'goalFor' → goal for
function words(t) {
  return String(t || '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/)
    .filter(w => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w)).map(stem);
}
const goalTerms = text => [...new Set(words(text))];

// a prompt that states intent, not a shell reflex ('cd vibepet', 'commit it', 'yes')
const SHELLY = /^(?:cd|ls|pwd|git|npm|pnpm|yarn|bun|open|cat|clear|exit|run|commit|push|pull|continue|go|yes|no|ok|okay|y|n)\b/i;
function intentful(t) {
  const n = t.split(/\s+/).filter(Boolean).length;
  if (n < 3) return false;
  return !(SHELLY.test(t) && n <= 6);
}

// what the session has actually been touching: the newest tool calls' paths, commands, patterns and descriptions
function evidence(lines, max = 40) {
  const out = [];
  for (let i = lines.length - 1; i >= 0 && out.length < max; i--) {
    if (!lines[i].includes('"tool_use"')) continue;
    let d; try { d = JSON.parse(lines[i]); } catch { continue; }
    if (d.type !== 'assistant' || d.isSidechain) continue;
    for (const c of (d.message?.content || []).reverse()) {
      if (c.type !== 'tool_use' || out.length >= max) continue;
      const x = c.input || {};
      const parts = [x.file_path, x.path, x.pattern, x.description, x.command && String(x.command).slice(0, 300), x.prompt && String(x.prompt).slice(0, 200)];
      const t = parts.filter(Boolean).join(' ');
      if (t) out.push(t);
    }
  }
  return out;
}

// verdict: { state: 'on' | 'drift' | 'unknown', hits, n, terms }
// on    = ≥30% of recent actions mention a goal term (and at least 3 do)
// drift = ≥12 recent actions and none of the newest 12 mention one, though earlier ones did (the goal was once reachable lexically)
function judge(goal, ev) {
  const terms = goalTerms(goal);
  const res = (state, hits = 0) => ({ state, hits, n: ev.length, terms });
  if (terms.length < 2 || ev.length < 6) return res('unknown');
  const hit = ev.map(e => { const w = new Set(words(e)); return terms.some(t => w.has(t)); });
  const hits = hit.filter(Boolean).length;
  if (ev.length >= 12 && !hit.slice(0, 12).some(Boolean) && hit.slice(12).some(Boolean)) return res('drift', hits);   // newest first: recent silence beats old matches
  if (hits >= 3 && hits / ev.length >= 0.3) return res('on', hits);
  return res('unknown', hits);
}

// a commit subject that names the goal: ≥2 shared terms, or 1 when the goal has only 2
function commitMatches(goal, subject) {
  const terms = goalTerms(goal), w = new Set(words(subject));
  const shared = terms.filter(t => w.has(t)).length;
  return terms.length >= 2 && shared >= Math.min(2, terms.length - 1);
}

module.exports = { words, goalTerms, intentful, evidence, judge, commitMatches };
