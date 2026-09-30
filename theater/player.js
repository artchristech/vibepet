// theater/player.js — replays a Timeline (theater/model.js) as a cinematic, scrubbable session. No deps, no network.
'use strict';
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const PX = 0.05;          // rail px per virtual ms (50px per replay-second at 1×)
const Y0 = 58, SIDE0 = 98, ROW = 12, ROWS = 4;
const ICON = {
  prompt: '<path d="M4 6l5 6-5 6M12 18h8"/>', thinking: '<circle cx="6" cy="16" r="2"/><circle cx="12" cy="8" r="2"/><circle cx="18" cy="16" r="2"/>',
  read: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>', edit: '<path d="M4 20h4L20 8l-4-4L4 16z"/>',
  command: '<path d="M4 17l6-5-6-5M12 19h8"/>', check: '<path d="M5 12l5 5L20 7"/>', agent: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="12" r="2.5"/><path d="M6 8.5v7M8 7c6 0 8 2 8 3"/>',
  commit: '<circle cx="12" cy="12" r="4"/><path d="M2 12h6M16 12h6"/>', reply: '<path d="M4 5h16v11H9l-5 4z"/>', bad: '<path d="M6 6l12 12M18 6L6 18"/>',
};
const svg = (k, w = 2) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${ICON[k] || ICON.read}</svg>`;
const KIND = { prompt: 'Prompt', thinking: 'Thinking', read: 'Look', edit: 'Edit', command: 'Command', check: 'Check', agent: 'Subagent', commit: 'Commit', reply: 'Reply' };
const color = b => b.kind === 'check' ? (b.ok === false ? 'var(--bad)' : b.ok ? 'var(--ok)' : 'var(--command)') : `var(--${b.kind})`;
const mmss = ms => { const s = Math.max(0, Math.round(ms / 1000)), p = n => String(n).padStart(2, '0'); return s >= 3600 ? `${Math.floor(s / 3600)}:${p(Math.floor(s % 3600 / 60))}:${p(s % 60)}` : `${Math.floor(s / 60)}:${p(s % 60)}`; };
const home = s => String(s || '').replace(/^\/Users\/[^/]+/, '~');
const hhmm = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const dur = ms => ms < 90e3 ? `${Math.round(ms / 1000)}s` : ms < 5400e3 ? `${Math.round(ms / 60e3)}m` : `${(ms / 3600e3).toFixed(1)}h`;

let T, beats = [], now = 0, playing = false, speed = 4, active = -1, pinned = -1, holdUntil = 0, camX = 0, camZ = 1, last = 0, typing = 0, laneY = {};

// ---------- rail ----------
function layoutRail() {
  // subagent lanes pack into rows below the spine: a row is reused once its previous lane has finished
  const ends = [], span = {};
  for (const b of beats) if (b.lane) { const s = span[b.lane] ||= { a: b.v, z: b.v }; s.z = b.v; }
  Object.entries(span).sort((a, b) => a[1].a - b[1].a).forEach(([lane, s]) => {
    let r = ends.findIndex(e => e + 400 < s.a); if (r < 0) r = ends.length;
    ends[r] = s.z; laneY[lane] = SIDE0 + (r % ROWS) * ROW;
  });
  const W = T.meta.dur * PX + 400;
  $('rail').style.width = W + 'px';
  const br = $('branches'); br.setAttribute('width', W); br.setAttribute('height', 150);
  let paths = `<line class="spine" x1="0" y1="${Y0}" x2="${W}" y2="${Y0}"/>`;
  for (const [lane, s] of Object.entries(span)) {
    const from = beats.find(b => b.branch === +lane), fx = (from ? from.v : s.a) * PX, fy = from && from.lane ? laneY[from.lane] : Y0, y = laneY[lane], x0 = s.a * PX;
    paths += `<path class="lane" data-lane="${lane}" d="M${fx} ${fy} C ${fx + 18} ${fy}, ${fx + 10} ${y}, ${fx + 34} ${y} L ${Math.max(x0, s.z * PX)} ${y}"/>`;
  }
  br.innerHTML = paths;
  $('beats').innerHTML = `<span class="lbl now" id="nowLbl"></span>` + beats.map(b => {
    const x = b.v * PX, y = b.lane ? laneY[b.lane] : Y0, cls = [b.kind, b.lane && 'side', b.kind === 'check' && (b.ok === false ? 'bad' : b.ok ? 'okc' : '')].filter(Boolean).join(' ');
    const lbl = b.kind === 'prompt' ? `<span class="lbl ch" style="left:${x}px;top:${y - 34}px">${esc(`${b.ch + 1} · ${b.title.slice(0, 28)}`)}</span>`
      : b.kind === 'commit' ? `<span class="lbl" style="left:${x}px;top:${y - 36}px;color:var(--commit)">${esc(b.detail)}</span>` : '';
    return `<button class="b ${cls}" data-i="${b.i}" title="${esc(KIND[b.kind] + ': ' + b.title)}" style="left:${x}px;top:${y}px;--k:${color(b)}">${svg(b.kind === 'check' && b.ok === false ? 'bad' : b.kind, 2.4)}</button>${lbl}`;
  }).join('');
}

// ---------- stage: one scene per beat kind ----------
function kicker(b) {
  return `<div class="kicker" style="--k:${color(b)}"><span class="ic">${svg(b.kind === 'check' && b.ok === false ? 'bad' : b.kind)}</span>${KIND[b.kind]}${b.lane ? ` · <span style="color:var(--agent)">${esc(T.lanes[b.lane - 1]?.title || 'subagent')}</span>` : ''}<time>${hhmm(b.t)} · +${mmss(b.t - T.meta.t0)}</time></div>`;
}
function diffHtml(b) {
  const rows = (b.hunks || []).map((h, k) => h.op === '…' ? `<div class="e" style="--d:${k}">${esc(h.s || '⋯')}</div>`
    : `<div class="${h.op === '+' ? 'a' : h.op === '-' ? 'r' : 'c'}" data-op="${h.op === ' ' ? '' : h.op}" style="--d:${Math.min(k, 40)}">${esc(h.s) || ' '}</div>`).join('');
  return `<div class="diff"><header><b>${esc(b.files?.[0] || b.detail)}</b><span class="n"><i>+${b.add || 0}</i><u>−${b.del || 0}</u></span></header><pre>${rows}</pre></div>`;
}
function scene(b) {
  const k = kicker(b);
  switch (b.kind) {
    case 'prompt': return `<div class="fx">${k}<div class="headline">${esc(b.detail || b.title)}</div></div>`;
    case 'thinking': return `<div class="fx">${k}<div class="prose think">${esc(b.detail)}</div></div>`;
    case 'reply': return `<div class="fx">${k}<div class="prose">${esc(b.detail)}</div></div>`;
    case 'read': return `<div class="fx">${k}<div class="headline small">${esc(b.title)}</div>${b.out ? `<div class="term"><pre><span class="out">${esc(b.out.slice(0, 900))}</span></pre></div>` : ''}</div>`;
    case 'edit': return `<div class="fx">${k}${diffHtml(b)}${b.ok === false ? '<div class="verdict bad">✗ REJECTED</div>' : ''}</div>`;
    case 'command': case 'check': {
      const v = b.kind !== 'check' ? (b.ok === false ? '<div class="verdict bad">✗ EXIT</div>' : '')
        : `<div class="verdict ${b.ok === false ? 'bad' : b.ok ? 'ok' : 'pending'}">${b.ok === false ? '✗ RED' : b.ok ? '✓ GREEN' : '… NO RESULT'}</div>`;
      return `<div class="fx">${k}<div class="headline small">${esc(b.title)}</div><div class="term"><header><i></i><i></i><i></i><span>${esc(home(T.meta.cwd))}</span></header><pre><div class="cmd">${esc(b.cmd)}</div>${b.out ? `<div class="out${b.ok === false ? ' err' : ''}">${esc(b.out.slice(-1400))}</div>` : ''}</pre></div>${v}</div>`;
    }
    case 'agent': return `<div class="fx">${k}<div class="fork"><svg viewBox="0 0 64 64"><path d="M8 32 H30 C44 32 44 12 58 12 M30 32 C44 32 44 52 58 52"/></svg><div class="headline">${esc(b.title)}</div></div><span class="chip">${esc(b.agentType)}${b.branch ? ' · branch ' + b.branch : ''}</span><div class="prose">${esc((b.detail || '').slice(0, 700))}</div></div>`;
    case 'commit': return `<div class="fx commit"><div class="seal">${svg('commit', 2.2)}</div><div class="kicker" style="--k:var(--commit);justify-content:center">Milestone</div><div class="headline">${esc(b.title)}</div><div class="hash">${esc(b.detail)}</div></div>`;
  }
  return `<div class="fx">${k}<div class="headline small">${esc(b.title)}</div></div>`;
}

function card(b) {
  const text = b.detail || b.title;
  $('cardNo').textContent = `Chapter ${b.ch + 1} of ${T.chapters.length}`;
  $('card').classList.remove('hidden');
  clearInterval(typing);
  if (reduce) { $('cardText').textContent = text.slice(0, 400); return; }
  let n = 0; const step = Math.max(1, Math.ceil(Math.min(text.length, 400) / 60));
  $('cardText').textContent = '';
  typing = setInterval(() => { n += step; $('cardText').textContent = text.slice(0, Math.min(n, 400)); if (n >= Math.min(text.length, 400)) clearInterval(typing); }, 22);
}

function activate(i, via) {
  if (i === active) return;
  const prev = active; active = i;
  document.querySelectorAll('.b.on').forEach(e => e.classList.remove('on'));
  beats.forEach(b => { const e = document.querySelector(`.b[data-i="${b.i}"]`); if (e) e.classList.toggle('past', b.i <= i); });
  const b = beats[i];
  if (!b) { $('focus').innerHTML = ''; return; }
  document.querySelector(`.b[data-i="${i}"]`)?.classList.add('on');
  const nl = $('nowLbl'); nl.textContent = b.title; nl.style.left = b.v * PX + 'px'; nl.style.top = Y0 + 21 + 'px';
  $('focus').innerHTML = scene(b);
  $('chap').textContent = T.chapters[b.ch]?.title || '';
  // playing forward into a new chapter: title card, clock held while it types
  if (via === 'play' && b.kind === 'prompt' && i > prev) { card(b); holdUntil = performance.now() + (reduce ? 900 : Math.max(900, 2600 / Math.sqrt(speed))); }
  else if (via !== 'play') $('card').classList.add('hidden');
  if (via === 'play' && b.kind === 'commit' && !reduce) { const f = $('flash'); f.classList.add('hidden'); void f.offsetWidth; f.classList.remove('hidden'); }
}

function pin(i) {
  const b = beats[i], p = $('pin');
  document.querySelectorAll('.b.pinned').forEach(e => e.classList.remove('pinned'));
  if (!b || pinned === i) { pinned = -1; p.classList.add('hidden'); $('stage').classList.remove('pinned'); return; }
  pinned = i; document.querySelector(`.b[data-i="${i}"]`)?.classList.add('pinned');
  p.innerHTML = `<button class="x" title="close (esc)">✕</button>${kicker(b)}<h3>${esc(b.title)}</h3>
    ${b.files?.length ? `<div class="meta">${b.files.map(esc).join('<br>')}</div>` : ''}
    ${b.cmd ? `<pre>$ ${esc(b.cmd)}</pre>` : ''}${b.kind === 'edit' ? diffHtml(b) : ''}
    ${b.detail && b.kind !== 'edit' && b.kind !== 'commit' ? `<pre>${esc(b.detail)}</pre>` : ''}${b.out ? `<div class="meta">output${b.ok === false ? ' · failed' : ''}</div><pre>${esc(b.out)}</pre>` : ''}`;
  p.classList.remove('hidden'); $('stage').classList.add('pinned');
  p.querySelector('.x').onclick = () => pin(i);
}

// ---------- clock + camera ----------
const idxAt = v => { let lo = 0, hi = beats.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (beats[m].v <= v) { r = m; lo = m + 1; } else hi = m - 1; } return r; };
function seek(v, via = 'seek') {
  now = Math.max(0, Math.min(T.meta.dur, v));
  activate(idxAt(now), via);
  paint(true);
}
function paint(snap) {
  const f = now / T.meta.dur;
  $('fill').style.width = f * 100 + '%'; $('knob').style.left = f * 100 + '%';
  $('clock').textContent = `${mmss(now)} / ${mmss(T.meta.dur)}`;
  // camera: playhead centred, zoomed in a touch on the moments that matter
  const b = beats[active], W = $('railWrap').clientWidth, z = b && ['edit', 'commit', 'check'].includes(b.kind) ? 1.12 : 1;
  const tx = W / 2 - now * PX * z;
  const k = snap || reduce ? 1 : 0.12;
  camX += (tx - camX) * k; camZ += (z - camZ) * k;
  $('rail').style.transform = `translateX(${camX}px) scale(${camZ})`;
}
function frame(ts) {
  const dt = last ? Math.min(100, ts - last) : 0; last = ts;
  if (playing && ts >= holdUntil) {
    if (!$('card').classList.contains('hidden') && holdUntil) { $('card').classList.add('hidden'); holdUntil = 0; }
    now += dt * speed;
    if (now >= T.meta.dur) { now = T.meta.dur; setPlaying(false); }
    activate(idxAt(now), 'play');
  }
  paint(false);
  requestAnimationFrame(frame);
}
function setPlaying(p) { playing = p; $('play').textContent = p ? '❚❚' : '▶'; if (p && now >= T.meta.dur) seek(0); }
function setSpeed(s) { speed = s; document.querySelectorAll('#speed button').forEach(e => e.classList.toggle('on', +e.dataset.s === s)); }

// ---------- input ----------
function wire() {
  $('play').onclick = () => setPlaying(!playing);
  document.querySelectorAll('#speed button').forEach(e => e.onclick = () => setSpeed(+e.dataset.s));
  const sc = $('scrub'), at = e => { const r = sc.getBoundingClientRect(); return (e.clientX - r.left) / r.width * T.meta.dur; };
  sc.onpointerdown = e => { sc.setPointerCapture(e.pointerId); seek(at(e)); sc.onpointermove = m => seek(at(m)); };
  sc.onpointerup = () => { sc.onpointermove = null; };
  $('beats').onclick = e => { const i = +e.target.closest('.b')?.dataset.i; if (Number.isInteger(i)) { seek(beats[i].v); pin(i); } };
  addEventListener('keydown', e => {
    const ch = beats[active]?.ch ?? 0;
    if (e.key === ' ') { e.preventDefault(); setPlaying(!playing); }
    else if (e.key === 'ArrowRight') seek(beats[Math.min(beats.length - 1, active + 1)].v);
    else if (e.key === 'ArrowLeft') seek(beats[Math.max(0, active - 1)].v);
    else if (e.key === ']') { const c = T.chapters[ch + 1]; if (c) seek(c.v); }
    else if (e.key === '[') { const c = T.chapters[now - T.chapters[ch].v > 1500 ? ch : Math.max(0, ch - 1)]; seek(c.v); }
    else if (e.key === 'Escape' && pinned >= 0) pin(pinned);
    else if (['1', '2', '3'].includes(e.key)) setSpeed([1, 4, 16][+e.key - 1]);
  });
}

function header() {
  const s = T.stats, cwd = T.meta.cwd || '';
  $('title').innerHTML = `${esc(T.chapters[0]?.title || 'session')}<small>${esc(cwd.split('/').pop())} · ${hhmm(T.meta.t0)} · ${dur(s.realMs)} real → ${mmss(s.playMs)} replay</small>`;
  document.title = `Theater — ${cwd.split('/').pop() || 'session'}`;
  $('stats').innerHTML = [[s.prompts, 'prompts'], [s.edits, 'edits', `+${s.add} −${s.del}`], [s.commands + s.checks, 'cmds'],
    s.checks && [s.passed, '✓', '', 'g'], s.failed && [s.failed, '✗', '', 'r'], s.agents && [s.agents, 'agents'], s.commits && [s.commits, 'commits']]
    .filter(Boolean).map(([n, l, x, c]) => `<span class="${c || ''}"><b>${n}</b> ${l}${x ? ' ' + x : ''}</span>`).join('');
  $('ticks').innerHTML = T.chapters.map(c => `<i style="left:${c.v / T.meta.dur * 100}%" title="${esc(c.title)}"></i>`).join('')
    + beats.filter(b => b.kind === 'commit').map(b => `<i class="c" style="left:${b.v / T.meta.dur * 100}%"></i>`).join('')
    + beats.filter(b => b.kind === 'check' && b.ok === false).map(b => `<i class="f" style="left:${b.v / T.meta.dur * 100}%"></i>`).join('');
}

async function boot() {
  try { T = await window.theater.timeline(); } catch (e) { $('title').textContent = 'Could not read session: ' + (e.message || e); return; }
  beats = T.beats;
  if (!beats.length) { $('title').textContent = 'Nothing to replay in this session.'; return; }
  header(); layoutRail(); wire(); setSpeed(4);
  seek(0); card(beats[0].kind === 'prompt' ? beats[0] : { ch: 0, title: T.chapters[0].title });
  holdUntil = performance.now() + 2200; setPlaying(true);
  requestAnimationFrame(frame);
  window.__theater = { seek: v => { setPlaying(false); $('card').classList.add('hidden'); seek(v); }, beat: i => window.__theater.seek(beats[i].v), card: i => card(beats[i]), pin, T };
}
boot();
