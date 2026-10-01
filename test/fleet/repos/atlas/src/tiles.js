// Tile math used by the renderer.
exports.tileCount = (zoom) => 4 ** zoom;
exports.tileKey = (z, x, y) => `${z}/${x}/${y}`;
