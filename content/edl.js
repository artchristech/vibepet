// edl — pure pieces of "Net makes content": secret redaction, prompt-tap line parsing, and the deterministic edit list.
// No Electron, no ffmpeg: test/content.test.js drives all of it.

// ---------- redaction ----------
// anything that looks like a credential is replaced before a prompt is stored, overlaid or captioned
const SECRET_RES = [
  /\bsk-(?:ant-|proj-|live-|test-)?[A-Za-z0-9_-]{16,}/g,       // Anthropic / OpenAI / Stripe
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,                              // AWS access key id
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g,                             // GitHub tokens
  /\bgithub_pat_[A-Za-z0-9_]{40,}\b/g,
  /\bxai-[A-Za-z0-9]{20,}\b/g,                                   // xAI
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,                           // Slack
  /\bAIza[0-9A-Za-z_-]{35}\b/g,                                  // Google API key
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,   // JWT
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\b0x[a-fA-F0-9]{64}\b/g,                                      // raw private key / long hex
  /\b[a-fA-F0-9]{32,}\b/g,                                       // long hex blobs
  /(?<![\w/.-])(?=[A-Za-z0-9+/_-]*\d)(?=[A-Za-z0-9+/_-]*[A-Z])(?=[A-Za-z0-9+/_-]*[a-z])[A-Za-z0-9+/_-]{40,}={0,2}(?![\w/.-])/g,   // long base64 blobs: mixed case + digits, not a path
  /^\s*(?:export\s+)?[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASS|PWD)[A-Z0-9_]*\s*=\s*\S+.*$/gm,   // .env lines
];
function redact(text) {
  let n = 0, out = String(text || '');
  for (const re of SECRET_RES) out = out.replace(re, () => (n++, '[redacted]'));
  return { text: out, n };
}

// ---------- prompt tap ----------
// one appended jsonl line → a prompt, an agent turn end, or nothing. humanAt comes from agents.js (shared definition of "a real prompt").
function tapLine(line, humanAt, textOf) {
  if (!line.includes('"type"')) return null;
  let d; try { d = JSON.parse(line); } catch { return null; }
  if (d.isSidechain || d.isMeta) return null;
  if (d.type === 'user') {
    const at = humanAt(d);
    if (!at) return null;
    const t = textOf(d.message?.content).trim();
    if (!t || t.startsWith('<')) return null;
    return { kind: 'prompt', at, text: t, cwd: d.cwd || null };
  }
  if (d.type === 'assistant' && ['end_turn', 'stop_sequence'].includes(d.message?.stop_reason)) {
    const at = Date.parse(d.timestamp) || 0;
    return at ? { kind: 'result', at, cwd: d.cwd || null } : null;
  }
  return null;
}

// overlay text: one line of intent, ≤140 chars, whitespace collapsed
function overlayText(t, n = 140) {
  const s = String(t).replace(/```[\s\S]*?```/g, ' ').replace(/\s+/g, ' ').trim();
  return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…';
}

// ---------- deterministic edit list ----------
// prompts: [{ t, text }] and results: [{ t }] in seconds from recording start; duration in seconds.
// Per prompt: build (the prompt landing, 1x, overlaid) → wait (sped 2–8x toward the result) → payoff (the result, 1x).
// Prompts are dropped from the middle until the cut fits the target; gaps are filled when it runs short of 30s.
const r2 = x => Math.round(x * 100) / 100;
function outLen(c) { return (c.src_end - c.src_start) / c.speed; }
function directFallback({ prompts = [], results = [], duration, target = 45, title = 'Built with Claude Code', cursor }) {
  const D = Math.max(0, duration - 0.05), clamp = x => Math.min(D, Math.max(0, x));
  const mk = (s, e, speed, role, overlay) => {
    s = clamp(s); e = clamp(e);
    return e - s >= 0.5 ? { src_start: r2(s), src_end: r2(e), speed, role, ...(overlay ? { overlay_prompt: overlay } : {}) } : null;
  };
  const groups = [];
  const ps = [...prompts].sort((a, b) => a.t - b.t).filter(p => p.t >= 0 && p.t < D);
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i], next = ps[i + 1]?.t ?? D;
    const r = results.map(x => x.t).filter(t => t > p.t + 1 && t <= next + 0.5).sort((a, b) => a - b)[0] ?? Math.min(next, p.t + 20);
    const g = [mk(p.t - 1, p.t + 3, 1, 'build', overlayText(p.text))];
    const ws = p.t + 3, wl = r - ws;
    if (wl > 2) { const speed = Math.min(8, Math.max(2, Math.round(wl / 3))); g.push(mk(Math.max(ws, r - 3 * speed), r, speed, 'wait')); }
    g.push(mk(r, r + 2.5, 1, 'payoff'));
    groups.push(g.filter(Boolean));
  }
  const total = gs => gs.flat().reduce((n, c) => n + outLen(c), 0);
  // too long: drop groups from the middle (keep the first as the hook and the last as the ending)
  while (groups.length > 2 && total(groups) > Math.min(60, target + 5)) groups.splice(Math.floor(groups.length / 2), 1);
  let clips = groups.flat();
  // too short (or no prompts): fill evenly from the rest of the timeline at 1x
  if (total([clips]) < 30 && D > 0) {
    const need = Math.min(target, D) - total([clips]), n = Math.max(1, Math.ceil(need / 5));
    const used = c => clips.some(x => c.src_start < x.src_end && c.src_end > x.src_start);
    for (let k = 0; k < n * 3 && total([clips]) < Math.min(30, D); k++) {
      const s = (D / (n * 3 + 1)) * (k + 1), c = mk(s, Math.min(s + 5, D), 1, 'build');
      if (c && !used(c)) clips.push(c);
    }
  }
  clips.sort((a, b) => a.src_start - b.src_start);
  if (clips.length) clips[0].role = 'hook';
  for (const c of clips) if (cursor) c.focus_x = focusAt(cursor, (c.src_start + c.src_end) / 2);
  const n = ps.length;
  return {
    title, hook_text: n ? `${n} prompt${n === 1 ? '' : 's'} → shipped` : title, mood: 'hopeful', bpm_hint: 70,
    clips, target_duration: r2(total([clips])), source: 'deterministic',
  };
}

// cursor samples [{ t, x }] (x = 0..1 across the display) → the median x within ±4s of t, else the middle
function focusAt(samples, t) {
  const near = samples.filter(s => Math.abs(s.t - t) <= 4).map(s => s.x).sort((a, b) => a - b);
  return near.length ? r2(near[Math.floor(near.length / 2)]) : 0.5;
}

function caption({ project, prompts, minutes }) {
  const p = project ? ` on ${project}` : '';
  return `${prompts} prompt${prompts === 1 ? '' : 's'}, ${minutes} min${p}, directed with Claude Code.\n\n#buildinpublic #claudecode #vibecoding #ai #coding`;
}

module.exports = { redact, tapLine, overlayText, directFallback, focusAt, caption, outLen };
