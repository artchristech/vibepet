// hidden recorder window: screen → MediaRecorder (5s chunks to main, so a crash keeps footage) and the PNG cards
// the renderer overlays. Lives in its own process so Net's canvas never shares a thread with the encoder.
let mr = null, stream = null, seq = 0, pending = Promise.resolve();

rec.on('start', async ({ sourceId, width, height, fps = 30 }) => {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: {
      chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId, maxWidth: width, maxHeight: height, minWidth: width, minHeight: height, maxFrameRate: fps } } });
    // H.264 first: hardware encode now, hardware decode at cut time. A keyframe every 2s keeps every seek cheap
    const mime = ['video/webm;codecs=h264', 'video/webm;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(m => MediaRecorder.isTypeSupported(m));
    mr = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12e6, videoKeyFrameIntervalDuration: 2000 });
    mr.ondataavailable = e => { if (!e.data.size) return; const n = seq++; pending = pending.then(async () => rec.chunk(new Uint8Array(await e.data.arrayBuffer()), n)); };
    mr.onstop = () => pending.then(() => { stream.getTracks().forEach(t => t.stop()); rec.stopped({ chunks: seq }); mr = null; });
    mr.start(5000);
    const s = stream.getVideoTracks()[0].getSettings();
    rec.started({ at: Date.now(), width: s.width, height: s.height, fps: s.frameRate, mime });
  } catch (e) { rec.failed(String(e?.message || e)); }
});
rec.on('stop', () => { if (mr && mr.state !== 'inactive') mr.stop(); else rec.stopped({ chunks: seq }); });

// ---------- cards ----------
const MONO = '"SF Mono", SFMono-Regular, Menlo, monospace', SANS = '-apple-system, "SF Pro Display", Helvetica, sans-serif';
function wrap(ctx, text, maxW) {
  const words = text.split(' '), lines = [];
  let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur);
  return lines;
}
const png = async c => new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }

// the prompt card: a terminal pane that types the prompt out (15 fps, ~1.4s), then holds with a blinking-free block cursor
async function promptFrames(text, project) {
  const c = new OffscreenCanvas(1000, 300), ctx = c.getContext('2d');
  ctx.font = `600 38px ${MONO}`;
  const lines = wrap(ctx, '> ' + text, 900).slice(0, 5);
  const h = 96 + lines.length * 50;
  c.height = h;
  const full = lines.join('\n'), steps = 21, frames = [];
  for (let k = 1; k <= steps; k++) {
    const n = Math.round(full.length * k / steps);
    ctx.clearRect(0, 0, 1000, h);
    ctx.fillStyle = 'rgba(14,15,20,0.92)'; roundRect(ctx, 0, 0, 1000, h, 28); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 2; ctx.stroke();
    ['#ff5f57', '#febc2e', '#28c840'].forEach((col, j) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(40 + j * 30, 36, 9, 0, 7); ctx.fill(); });
    ctx.font = `500 24px ${MONO}`; ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.fillText(project ? `claude · ${project}` : 'claude', 140, 44);
    ctx.font = `600 38px ${MONO}`;
    let left = n, y = 110;
    for (const [li, line] of lines.entries()) {
      const shown = line.slice(0, Math.max(0, left)); left -= line.length + 1;
      ctx.fillStyle = li === 0 ? '#7ef0c1' : '#e8ecf5';
      if (li === 0 && shown.startsWith('> ')) { ctx.fillText('>', 50, y); ctx.fillStyle = '#e8ecf5'; ctx.fillText(shown.slice(1), 50 + ctx.measureText('>').width, y); }
      else ctx.fillText(shown, 50, y);
      if (left < 0 || li === lines.length - 1) { ctx.fillStyle = '#7ef0c1'; ctx.fillRect(50 + ctx.measureText(shown).width + 4, y - 32, 20, 40); break; }
      y += 50;
    }
    frames.push(await png(c));
  }
  return frames;
}

// the hook title: full-frame, big type on a dark scrim (overlaid for the first 2s)
async function titleFrame(hook, sub) {
  const c = new OffscreenCanvas(1080, 1920), ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(8,9,12,0.72)'; ctx.fillRect(0, 0, 1080, 1920);
  ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.font = `800 92px ${SANS}`;
  const lines = wrap(ctx, hook, 940).slice(0, 4);
  let y = 960 - (lines.length - 1) * 55;
  for (const l of lines) { ctx.fillText(l, 540, y); y += 110; }
  if (sub) { ctx.font = `600 40px ${MONO}`; ctx.fillStyle = '#7ef0c1'; ctx.fillText(sub, 540, y + 20); }
  return [await png(c)];
}

rec.on('cards', async ({ id, kind, text, project, sub }) => {
  try { rec.cards(id, kind === 'title' ? await titleFrame(text, sub) : await promptFrames(text, project)); }
  catch (e) { rec.cards(id, null); }
});
