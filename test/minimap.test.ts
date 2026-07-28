import assert from "node:assert/strict";
import type { GameMap } from "../src/map/gameMap.js";
import { MinimapCamera } from "../src/render/minimap.js";

const map = { width: 20, height: 10 } as unknown as GameMap;
const geo = {
  x0: 0,
  y0: 0,
  w: 180,
  h: 100,
  centerX: 90,
  centerY: 50,
  baseScale: 180 / 20,
};

const camera = new MinimapCamera(map);
camera.zoom = 2;
camera.panBy(90, 50, 1000, 50, geo, map);
assert.ok(
  camera.panQ === 5,
  `expected pan to clamp to the left edge for a rightward drag, got ${camera.panQ}`,
);

console.log("minimap tests passed");
