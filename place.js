// Where the window actually goes for a wanted ("virtual") position. The window is tall (W×H) with Net at the
// bottom and the chat/bubble/roster reserved above him; macOS won't let a window's top go above the menu bar, so a
// plain setPosition stops Net ~petTop px below the top. Instead: while the virtual top fits, use it as is; once it
// would cross the work area's top, pin Net's own top (clamped to just under the menu bar) as the window top and flip
// the panels below him (`below`). Pure so it can be tested without Electron.
const PET_H = 208;

// work area containing p, else the nearest one (multi-display: each display has its own top)
function areaFor(p, areas) {
  let best = areas[0], bd = Infinity;
  for (const a of areas) {
    const dx = Math.max(a.x - p.x, 0, p.x - (a.x + a.width)), dy = Math.max(a.y - p.y, 0, p.y - (a.y + a.height)), d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = a; }
  }
  return best;
}

// v: virtual window pos (layout with panels above); W: window width; petTop: Net's top inside that layout
function place(v, areas, W, petTop) {
  const a = areaFor({ x: v.x + W / 2, y: v.y + petTop + PET_H / 2 }, areas);
  if (v.y >= a.y) return { x: Math.round(v.x), y: Math.round(v.y), below: false };
  return { x: Math.round(v.x), y: Math.round(Math.max(a.y, v.y + petTop)), below: true };
}

// lowest virtual y that still leaves Net fully under the menu bar (drag clamp, so the pet can't be lost upward)
const minY = (a, petTop) => a.y - petTop;

module.exports = { place, areaFor, minY, PET_H };
