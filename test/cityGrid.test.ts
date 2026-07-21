import assert from "node:assert/strict";
import {
  TILE_W,
  TILE_D,
  cityViewSizeFor,
  cellOrigin,
  cellToScreen,
  screenToCell,
  cellAt,
  cellCorners,
  cellsInDrawOrder,
  type CityCell,
} from "../src/core/cityGrid.js";

let n = 0;
function check(cond: unknown, msg: string) {
  assert.ok(cond, msg);
  n++;
}

// Constants
check(TILE_W === 96, "TILE_W should be 96");
check(TILE_D === 48, "TILE_D should be 48");

// Tier sizing
check(cityViewSizeFor(1) === 5, "cityViewSizeFor(1) === 5");
check(cityViewSizeFor(2) === 10, "cityViewSizeFor(2) === 10");
check(cityViewSizeFor(3) === 15, "cityViewSizeFor(3) === 15");

// cellOrigin
check(JSON.stringify(cellOrigin(5)) === JSON.stringify({ x: 2, y: 2 }), "cellOrigin(5) === {2,2}");
check(
  JSON.stringify(cellOrigin(10)) === JSON.stringify({ x: 4.5, y: 4.5 }),
  "cellOrigin(10) === {4.5,4.5}",
);
check(
  JSON.stringify(cellOrigin(15)) === JSON.stringify({ x: 7, y: 7 }),
  "cellOrigin(15) === {7,7}",
);

// cellToScreen
const o = { x: 0, y: 0 };
check(
  JSON.stringify(cellToScreen(2, 2, o)) === JSON.stringify({ x: 0, y: 96 }),
  "cellToScreen(2,2) at origin(0,0) === {0,96}",
);
check(
  JSON.stringify(cellToScreen(0, 0, o)) === JSON.stringify({ x: 0, y: 0 }),
  "cellToScreen(0,0) at origin(0,0) === {0,0}",
);
check(
  JSON.stringify(cellToScreen(4, 0, o)) === JSON.stringify({ x: 192, y: 96 }),
  "cellToScreen(4,0) at origin(0,0) === {192,96}",
);
check(
  JSON.stringify(cellToScreen(0, 4, o)) === JSON.stringify({ x: -192, y: 96 }),
  "cellToScreen(0,4) at origin(0,0) === {-192,96}",
);
check(
  JSON.stringify(cellToScreen(2, 2, { x: 100, y: 50 })) ===
    JSON.stringify({ x: 100, y: 146 }),
  "cellToScreen(2,2) at origin(100,50) === {100,146}",
);

// screenToCell
check(
  JSON.stringify(screenToCell(0, 0, o)) === JSON.stringify({ gx: 0, gy: 0 }),
  "screenToCell(0,0) at origin(0,0) === {0,0}",
);
check(
  JSON.stringify(screenToCell(192, 96, o)) === JSON.stringify({ gx: 4, gy: 0 }),
  "screenToCell(192,96) at origin(0,0) === {4,0}",
);

// Round-trip for all 25 cells in a 5x5 grid
const center5 = cellOrigin(5);
const cells5 = cellsInDrawOrder(5);
for (const cell of cells5) {
  const s = cellToScreen(cell.gx, cell.gy, center5);
  const back = screenToCell(s.x, s.y, center5);
  check(back.gx === cell.gx && back.gy === cell.gy, `round-trip for (${cell.gx},${cell.gy})`);
}

// Round-trip for 10x10 and 15x15 too
for (const size of [10, 15] as const) {
  const origin = cellOrigin(size);
  for (let gx = 0; gx < size; gx++) {
    for (let gy = 0; gy < size; gy++) {
      const s = cellToScreen(gx, gy, origin);
      const back = screenToCell(s.x, s.y, origin);
      check(back.gx === gx && back.gy === gy, `round-trip ${size}x${size} (${gx},${gy})`);
    }
  }
}

// cellAt
check(
  JSON.stringify(cellAt(0, 0, o, 5)) === JSON.stringify({ gx: 0, gy: 0 }),
  "cellAt(0,0) in 5x5 === {0,0}",
);
check(cellAt(-1, -1, o, 5) === null, "cellAt(-1,-1) in 5x5 === null");
check(cellAt(-48, -24, o, 5) === null, "cellAt outside left/top of 5x5 === null");
check(
  JSON.stringify(cellAt(0, 0, o, 5)) === JSON.stringify({ gx: 0, gy: 0 }),
  "cellAt(0,0) at origin(0,0) === {0,0}",
);

// cellCorners(2,2) at origin(0,0)
const corners = cellCorners(2, 2, o);
check(corners.length === 4, "cellCorners returns 4 points");
const ys = corners.map((c) => c.y);
const xs = corners.map((c) => c.x);
const topY = Math.min(...ys);
const botY = Math.max(...ys);
const leftX = Math.min(...xs);
const rightX = Math.max(...xs);
check(topY === 72, `topmost y === 72 (got ${topY})`);
check(botY === 120, `bottommost y === 120 (got ${botY})`);
check(leftX === -48, `leftmost x === -48 (got ${leftX})`);
check(rightX === 48, `rightmost x === 48 (got ${rightX})`);
check(botY - topY === TILE_D, `vertical span === TILE_D`);
check(rightX - leftX === TILE_W, `horizontal span === TILE_W`);

// First corner is top
check(corners[0].y === topY, "first corner is the top corner (smallest y)");
// Corners go clockwise: top -> right -> bottom -> left
check(corners[1].x === rightX, "second corner is the right corner (largest x)");
check(corners[2].y === botY, "third corner is the bottom corner (largest y)");
check(corners[3].x === leftX, "fourth corner is the left corner (smallest x)");

// cellsInDrawOrder
check(cells5.length === 25, "cellsInDrawOrder(5) has 25 entries");
check(cells5[0].gx === 0 && cells5[0].gy === 0, "first cell is (0,0)");

for (let i = 1; i < cells5.length; i++) {
  const a = cells5[i - 1];
  const b = cells5[i];
  const sa = a.gx + a.gy;
  const sb = b.gx + b.gy;
  if (sa === sb) {
    check(a.gx < b.gx, `tie-break gx asc at index ${i}`);
  } else {
    check(sa < sb, `gx+gy asc at index ${i} (${sa} < ${sb})`);
  }
}

const cellSet = new Set(cells5.map((c: CityCell) => `${c.gx},${c.gy}`));
check(cellSet.size === 25, "all 25 cells unique in draw order");

// Draw order is deterministic (same call returns same sequence)
const again = cellsInDrawOrder(5);
check(JSON.stringify(again) === JSON.stringify(cells5), "cellsInDrawOrder is deterministic");

console.log(">> cityGrid tests passed:", n);
