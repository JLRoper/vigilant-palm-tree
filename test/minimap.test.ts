import assert from "node:assert/strict";
import type { GameMap } from "../src/map/gameMap.js";
import { MinimapCamera, getFovFrameScreenPolygon, isPointInPolygon } from "../src/render/minimap.js";
import { getViewportAxialCorners, type Camera } from "../src/render/camera.js";
import { pixelToAxialExact } from "../src/core/hex.js";

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

// --- isPointInPolygon --------------------------------------------------

const square = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];
assert.ok(isPointInPolygon(5, 5, square), "expected center point to be inside the square");
assert.ok(!isPointInPolygon(15, 5, square), "expected point outside the square to be rejected");
assert.ok(!isPointInPolygon(-1, -1, square), "expected point outside the square to be rejected");

// --- getViewportAxialCorners --------------------------------------------

const mainCamera = { x: 0, y: 0, zoom: 1, dpr: 1 } as unknown as Camera;
const corners = getViewportAxialCorners(mainCamera, 200, 100);
assert.equal(corners.length, 4, "expected exactly 4 corners");
const expectedTopLeft = pixelToAxialExact(0, 0);
assert.ok(
  Math.abs(corners[0].q - expectedTopLeft.q) < 1e-9 && Math.abs(corners[0].r - expectedTopLeft.r) < 1e-9,
  "expected top-left corner to project through the unrounded pixel->axial formula",
);

// Moving the camera should shift every corner without changing the shape.
const panned = { x: -64, y: 0, zoom: 1, dpr: 1 } as unknown as Camera;
const pannedCorners = getViewportAxialCorners(panned, 200, 100);
assert.ok(
  pannedCorners[0].q > corners[0].q,
  "expected panning the camera left to shift the viewport's axial corners right",
);

// --- getFovFrameScreenPolygon (no rotation): drawing and hit-testing must agree ---

const minimapCamera = new MinimapCamera(map);
const framePolygon = getFovFrameScreenPolygon(mainCamera, minimapCamera, geo, 200, 100);
assert.equal(framePolygon.length, 4, "expected exactly 4 frame points");
const frameCenterX = framePolygon.reduce((sum, p) => sum + p.x, 0) / framePolygon.length;
const frameCenterY = framePolygon.reduce((sum, p) => sum + p.y, 0) / framePolygon.length;
assert.ok(
  isPointInPolygon(frameCenterX, frameCenterY, framePolygon),
  "expected the frame's own centroid to test as inside the frame",
);

console.log("minimap tests passed");
