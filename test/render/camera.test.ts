import { test } from "node:test";
import assert from "node:assert/strict";
import { Camera, getRowQBounds } from "../../src/render/camera";
import { HEX_SIZE } from "../../src/core/hex";

// F3 (the adventure map's camera can lose the map): repeated drags used to move
// the camera arbitrarily far outside the map's own extent, so the whole map left
// the viewport (mapTilesOnScreen 0) and the player stared at a black screen with
// no way back except a minimap click. The camera now clamps to the map's pixel
// extent on every pan/zoom/center, and stays correct at every zoom level because
// the extent is measured in world pixels and compared against viewport/zoom.
//
// These tests drive the real Camera the way AdventureView does: pan by drag
// deltas, zoom by wheel factors, and count the in-bounds tiles the renderer would
// actually paint.

const MAP_W = 40;
const MAP_H = 30;
const VIEWPORT_W = 1280;
const VIEWPORT_H = 800;

function countMapTilesOnScreen(camera: Camera): number {
  const bounds = camera.getVisibleAxialBounds(VIEWPORT_W, VIEWPORT_H, MAP_W, MAP_H, 0);
  let count = 0;
  for (let r = bounds.rMin; r <= bounds.rMax; r++) {
    const row = getRowQBounds(bounds, r);
    if (row.qMax >= row.qMin) count += row.qMax - row.qMin + 1;
  }
  return count;
}

test("F3: a fresh camera on a map larger than the viewport shows map tiles", () => {
  const camera = new Camera();
  camera.x = 0;
  camera.y = 0;
  camera.zoom = 1;
  camera.clampToMap(VIEWPORT_W, VIEWPORT_H, MAP_W, MAP_H);
  assert.ok(
    countMapTilesOnScreen(camera) > 0,
    "a clamped camera must always have at least one in-bounds tile on screen",
  );
});

test("F3: repeated drags in one direction cannot push the whole map off-screen", () => {
  const camera = new Camera();
  camera.x = 0;
  camera.y = 0;
  camera.zoom = 1;
  camera.clampToMap(VIEWPORT_W, VIEWPORT_H, MAP_W, MAP_H);

  // 40 drags of 400px each = 16,000px of pan: far past the map's ~3,900px width.
  for (let i = 0; i < 40; i++) {
    camera.pan(-400, -400);
    camera.clampToMap(VIEWPORT_W, VIEWPORT_H, MAP_W, MAP_H);
  }
  const tiles = countMapTilesOnScreen(camera);
  assert.ok(tiles > 0, `after 40 drags the map must still be on screen, saw ${tiles} tiles`);
});

test("F3: the clamp holds at every zoom level", () => {
  for (const zoom of [0.25, 0.5, 1, 2, 3]) {
    const camera = new Camera();
    camera.zoom = zoom;
    camera.x = 0;
    camera.y = 0;
    camera.clampToMap(VIEWPORT_W, VIEWPORT_H, MAP_W, MAP_H);
    for (let i = 0; i < 25; i++) {
      camera.pan(i % 2 === 0 ? 5000 : -5000, 3000);
      camera.clampToMap(VIEWPORT_W, VIEWPORT_H, MAP_W, MAP_H);
      assert.ok(
        countMapTilesOnScreen(camera) > 0,
        `zoom ${zoom}, drag ${i}: the map left the viewport`,
      );
    }
  }
});

test("F3: when the whole map fits at the current zoom, the clamp centres it", () => {
  // At zoom 0.25 the 40x30 map is ~1,300 world px wide -> ~325 screen px, well
  // inside the 1280px viewport. The clamp must centre rather than pin an edge.
  const camera = new Camera();
  camera.zoom = 0.25;
  camera.x = -99999;
  camera.y = -99999;
  const moved = camera.clampToMap(VIEWPORT_W, VIEWPORT_H, MAP_W, MAP_H);
  assert.equal(moved, true, "an off-map camera is reported as moved");

  const bounds = camera.getVisibleAxialBounds(VIEWPORT_W, VIEWPORT_H, MAP_W, MAP_H, 0);
  assert.equal(bounds.qMin, 0, "the whole map's first column is on screen");
  assert.equal(bounds.qMax, MAP_W - 1, "and its last");
  assert.equal(bounds.rMin, 0);
  assert.equal(bounds.rMax, MAP_H - 1);

  // The map's pixel centre should sit at the viewport's centre.
  const minX = -HEX_SIZE * Math.sqrt(3) / 2;
  const maxX = HEX_SIZE * Math.sqrt(3) * (MAP_W - 1 + (MAP_H - 1) / 2) + HEX_SIZE * Math.sqrt(3) / 2;
  const centreScreenX = ((minX + maxX) / 2) * camera.zoom + camera.x;
  assert.ok(
    Math.abs(centreScreenX - VIEWPORT_W / 2) < 1e-6,
    `the map is centred horizontally, got ${centreScreenX}`,
  );
});

test("F3: an in-bounds camera is left untouched and reported as unchanged", () => {
  const camera = new Camera();
  camera.zoom = 1;
  camera.x = -1200;
  camera.y = -300;
  const moved = camera.clampToMap(VIEWPORT_W, VIEWPORT_H, MAP_W, MAP_H);
  assert.equal(moved, false, "a camera already inside the bounds is not moved");
  assert.equal(camera.x, -1200);
  assert.equal(camera.y, -300);
});
