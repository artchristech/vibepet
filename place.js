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

// v: virtual window pos (layout with panels above); W×H: full window; petTop: Net's top inside that layout.
// Panels go on whichever side of Net has room (above unless below has more and above is cramped); the window is
// trimmed so it never crosses the menu bar or the Dock, and `room` is the panel height that actually fits.
const NEED = 360, FOOT = 40;   // panel height worth staying above for; hud pill + shadow under Net
function place(v, areas, W, petTop, H = petTop + PET_H + FOOT) {
  const a = areaFor({ x: v.x + W / 2, y: v.y + petTop + PET_H / 2 }, areas);
  const pS = v.y + petTop, above = pS - a.y, belowRoom = a.y + a.height - (pS + PET_H + FOOT);
  const x = Math.round(v.x);
  if (above >= NEED || above >= belowRoom) {
    const y = Math.max(a.y, v.y), top = pS - y;   // trimmed from the top: Net stays put, the panel area shrinks
    return { x, y: Math.round(y), h: Math.round(Math.min(H - (y - v.y), a.y + a.height - y)), below: false, room: Math.max(0, Math.round(top - 12)) };
  }
  const y = Math.max(a.y, pS), bottom = a.y + a.height;
  return { x, y: Math.round(y), h: Math.round(Math.min(H, bottom - y)), below: true, room: Math.max(0, Math.round(bottom - y - PET_H - FOOT - 12)) };
}

// lowest virtual y that still leaves Net fully under the menu bar (drag clamp, so the pet can't be lost upward)
const minY = (a, petTop) => a.y - petTop;

module.exports = { place, areaFor, minY, PET_H };
