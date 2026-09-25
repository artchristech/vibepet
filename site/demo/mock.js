// Scripted stand-in for the Electron bridge so the real renderer runs in a browser.
(() => {
  const L = {};
  const fire = (ch, d) => (L[ch] || []).forEach(cb => cb(d));
  const now = () => Date.now();
  const S = {
    name: 'Net', level: 3, xp: 300, xpLo: 160, xpHi: 360, fuel: 38, mood: 72, commits: 41, quickDraws: 9, streak: 6,
    agents: [], hasKey: true, muted: true, hour: 15, watching: 'auto',
    git: { root: '/demo', name: 'my-saas', branch: 'main', lines: 62, files: 3, untracked: 1, lastCommitAt: now() - 38 * 60e3, lastSubject: 'feat: stripe webhooks' },
  };
  const tick = () => fire('tick', JSON.parse(JSON.stringify(S)));
  const agent = phase => { S.agents = phase ? [{ name: 'my-saas', phase, since: now() }] : []; tick(); };

  const script = [
    [1500, () => agent('working')],
    [4000, () => { S.git.lines = 180; S.git.files = 5; tick(); }],
    [4000, () => { S.git.lines = 470; S.git.files = 8; tick(); fire('event', { kind: 'nervous', text: '470 lines uncommitted in my-saas… save point?' }); }],
    [3500, () => { agent('waiting'); fire('event', { kind: 'agentDone', text: 'my-saas finished — your move!' }); }],
    [6500, () => { agent('working'); fire('event', { kind: 'quick', text: 'Quick draw! Replied to my-saas in 6s. +4xp' }); S.xp += 4; }],
    [5000, () => { agent('stalled'); fire('event', { kind: 'agentStalled', text: 'my-saas has gone quiet on a tool call. Needs your approval?' }); }],
    [5000, () => agent('working')],
    [3500, () => {
      S.fuel = Math.min(100, S.fuel + 30); S.commits++; S.git.lines = 0; S.git.files = 0; S.git.lastCommitAt = now(); S.git.lastSubject = 'feat: usage-based billing';
      agent(null); fire('event', { kind: 'commit', text: 'nom! "feat: usage-based billing" +29xp' });
      S.xp += 29; if (S.xp >= S.xpHi) setTimeout(() => { S.level = 4; S.xpLo = 360; S.xpHi = 640; tick(); fire('event', { kind: 'levelup', text: 'LEVEL 4! unlocked: headphones' }); }, 3600);
    }],
    [9000, () => { if (S.level > 3) { S.level = 3; S.xp = 300; S.xpLo = 160; S.xpHi = 360; } S.fuel = 38; tick(); }],
  ];
  let i = 0;
  const step = () => { const [ms, fn] = script[i]; setTimeout(() => { fn(); i = (i + 1) % script.length; step(); }, ms); };

  const REPLIES = {
    commit: '```text\nfeat(billing): usage-based pricing via Stripe meters\n\n- add meter events on every API call\n- invoice.upcoming webhook updates plan preview\n- migrate 3 legacy plans to metered prices\n```',
    vibe: '470 lines across 8 files, 38 min since your last commit, and the agent just touched `webhooks.ts`. Read that one file, then commit before the next prompt. *nervous wiggle*',
    agent: 'It finished wiring Stripe meter events and is asking whether to backfill old invoices. That\'s a yes/no from you. Answer it.',
    next: 'Commit, then paste: "add an idempotency key to the meter event call and a test that replays the same webhook twice." Double-billing is the scary bug here.',
  };
  window.pet = {
    on: (ch, cb) => { (L[ch] ||= []).push(cb); if (ch === 'tick' && !L._booted) { L._booted = 1; setTimeout(() => { tick(); step(); }, 400); } },
    setIgnore() {}, dragStart() {}, dragEnd() {}, focus() {}, pet() {},
    menu() { fire('event', { kind: 'snackNo', text: 'right-click menu lives in the real app ✨ download me!' }); },
    copy: t => navigator.clipboard?.writeText(t).catch(() => {}),
    rename: n => { S.name = n; tick(); },
    setKey: async () => true,
    chat: async ({ mode, messages }) => {
      await new Promise(r => setTimeout(r, 900));
      if (REPLIES[mode]) return { text: REPLIES[mode] };
      return { text: pick(['in the real app I\'d answer with your actual repo + agent context. here I\'m just a demo 🥲', 'download me and ask again — I\'ll see your real diff.']) };
    },
  };
  const pick = a => a[Math.floor(Math.random() * a.length)];

  // cursor from the parent page, so eyes follow you across the whole site
  addEventListener('message', e => { if (e.data?.cursor) fire('cursor', e.data.cursor); });
  addEventListener('mousemove', e => fire('cursor', { x: e.clientX, y: e.clientY }));
  addEventListener('pointerdown', () => { if (S.muted) { S.muted = false; tick(); } }, { once: true });
})();
