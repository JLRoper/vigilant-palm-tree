// The district road as a per-tile graph (src/render/scene/roadGraph.ts).
//
// These are the properties the painter leans on and that a regression would
// break silently -- a mask that draws nothing, a piece that leaves its hex, a
// tangent that is not perpendicular at a shared edge (which IS the seam), a
// branch that floats off the through-path, or a width mapping that drifts back
// into the sub-pixel range both 2026-11-03 study cards measured.

import { test } from "node:test";
import assert from "node:assert/strict";
import { HEX_SIZE, axialToPixel } from "../../src/core/hex";
import { NEIGHBOR_DIRS } from "@heroes/engine";
import {
  ROAD_CASING_PER_SIDE,
  ROAD_EDGE_DIRS,
  ROAD_EDGE_DIST,
  ROAD_WIDTH_BASE,
  ROAD_WIDTH_MAX,
  ROAD_WIDTH_PER_STRAND,
  roadEdgeIndex,
  roadEdgeOffset,
  roadEdgeSeparationDeg,
  roadCubicAt,
  roadGeometryFor,
  roadMaskEdges,
  roadPairEdges,
  roadWidthForStrands,
} from "../../src/render/scene/roadGraph";

test("roadGraph: the edge order is the engine's NEIGHBOR_DIRS, element for element", () => {
  assert.equal(ROAD_EDGE_DIRS.length, NEIGHBOR_DIRS.length);
  for (let i = 0; i < ROAD_EDGE_DIRS.length; i++) {
    assert.deepEqual(
      [ROAD_EDGE_DIRS[i][0], ROAD_EDGE_DIRS[i][1]],
      [NEIGHBOR_DIRS[i].q, NEIGHBOR_DIRS[i].r],
      `edge ${i} must face the same neighbour the engine's adjacency means by ${i}`,
    );
  }
});

test("roadGraph: an edge midpoint is the midpoint of the two tile centres, at half the pitch", () => {
  const centre = axialToPixel(7, 5);
  for (let i = 0; i < 6; i++) {
    const d = ROAD_EDGE_DIRS[i];
    const neighbour = axialToPixel(7 + d[0], 5 + d[1]);
    const offset = roadEdgeOffset(i);
    const mid = { x: centre.x + offset.x, y: centre.y + offset.y };
    assert.ok(Math.abs(mid.x - (centre.x + neighbour.x) / 2) < 1e-9);
    assert.ok(Math.abs(mid.y - (centre.y + neighbour.y) / 2) < 1e-9);
    assert.ok(Math.abs(Math.hypot(offset.x, offset.y) - ROAD_EDGE_DIST) < 1e-9);
  }
  assert.ok(Math.abs(ROAD_EDGE_DIST - (HEX_SIZE * Math.sqrt(3)) / 2) < 1e-9);
});

test("roadGraph: roadEdgeIndex round-trips every direction and refuses a non-neighbour", () => {
  const from = { q: 4, r: 9 };
  for (let i = 0; i < 6; i++) {
    const to = { q: from.q + ROAD_EDGE_DIRS[i][0], r: from.r + ROAD_EDGE_DIRS[i][1] };
    assert.equal(roadEdgeIndex(from, to), i);
    assert.equal(roadEdgeIndex(to, from), (i + 3) % 6, "the other side of the same edge is opposite");
  }
  assert.equal(roadEdgeIndex(from, { q: 6, r: 9 }), -1);
  assert.equal(roadEdgeIndex(from, from), -1);
});

test("roadGraph: separations are 60, 120 or 180, measured off the projection", () => {
  for (let a = 0; a < 6; a++) {
    assert.equal(roadEdgeSeparationDeg(a, a), 0);
    assert.equal(roadEdgeSeparationDeg(a, (a + 3) % 6), 180);
  }
  for (const [a, b] of [[0, 1], [0, 5], [3, 2], [3, 4]]) {
    assert.ok(Math.abs(roadEdgeSeparationDeg(a, b) - 60) < 1e-9, `${a},${b} is 60 apart`);
  }
  for (const [a, b] of [[0, 2], [1, 3], [2, 4], [3, 5], [4, 0], [5, 1]]) {
    assert.ok(Math.abs(roadEdgeSeparationDeg(a, b) - 120) < 1e-9, `${a},${b} is 120 apart`);
  }
});

