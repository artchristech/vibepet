// node test/place.test.js — window placement near the top of the screen, single + multi display
const assert = require('assert');
const { place, areaFor, minY } = require('../place');
const W = 360, PT = 276;
const main = { x: 0, y: 25, width: 1440, height: 875 };           // menu bar 25px
const upper = { x: 200, y: -1080, width: 1920, height: 1055 };     // external display stacked above (its own menu bar)

// normal: fits → unchanged, panels above
assert.deepStrictEqual(place({ x: 100, y: 300 }, [main], W, PT), { x: 100, y: 300, below: false });
assert.deepStrictEqual(place({ x: 100, y: 25 }, [main], W, PT), { x: 100, y: 25, below: false });
// would cross the top → flip; Net's top lands where the virtual layout put it
assert.deepStrictEqual(place({ x: 100, y: -100 }, [main], W, PT), { x: 100, y: 176, below: true });
// all the way up: Net's top pinned just under the menu bar, never above it
assert.deepStrictEqual(place({ x: 100, y: minY(main, PT) }, [main], W, PT), { x: 100, y: 25, below: true });
assert.deepStrictEqual(place({ x: 100, y: -900 }, [main], W, PT).y, 25);
// multi-display: Net on the upper display uses that display's top, not the primary's
assert.strictEqual(areaFor({ x: 800, y: -500 }, [main, upper]), upper);
assert.deepStrictEqual(place({ x: 600, y: -1000 }, [main, upper], W, PT), { x: 600, y: -1000, below: false });
assert.deepStrictEqual(place({ x: 600, y: -1200 }, [main, upper], W, PT), { x: 600, y: -924, below: true });
// Net near the top of the lower display while the virtual window overlaps the upper one: still flips against main
assert.deepStrictEqual(place({ x: 100, y: -150 }, [main, upper], W, PT), { x: 100, y: 126, below: true });
// off every display: nearest area
assert.strictEqual(areaFor({ x: -500, y: 400 }, [main, upper]), main);
console.log('place: ok');
