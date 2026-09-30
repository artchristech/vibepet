// node test/place.test.js — panels go on the side of Net with room; the window never crosses the menu bar or the Dock
const assert = require('assert');
const { place, areaFor, minY, PET_H } = require('../place');
const W = 560, PT = 652, H = 900;
const main = { x: 0, y: 25, width: 1440, height: 800 };           // menu bar 25px, Dock below 825
const upper = { x: 200, y: -1080, width: 1920, height: 1055 };     // external display stacked above
const bottom = a => a.y + a.height;
const onScreen = (p, a) => p.y >= a.y && p.y + p.h <= bottom(a);

// Net low on the screen: panels above, window trimmed at the menu bar, Net's screen position unchanged
let p = place({ x: 100, y: -100 }, [main], W, PT, H);
assert.strictEqual(p.below, false); assert(onScreen(p, main)); assert.strictEqual(p.y + (PT - (p.y - -100)), -100 + PT);
assert(p.room >= 360);
// Net near the top: above is cramped, below has more → flip, and the room stops above the Dock
p = place({ x: 100, y: 60 - PT }, [main], W, PT, H);
assert.strictEqual(p.below, true); assert(onScreen(p, main)); assert.strictEqual(p.y, 60);
assert(p.y + PET_H + 40 + p.room <= bottom(main));
// Net mid-screen (the screenshot case): whichever side is bigger wins, never overflowing the Dock
p = place({ x: 100, y: 330 - PT }, [main], W, PT, H);
assert(onScreen(p, main)); assert(p.below ? p.y + PET_H + 40 + p.room <= bottom(main) : p.room <= 330 - main.y);
// clamped all the way up: Net just under the menu bar
p = place({ x: 100, y: minY(main, PT) }, [main], W, PT, H);
assert.strictEqual(p.below, true); assert.strictEqual(p.y, 25);
// multi-display: Net on the upper display uses that display's edges
assert.strictEqual(areaFor({ x: 800, y: -500 }, [main, upper]), upper);
p = place({ x: 600, y: -1000 }, [main, upper], W, PT, H);
assert(onScreen(p, upper));
assert.strictEqual(areaFor({ x: -500, y: 400 }, [main, upper]), main);
console.log('place: ok');