test("roadGraph: pairing takes the widest separation first and leaves the odd edge out", () => {
  assert.deepEqual(roadPairEdges([0, 3]), { pairs: [{ a: 0, b: 3 }], leftover: [] });
  // 3 edges with an opposite pair -> the opposite pair is the through-path.
  assert.deepEqual(roadPairEdges([0, 1, 3]), { pairs: [{ a: 0, b: 3 }], leftover: [1] });
  // 3 edges with no opposite pair: every candidate is 120, so the lowest pair wins.
  assert.deepEqual(roadPairEdges([0, 1, 2]), { pairs: [{ a: 0, b: 2 }], leftover: [1] });
  // 4 edges: two opposite pairs, no leftover.
  assert.deepEqual(roadPairEdges([0, 2, 3, 5]), {
    pairs: [{ a: 0, b: 3 }, { a: 2, b: 5 }],
    leftover: [],
  });
  assert.deepEqual(roadPairEdges([0]), { pairs: [], leftover: [0] });
  assert.deepEqual(roadPairEdges([]), { pairs: [], leftover: [] });
});

test("roadGraph: the mask census -- every mask with a bit draws, mask 0 draws nothing", () => {
  let empty = 0;
  for (let mask = 0; mask < 64; mask++) {
    const geometry = roadGeometryFor(mask);
    if (mask === 0) {
      assert.equal(geometry.pieces.length, 0, "an unset mask is no road");
      assert.equal(geometry.junctions.length, 0);
      empty++;
      continue;
    }
    assert.ok(geometry.pieces.length > 0, `mask ${mask} drew nothing`);
    // THE CENSUS. A mask with k edges connected draws exactly k pieces: one per
    // edge, because a pair is two halves and a leftover is one spur. Stolen from
    // the losing edge-mask-tileset idea, whose prototype pinned a census
    // (`none 1, stub 6, straight 3, corner 12, tee 20, crossing 22`) so that a
    // geometry change which reclassified a mask THREW instead of just looking
    // subtly wrong. This is the shape that survives the tile-per-mask rewrite.
    assert.equal(
      geometry.pieces.length,
      roadMaskEdges(mask).length,
      `mask ${mask} drew ${geometry.pieces.length} pieces for ${roadMaskEdges(mask).length} edges`,
    );
    // every set edge is carried by at least one piece that STARTS on it
    for (const edge of roadMaskEdges(mask)) {
      assert.ok(
        geometry.pieces.some((p) => p.edge === edge),
        `mask ${mask}: edge ${edge} is set but no piece leaves it`,
      );
    }
    // and a junction pad only exists for a genuine branch
    if (geometry.junctions.length > 0) {
      assert.ok(roadMaskEdges(mask).length >= 3, `mask ${mask} padded a 2-edge tile`);
    }
    // a piece is either a real cubic (4 control points) or a two-point spur
    for (const piece of geometry.pieces) {
      assert.ok(
        piece.points.length === 4 || piece.points.length === 2,
        `mask ${mask}: a ${piece.kind} piece has ${piece.points.length} points`,
      );
      assert.equal(piece.points.length === 4, piece.kind === "through");
    }
  }
  assert.equal(empty, 1);
});

test("roadGraph: no piece ever leaves its hex -- every point is inside the hex radius", () => {
  for (let mask = 1; mask < 64; mask++) {
    const geometry = roadGeometryFor(mask);
    for (const piece of geometry.pieces) {
      for (const p of piece.points) {
        assert.ok(
          Math.hypot(p.x, p.y) <= HEX_SIZE + 1e-9,
          `mask ${mask}: a point sits at ${Math.hypot(p.x, p.y).toFixed(3)} (hex radius ${HEX_SIZE})`,
        );
      }
    }
    for (const j of geometry.junctions) {
      assert.ok(Math.hypot(j.x, j.y) <= HEX_SIZE + 1e-9, `mask ${mask}: a junction sits outside the hex`);
    }
  }
});

