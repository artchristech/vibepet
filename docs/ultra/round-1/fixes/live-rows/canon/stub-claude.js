#!/Users/christopherharris/.hermes/node/bin/node
// canon's chat engine (VIBEPET_CLAUDE_BIN): answers from the live context's "Agents:" line only, echoing it in its order
// ('name=state for age - ask', '; ' between sessions; an older build: 'name=phase for Ns', ', '). Logs flags + sizes, never text.
const fs = require('fs'); let input = '';
process.stdin.on('data', d => input += d).on('end', () => {
  const a = process.argv.slice(2), m = a.indexOf('--model'), line = (input.match(/^Agents: (.*)$/m) || [, ''])[1];
  const agents = line === 'none active.' ? [] : line.replace(/(\w)\.$/, '$1').split(/^(?:[^=,;]+=\w+ for \d+s(?:, |\.?$))+$/.test(line) ? ', ' : '; ').filter(Boolean);
  fs.appendFileSync("/Users/christopherharris/projects/vibepet/docs/ultra/round-1/fixes/live-rows/canon/stub-claude.jsonl", JSON.stringify({ at: Date.now(), model: m >= 0 ? a[m + 1] : null, print: a.includes('-p'), noPersist: a.includes('--no-session-persistence'), bytes: input.length, agents: agents.length }) + '\n');
  const text = agents.length ? 'Canon stub engine. Live agents in my context: ' + agents.join('; ').replace(/[^.?!]$/, '$&.') : 'Canon stub engine. No live agents in my context.';
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: text, total_cost_usd: 0 }));
});
