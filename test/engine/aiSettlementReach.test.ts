import { test } from "node:test";
import assert from "node:assert/strict";
import { GameMap, aiSettlementReachForMap } from "@heroes/engine";

// The settlement target band is derived from the map, not a hardcoded radius:
// its reach is the board's own hex diameter, so a settlement anywhere is a
// candidate. A fixed radius (8, sqrt-scaled by area) left the far corner of a
// medium board -- the sixth capital, 19-20 hexes away -- invisible.
test("aiSettlementReachForMap spans the map's hex diameter at every size tier", () => {
  assert.equal(aiSettlementReachForMap({ width: 24, height: 18 }), 40);
  assert.equal(aiSettlementReachForMap({ width: 36, height: 27 }), 61);
  assert.equal(aiSettlementReachForMap({ width: 72, height: 54 }), 124);
  assert.equal(aiSettlementReachForMap({ width: 120, height: 90 }), 208);
  assert.equal(aiSettlementReachForMap({ width: 300, height: 225 }), 523);
});

test("aiSettlementReachForMap reads a real GameMap's dimensions", () => {
  const small = new GameMap(1, "small");
  assert.equal(aiSettlementReachForMap(small), small.width + small.height - 2);
  const medium = new GameMap(1, "medium");
  assert.equal(aiSettlementReachForMap(medium), 61);
  // Every straight-line distance on a board is <= its diameter, so no
  // settlement on the map can sit outside the band.
  assert.ok(aiSettlementReachForMap(medium) >= Math.max(medium.width, medium.height));
});

test("aiSettlementReachForMap falls back to the default small dimensions when unset", () => {
  assert.equal(aiSettlementReachForMap({}), 40);
});