test("roadGraph: every piece meets its edge PERPENDICULAR -- this is what welds two tiles", () => {
  // Both tiles either side of a shared edge compute the same inward radius at
  // that edge's midpoint, so a piece that leaves perpendicular on one side meets
  // a piece that leaves perpendicular on the other with zero kink, whatever
  // either tile's mask is. What "perpendicular" means here, on the EXACT control
  // points (not on a sampled polyline, whose first chord lags its own tangent):
  // a piece starting on edge i runs along the INWARD radius (-unit_i) at that
  // end, and a piece arriving on edge i runs along the OUTWARD radius (+unit_i).
  //
  // The branch arm is the case that is easy to get wrong: a stub pointed at
  // "the nearest point of the through-path" leaves at whatever angle crosses the
  // trunk, measured 29.46 deg off the radius on a true T. Welding it where its
  // own radius crosses the trunk is what makes this hold for all 64 masks.
  let worstCos = 1;
  for (let mask = 1; mask < 64; mask++) {
    const geometry = roadGeometryFor(mask);
    for (let i = 0; i < 6; i++) {
      if (!(mask & (1 << i))) continue;
      const mid = roadEdgeOffset(i);
      const unit = { x: mid.x / ROAD_EDGE_DIST, y: mid.y / ROAD_EDGE_DIST };
      let sawStart = false;
      let sawEnd = false;
      for (const piece of geometry.pieces) {
        const p0 = piece.points[0];
        const p1 = piece.points[1];
        const pn = piece.points[piece.points.length - 1];
        const pn1 = piece.points[piece.points.length - 2];
        if (Math.hypot(p0.x - mid.x, p0.y - mid.y) < 1e-9) {
          sawStart = true;
          const dx = p1.x - p0.x;
          const dy = p1.y - p0.y;
          const dot = (dx * -unit.x + dy * -unit.y) / Math.hypot(dx, dy);
          worstCos = Math.min(worstCos, dot);
          assert.ok(
            dot > 1 - 1e-12,
            `mask ${mask} edge ${i}: leaves at cos=${dot} off the inward radius (a kink at the seam)`,
          );
        }
        if (Math.hypot(pn.x - mid.x, pn.y - mid.y) < 1e-9) {
          sawEnd = true;
          const dx = pn.x - pn1.x;
          const dy = pn.y - pn1.y;
          const dot = (dx * unit.x + dy * unit.y) / Math.hypot(dx, dy);
          worstCos = Math.min(worstCos, dot);
          assert.ok(dot > 1 - 1e-12, `mask ${mask} edge ${i}: arrives at cos=${dot} off the outward radius`);
        }
      }
      assert.ok(sawStart || sawEnd, `mask ${mask}: edge ${i} is set but no piece touches its midpoint`);
    }
  }
  assert.ok(worstCos > 1 - 1e-12, `worst perpendicularity across all 64 masks is cos=${worstCos}`);
});

test("roadGraph: two tiles either side of a shared edge stroke the SAME point and direction", () => {
  // The seam, end to end: for every edge of every mask, the point a tile's piece
  // ends on and the point its neighbour's piece starts on must be the same world
  // point (each tile's own edge midpoint), and the two tangents must be the same
  // line. That is what "tangent-continuous" means, and it is what makes the road
  // read as one road rather than two tiles butted together.
  const centre = { x: 123.5, y: -77.25 };
  const neighbourCentre = (i: number) => {
    const d = ROAD_EDGE_DIRS[i];
    return { x: centre.x + d[0] * ROAD_EDGE_DIST * 2, y: centre.y + d[1] * ROAD_EDGE_DIST * 2 };
  };
  for (let mask = 1; mask < 64; mask++) {
    for (const i of roadMaskEdges(mask)) {
      const opposite = (i + 3) % 6;
      const here = roadGeometryFor(mask).pieces.filter((p) => p.points.length === 4 && p.edge === i).pop();
      const there = roadGeometryFor(1 << opposite)
        .pieces.filter((p) => p.points.length === 4)
        .pop();
      if (!here || !there) continue; // a leaf side has a spur, covered elsewhere
      const [h0, h1, , h3] = here.points as readonly [RoadPointT, RoadPointT, RoadPointT, RoadPointT];
      const [t0, t1] = there.points as readonly [RoadPointT, RoadPointT];
      // here ends at the edge midpoint nearest its neighbour, there starts on it
      const hereEnd = Math.hypot(h3.x - h0.x, h3.y - h0.y) > 0 ? h3 : h0;
      const hereTangent = h3 === hereEnd ? { x: h3.x - h1.x, y: h3.y - h1.y } : { x: h1.x - h0.x, y: h1.y - h0.y };
      const hereWorld = { x: centre.x + hereEnd.x, y: centre.y + hereEnd.y };
      const thereWorld = { x: neighbourCentre(opposite).x + t0.x, y: neighbourCentre(opposite).y + t0.y };
      assert.ok(
        Math.hypot(hereWorld.x - thereWorld.x, hereWorld.y - thereWorld.y) < 1e-9,
        `mask ${mask} edge ${i}: the two tiles stroke different seam points`,
      );
      const thereTangent = { x: t1.x - t0.x, y: t1.y - t0.y };
      const cross = hereTangent.x * thereTangent.y - hereTangent.y * thereTangent.x;
      const dot = hereTangent.x * thereTangent.x + hereTangent.y * thereTangent.y;
      const kinkDeg = (Math.atan2(Math.abs(cross), dot) * 180) / Math.PI;
      assert.ok(kinkDeg < 1e-9, `mask ${mask} edge ${i}: the seam kinks by ${kinkDeg.toFixed(6)} deg`);
      break; // one shared edge per mask is enough; the perpendicular test covers all of them
    }
  }
});
type RoadPointT = { x: number; y: number };

