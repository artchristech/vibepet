// node --test test/home-feedback.test.js — the renderer's feedback on Home: the CSS that keeps bubbles above the panel.
const test = require('node:test');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CSS = fs.readFileSync(path.join(ROOT, 'renderer', 'style.css'), 'utf8');

// ---------- CSS ----------
// rules as { media, sel: [selectors], decl: { prop: value } }; @media blocks one level deep
function rules(css) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  const walk = (s, media) => {
    let i = 0;
    while (i < s.length) {
      const open = s.indexOf('{', i); if (open < 0) break;
      const head = s.slice(i, open).trim();
      let depth = 1, j = open + 1;
      for (; j < s.length && depth; j++) depth += s[j] === '{' ? 1 : s[j] === '}' ? -1 : 0;
      const body = s.slice(open + 1, j - 1);
      if (head.startsWith('@media')) walk(body, head);
      else if (!head.startsWith('@')) out.push({ media: media || '', sel: head.split(',').map(x => x.trim()),
        decl: Object.fromEntries(body.split(';').map(d => d.split(/:(.*)/s).map(x => x && x.trim())).filter(d => d[0] && d[1] != null)) });
      i = j;
    }
  };
  walk(css);
  return out;
}
const R_ = rules(CSS), LIGHT = '@media (prefers-color-scheme: light)';
const value = (sel, prop, theme) => {   // the cascade's last word for one exact selector in a theme (light falls back to the base)
  const hit = R_.filter(r => r.sel.includes(sel) && prop in r.decl && (r.media === '' || (theme === 'light' && r.media === LIGHT)));
  return hit.length ? hit[hit.length - 1].decl[prop] : null;
};
const rgba = s => { const h = s.match(/^#([0-9a-f]{6})$/i); if (h) return [0, 2, 4].map(i => parseInt(h[1].slice(i, i + 2), 16)).concat(1);
  const m = s.match(/rgba?\(([^)]+)\)/); const p = m[1].split(',').map(Number); return [p[0], p[1], p[2], p[3] ?? 1]; };
const over = (fg, bg) => fg.slice(0, 3).map((c, i) => c * fg[3] + bg[i] * (1 - fg[3])).concat(1);
const lum = c => { const l = c.slice(0, 3).map(v => (v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2]; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('with Home open the bubble is a toast over the panel, pinned to its top edge and out of the flow', () => {
  const chatZ = +value('#chat', 'z-index');
  const toast = R_.find(r => r.sel.some(s => /#chat:not\(\.hidden\)\s*~\s*#bubble$/.test(s)) && r.decl.position);
  assert.ok(toast, 'a rule places the bubble while Home is open');
  assert.strictEqual(toast.decl.position, 'absolute');
  assert.ok(+toast.decl['z-index'] > chatZ, `toast z-index ${toast.decl['z-index']} over #chat's ${chatZ}`);
  assert.match(toast.decl.top, /anchor\(top\)/, 'pinned to the panel top');
});
