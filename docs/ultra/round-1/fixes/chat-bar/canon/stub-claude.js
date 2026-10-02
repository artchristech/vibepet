#!/Users/christopherharris/.hermes/node/bin/node
// canon's chat engine (VIBEPET_CLAUDE_BIN): a warm process reading stream-json user messages on stdin, one turn per line.
// Each answer comes from that message's live context "Agents:" line only (the last one in it: the current context),
// echoing it in its order ('name=state for age - ask', '; ' between sessions; an older build: 'name=phase for Ns', ', '),
// streamed as text deltas. Logs flags + sizes per turn, never text. An interrupt control_request ends the turn.
const fs = require('fs'), a = process.argv.slice(2), m = a.indexOf('--model'), model = m >= 0 ? a[m + 1] : null;
const out = o => process.stdout.write(JSON.stringify(o) + '\n'), sid = 'canon-stub';
let buf = '', turn = null;
const ev = e => out({ type: 'stream_event', event: e, session_id: sid });
function answer(input) {
  const line = ((input.match(/^Agents: .*$/gm) || []).pop() || 'Agents: ').slice(8);
  const agents = line === 'none active.' ? [] : line.replace(/(\w)\.$/, '$1').split(/^(?:[^=,;]+=\w+ for \d+s(?:, |\.?$))+$/.test(line) ? ', ' : '; ').filter(Boolean);
  fs.appendFileSync("/Users/christopherharris/projects/vibepet/docs/ultra/round-1/fixes/chat-bar/canon/stub-claude.jsonl", JSON.stringify({ at: Date.now(), model, print: a.includes('-p'), noPersist: a.includes('--no-session-persistence'), stream: a.includes('stream-json'), bytes: input.length, agents: agents.length }) + '\n');
  const text = agents.length ? 'Canon stub engine. Live agents in my context: ' + agents.join('; ').replace(/[^.?!]$/, '$&.') : 'Canon stub engine. No live agents in my context.';
  const parts = text.match(/.{1,48}(\s|$)/g) || [text], t = turn = { stop: false };
  out({ type: 'system', subtype: 'init', model: model || 'claude-stub', session_id: sid });
  out({ type: 'system', subtype: 'status', status: 'requesting', session_id: sid });
  ev({ type: 'message_start', message: { model: model || 'claude-stub', usage: { input_tokens: Math.ceil(input.length / 4), output_tokens: 1 } } });
  ev({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
  let i = 0;
  (function next() {
    if (t.stop) return;
    if (i < parts.length) { ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: parts[i++] } }); return setTimeout(next, 25); }
    ev({ type: 'content_block_stop', index: 0 });
    ev({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: Math.ceil(text.length / 4) } });
    ev({ type: 'message_stop' });
    out({ type: 'assistant', message: { model: model || 'claude-stub', content: [{ type: 'text', text }] }, session_id: sid });
    out({ type: 'result', subtype: 'success', is_error: false, result: text, stop_reason: 'end_turn', total_cost_usd: 0, usage: { input_tokens: Math.ceil(input.length / 4), output_tokens: Math.ceil(text.length / 4), cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, session_id: sid });
    turn = null;
  })();
}
process.stdin.on('data', d => {
  buf += d; let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const raw = buf.slice(0, i); buf = buf.slice(i + 1);
    let j; try { j = JSON.parse(raw); } catch { continue; }
    if (j.type === 'control_request') {
      out({ type: 'control_response', response: { subtype: 'success', request_id: j.request_id, response: {} } });
      if (j.request?.subtype === 'interrupt' && turn) { turn.stop = true; turn = null; out({ type: 'result', subtype: 'error_during_execution', is_error: true, usage: {}, session_id: sid }); }
    } else if (j.type === 'user') answer((j.message?.content || []).map(c => c.text || '').join('') || String(j.message?.content || ''));
  }
}).on('end', () => { const bye = () => turn ? setTimeout(bye, 20) : process.exit(0); bye(); });   // finish the turn first