test("roadGraph: an odd edge out is WELDED to the through-path, never left floating", () => {
  // The prototype's worst floating stub (variant B) is mask 011100. Variant C
  // -- what landed -- ends the spur on the through-path instead.
  for (let mask = 1; mask < 64; mask++) {
    const edges = roadMaskEdges(mask);
    if (edges.length < 3) continue;
    const geometry = roadGeometryFor(mask);
    for (const spur of geometry.pieces.filter((p) => p.kind === "spur")) {
      const end = spur.points[spur.points.length - 1];
      let best = Infinity;
      for (const piece of geometry.pieces) {
        if (piece.kind !== "through") continue;
        const cubic = piece.points as readonly [RoadPointT, RoadPointT, RoadPointT, RoadPointT];
        for (let s = 0; s <= 200; s++) {
          const p = roadCubicAt(cubic, s / 200);
          best = Math.min(best, Math.hypot(p.x - end.x, p.y - end.y));
        }
      }
      assert.ok(best < 0.05, `mask ${mask}: the branch ends ${best.toFixed(3)} px off the through-path`);
    }
  }
});

test("roadGraph: a true T welds at the tile centre, a Y welds off it but on the curve", () => {
  const tee = roadGeometryFor(0b001011); // E, NE, W -- an opposite pair plus a spur
  assert.equal(tee.junctions.length, 1, "a T's weld is the centre, where the pair pad already is");
  assert.ok(Math.hypot(tee.junctions[0].x, tee.junctions[0].y) < 1e-9, "a T's opposite pair runs through the centre");

  const why = roadGeometryFor(0b000111); // E, NE, NW -- no opposite pair
  assert.ok(why.junctions.length >= 1);
  const j = why.junctions[0];
  assert.ok(Math.hypot(j.x, j.y) > 0.5, "a Y's junction is off the centre (nothing is pushed into the gap either)");
  const spur = why.pieces.find((p) => p.kind === "spur");
  assert.ok(spur !== undefined);
  const end = spur.points[spur.points.length - 1];
  // the branch's end is the weld, and the pair's own pad is put on that same
  // point -- two entries, one place, so the junction is covered once.
  for (const pad of why.junctions) {
    assert.ok(Math.hypot(end.x - pad.x, end.y - pad.y) < 1e-9, "every pad of a Y sits on the weld");
  }
});

test("roadGraph: the branch arm is welded where its OWN radius crosses the trunk", () => {
  // The invariant asserted above, stated as geometry: an odd edge's endpoint is
  // on the through-path (the weld) AND on that edge's inward radius (so it
  // leaves perpendicular). The first cut of this used "the nearest point of the
  // through-path", which satisfies the first and not the second.
  for (let mask = 1; mask < 64; mask++) {
    const geometry = roadGeometryFor(mask);
    for (const spur of geometry.pieces.filter((p) => p.kind === "spur")) {
      const from = roadEdgeOffset(spur.edge);
      const unit = { x: from.x / ROAD_EDGE_DIST, y: from.y / ROAD_EDGE_DIST };
      const end = spur.points[spur.points.length - 1];
      if (Math.hypot(end.x, end.y) < 1e-9) continue; // a leaf, or a T welded at the centre
      // collinear with the radius: the perpendicular offset of `end` from the ray
      const perp = (end.x - from.x) * -unit.y + (end.y - from.y) * unit.x;
      assert.ok(Math.abs(perp) < 1e-9, `mask ${mask}: the branch end is ${perp} px off its own radius`);
      assert.ok(
        -(end.x - from.x) * unit.x - (end.y - from.y) * unit.y > 0,
        `mask ${mask}: the branch end is outside its own edge`,
      );
      // and it is ON the through-path, to machine precision
      let best = Infinity;
      for (const piece of geometry.pieces) {
        if (piece.kind !== "through") continue;
        const cubic = piece.points as readonly [RoadPointT, RoadPointT, RoadPointT, RoadPointT];
        for (let s = 0; s <= 2000; s++) {
          const p = roadCubicAt(cubic, s / 2000);
          best = Math.min(best, Math.hypot(p.x - end.x, p.y - end.y));
        }
      }
      assert.ok(best < 0.002, `mask ${mask}: the weld is ${best.toFixed(5)} px off the through-path`);
    }
  }
});

test("roadGraph: a through-path is two pieces sharing the curve's midpoint", () => {
  const geometry = roadGeometryFor(0b001001); // E + W
  assert.equal(geometry.pieces.length, 2);
  const [a, b] = geometry.pieces;
  assert.equal(a.kind, "through");
  assert.equal(b.kind, "through");
  assert.equal(a.edge, 0);
  assert.equal(b.edge, 3, "each half carries its OWN edge, so each half takes that edge's width");
  assert.equal(a.points.length, 4, "a through half is a real cubic, so its tangents are exact");
  assert.deepEqual(b.points[0], a.points[3], "the halves share a control point: a width step, not a gap");
  // an opposite pair's through-path runs dead straight through the tile centre
  assert.ok(Math.hypot(a.points[3].x, a.points[3].y) < 1e-9);
  // and de Casteljau subdivision keeps the original curve: the split point is the
  // midpoint of the whole (straight) run, and both halves stay on the axis
  for (const p of [...a.points, ...b.points]) assert.ok(Math.abs(p.y) < 1e-9);
});

test("roadGraph: the width mapping is the legible one, and the casing is per side", () => {
  assert.equal(roadWidthForStrands(1), ROAD_WIDTH_BASE + ROAD_WIDTH_PER_STRAND);
  assert.equal(roadWidthForStrands(0), ROAD_WIDTH_BASE + ROAD_WIDTH_PER_STRAND, "a road is at least one track wide");
  assert.equal(roadWidthForStrands(20), ROAD_WIDTH_MAX);
  assert.equal(roadWidthForStrands(200), ROAD_WIDTH_MAX);
  assert.ok(roadWidthForStrands(3) > roadWidthForStrands(1), "more tracks is still a wider road");
  // The whole point of the 2026-11-03 landing: the narrowest road is no longer
  // sub-pixel, and the range is still a reading rather than a stripe.
  assert.ok(roadWidthForStrands(1) >= 1.5, "below 1.5 px the road measured as a scratch on real terrain");
  assert.ok(ROAD_WIDTH_MAX <= 2.5, "and a full-workforce trunk stays a road, not a band across the hex");
  assert.ok(ROAD_CASING_PER_SIDE >= 1, "one px per side is what makes the body read on light and dark terrain alike");
  assert.equal(ROAD_WIDTH_MAX - roadWidthForStrands(1), 0.95, "20 tracks of delta, on a base you can see");
});

test("roadGraph: the geometry is cached per mask and never mutated by a caller", () => {
  const first = roadGeometryFor(0b010101);
  const second = roadGeometryFor(0b010101);
  assert.equal(first, second, "a mask's geometry is computed once");
  assert.notEqual(first, roadGeometryFor(0b010100));
});
