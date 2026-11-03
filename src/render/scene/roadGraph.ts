// ---------------------------------------------------------------------------
// roadGraph.ts -- a district road is a GRAPH PER TILE, stroked analytically.
//
// Lifted from the winning prototype of the 2026-11-03 road study ("idea 2 of 2
// -- centre-node stroke graph", .agentboard/road-reports/
// wtgui-road-idea-2-of-2-centre-node-b2e211/road-stroke-graph.js, variant C).
// The synthesis, and the reason it won over the edge-mask tileset:
// .agentboard/road-reports/synthesis/index.html.
//
// THE IDEA. A tile's road input is the set of its six edges that carry traffic
// -- a 6-bit mask, the same shape `riverMaskInfo` already uses for rivers. From
// that mask the tile computes its own paths and strokes them with the canvas
// path API, so a BRANCH IS NOT A DRAWN PIECE: it is what the geometry does when
// three edges are in the mask. Nothing is authored and nothing is baked.
//
// THE ONE GEOMETRIC FACT THE WHOLE THING RESTS ON. For this hex projection the
// midpoint of the edge shared by two tiles lies on the straight line between
// their two centres, and the edge is PERPENDICULAR to that line. So "leave the
// edge perpendicularly" is the same instruction as "leave along the radius,
// inward", and BOTH tiles either side of a shared edge compute that same inward
// radius. Every piece below leaves and arrives along exactly that radius, so
// what one tile strokes and what its neighbour strokes are tangent-continuous at
// the boundary whatever either tile's mask is -- and `test/render/roadGraph.test.ts`
// asserts the perpendicular on all 64 masks, not just on a straight run.
//
// LIFTED SHAPE (the prototype's variant C, "paired curves, welded junction"):
//   * edges are paired into through-paths, greedily taking the pair whose
//     angular separation is closest to 180 degrees first;
//   * each pair is ONE cubic that leaves perpendicular at one end and arrives
//     perpendicular at the other, so a corner is one rounded elbow and there is
//     no kink anywhere;
//   * a pair is stroked as TWO pieces subdivided at the curve's midpoint, so
//     each end keeps its OWN edge's track count -- a width step at a shared
//     tangent, not a kink. That is what keeps the workforce reading working;
//   * an odd edge out (3 or 5 edges set) does not stub to the tile centre (that
//     is variant B, whose stub floats off the through-path -- worst case mask
//     `011100`, a measured 6.30 world px of visible gap). It ends on the nearest
//     point of the through-path it joins, so a T is WELDED, and the junction
//     takes a round pad. That weld is the answer to the tileset idea's open
//     side: no node is pushed into the angular gap, so there is no nub to fix.
//
// THE NUB, AND WHY NEITHER OF ITS TWO CANDIDATE FIXES WAS NEEDED. The losing
// edge-mask-tileset idea had to handle a rounded nub where a 3-edge junction's
// open side protrudes: with no opposite pair it pushed the junction node into
// the largest angular gap, so all three arms ended at one off-centre point and
// the union's extremity read as a bump. It listed two fixes and implemented
// neither -- move the node to the tile centre (the shorter nub, but it
// reintroduces a kink where the arms meet), or give degree >= 3 a junction pad
// disc of about 1.6x the road width. The weld answers it a third way, and that
// is why this module has no nub at all: the branch TERMINATES ON the
// through-path, so the third arm's round cap merges into the trunk instead of
// standing off it. The landing then takes the tileset idea's second candidate
// anyway, as a nicety rather than a fix -- a pad disc at the weld, sized to the
// casing half-width (see ROAD_JUNCTION_PAD) -- because a junction that reads as
// a junction is worth one filled circle.
//
// THE ONE PLACE THIS DEPARTS FROM THE PROTOTYPE, on purpose. The prototype
// sampled each cubic into a 25-point polyline and stroked the polyline. A
// sampled polyline leaves its true tangent: measured here, the first chord of a
// 60-degree corner (mask 3) sits cos = 0.9988 off the radial -- about 2.8
// degrees, which two tiles add up at a seam. The prototype's own 0.000-degree
// continuity measurement happened to be taken on a `111111`-vs-`011101` seam
// where both through-paths are straight, and a straight run has no chord error
// at all. Emitting the exact cubic control points and subdividing with de
// Casteljau instead makes the seam tangent EXACT on every mask, and cuts the
// canvas calls per through-piece from 50 (two 25-point polylines) to 2.
//
// WHY THE GEOMETRY IS CACHED AND NOT BAKED. `roadGeometryFor` computes a mask's
// pieces once and caches them (64 masks, tile-LOCAL coordinates), so a frame
// costs one Map lookup and a path per tile and no trig. There is deliberately NO
// baked atlas: the width is a per-EDGE reading (`strands`, one track per 5
// workforce), so a baked tile would need one sprite per (mask x strand
// signature) and the workforce reading would have to be quantised into the
// artwork. If the palette ever stops being data-driven the atlas is a drop-in
// next step: render `roadGeometryFor(mask)` with the tile's own widths into an
// offscreen canvas at 1:1 world scale and `drawImage` it per tile.
//
// NOT A COST PATH. This module is pixels only. The movement discount
// (ROAD_MOVEMENT_MULTIPLIER) is engine work on the map's own cost table.
// ---------------------------------------------------------------------------

import { HEX_SIZE, axialToPixel } from "../../core/hex";

export interface RoadPoint {
  x: number;
  y: number;
}

/**
 * The six axial neighbour steps, in the ENGINE's own order -- E, NE, NW, W, SW,
 * SE (`NEIGHBOR_DIRS`, packages/engine/src/map/directions.ts). Edge index `i` is
 * the side of the tile that faces neighbour `i`, which is the same index the
 * road mask uses. `test/render/roadGraph.test.ts` pins this table equal to the
 * engine's element for element, so the copy can never drift silently.
 */
export const ROAD_EDGE_DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];

/** Centre -> edge midpoint: half the centre-to-centre distance (55.4256 px). */
export const ROAD_EDGE_DIST = (HEX_SIZE * Math.sqrt(3)) / 2;

// ---- The width mapping, and what this landing changed ---------------------
//
// SHIPPED BEFORE: body = min(1.5, 0.55 + strands * 0.05) under a 0.45 px total
// casing, so a 1-track road was 0.60 px and a fully staffed trunk 1.50 px on a
// 55.43 px hex -- a 0.90 px delta, 1.6 % of the pitch, under one screen pixel at
// every gameplay zoom. Both study cards measured that and both concluded the
// geometry was never the blocker: at that width the road is a scratch on real
// terrain and a perfect junction renderer still shows the player nothing (idea
// 2's finding, which outranks the geometry).
//
// NOW: the base is lifted into the legible band and the cap with it, so the same
// 0.05 px per track is the same absolute delta on a base the eye can see
// (1.55 px -> 2.50 px instead of 0.60 -> 1.50). The casing is what buys the
// leanness: 1.0 px per side (not 0.45 px total) is what makes a 1.5 px body read
// on grass, forest, desert and snow alike. 3.55 px total against the streams'
// measured 14.0 px (small) and 18.0 px (wide) bodies -- 4.0x and 5.1x thinner,
// still "much thinner than the streams", and now visible. The synthesis report
// carries the stream measurement that number comes from.
export const ROAD_WIDTH_BASE = 1.5;
export const ROAD_WIDTH_PER_STRAND = 0.05;
export const ROAD_WIDTH_MAX = 2.5;
/** Casing width added PER SIDE, so the casing stroke is body + 2x this. */
export const ROAD_CASING_PER_SIDE = 1.0;
/**
 * Junction pad radius as a multiple of the casing's half-width. The pad has to
 * sit just proud of the casing to be seen at all: anything smaller and the
 * trunk's own casing swallows it whole.
 */
export const ROAD_JUNCTION_PAD = 1.35;

/** The game's track-count -> world-pixel body width mapping. */
export function roadWidthForStrands(strands: number): number {
  return Math.min(
    ROAD_WIDTH_MAX,
    ROAD_WIDTH_BASE + Math.max(1, Math.floor(strands)) * ROAD_WIDTH_PER_STRAND,
  );
}

/**
 * The axial neighbour step of edge `i`, plus the centre-to-centre axis it sits
 * on. Derived from `axialToPixel` itself rather than from a hand-copied angle
 * table, so the geometry cannot drift from the projection.
 */
function edgeAxis(i: number): { ux: number; uy: number; len: number } {
  const dir = ROAD_EDGE_DIRS[i];
  const c = axialToPixel(dir[0], dir[1]);
  const len = Math.hypot(c.x, c.y);
  return { ux: c.x / len, uy: c.y / len, len };
}

/**
 * The edge index of the side of `from` that faces `to`, or -1 when the two are
 * not axial neighbours. This is how the scene builder turns an engine
 * `RoadSegment` into two mask bits.
 */
export function roadEdgeIndex(
  from: { q: number; r: number },
  to: { q: number; r: number },
): number {
  const dq = to.q - from.q;
  const dr = to.r - from.r;
  return ROAD_EDGE_DIRS.findIndex(([a, b]) => a === dq && b === dr);
}

/** Tile-local world offset from the centre to edge `i`'s midpoint. */
export function roadEdgeOffset(i: number): RoadPoint {
  const { ux, uy, len } = edgeAxis(i);
  return { x: (ux * len) / 2, y: (uy * len) / 2 };
}

/** The connected edge indices of a 6-bit mask, ascending. */
export function roadMaskEdges(mask: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < 6; i++) if (mask & (1 << i)) out.push(i);
  return out;
}

/**
 * Smallest absolute angular separation between edges `a` and `b`, 0..180,
 * measured from the projection itself: the angle between the two neighbour
 * centres. Always 60, 120 or 180 on a hex.
 */
export function roadEdgeSeparationDeg(a: number, b: number): number {
  const da = axialToPixel(ROAD_EDGE_DIRS[a][0], ROAD_EDGE_DIRS[a][1]);
  const db = axialToPixel(ROAD_EDGE_DIRS[b][0], ROAD_EDGE_DIRS[b][1]);
  const la = Math.hypot(da.x, da.y);
  const lb = Math.hypot(db.x, db.y);
  const cos = (da.x * db.x + da.y * db.y) / (la * lb);
  return (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI;
}

/**
 * Pair connected edges into through-paths: greedily take the pair whose angular
 * separation is closest to 180 degrees, remove both, repeat. Deterministic
 * (ties broken by the lowest index pair), so a mask always yields the same
 * paths.
 */
export function roadPairEdges(edges: readonly number[]): {
  pairs: Array<{ a: number; b: number }>;
  leftover: number[];
} {
  const pool = [...edges];
  const pairs: Array<{ a: number; b: number }> = [];
  while (pool.length >= 2) {
    let best: { score: number; x: number; y: number } | null = null;
    for (let x = 0; x < pool.length; x++) {
      for (let y = x + 1; y < pool.length; y++) {
        const score = roadEdgeSeparationDeg(pool[x], pool[y]);
        if (best === null || score > best.score) best = { score, x, y };
      }
    }
    if (best === null) break;
    pairs.push({ a: pool[best.x], b: pool[best.y] });
    const keep = pool.filter((_, idx) => idx !== best.x && idx !== best.y);
    pool.length = 0;
    pool.push(...keep);
  }
  return { pairs, leftover: pool };
}

export type RoadPieceKind = "through" | "spur";

/** A cubic Bezier: [P0, P1, P2, P3]. */
export type RoadCubic = readonly [RoadPoint, RoadPoint, RoadPoint, RoadPoint];

export interface RoadPiece {
  /**
   * The edge this piece STARTS on -- its track count is its width. For a
   * through piece's second half that is the FAR edge, which is the point of
   * splitting at all.
   */
  edge: number;
  kind: RoadPieceKind;
  /**
   * A through piece carries its four CUBIC CONTROL POINTS (exact tangents, so
   * the seam to the next tile is exactly tangent); a spur carries its two
   * endpoints as a straight line. Both are tile-local.
   */
  points: readonly RoadPoint[];
}

export interface RoadJunction {
  x: number;
  y: number;
  /** Every edge that runs through this junction; the pad sizes to the busiest. */
  edges: number[];
}

export interface RoadGeometry {
  pieces: RoadPiece[];
  junctions: RoadJunction[];
}

/** How hard a through-curve pulls toward the tile centre. */
const ROAD_PULL = 0.42;
/** Samples used only to find a NEAREST point (welding and pads), never drawn. */
const ROAD_WELD_SAMPLES = 48;

/** The point of a cubic at `t`. Exported so a caller can sample a piece. */
export function roadCubicAt(c: RoadCubic, t: number): RoadPoint {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const cc = 3 * mt * t * t;
  const d = t * t * t;
  return {
    x: a * c[0].x + b * c[1].x + cc * c[2].x + d * c[3].x,
    y: a * c[0].y + b * c[1].y + cc * c[2].y + d * c[3].y,
  };
}

/**
 * Split a cubic at t = 0.5 (de Casteljau). Exact, so both halves keep the
 * original curve's tangents at every endpoint -- the seam to the neighbouring
 * tile stays tangent to the micrometre, and the join between the two halves is
 * a shared point on a shared tangent (a width step, not a kink).
 */
function splitCubic(c: RoadCubic): [RoadCubic, RoadCubic] {
  const lerp = (a: RoadPoint, b: RoadPoint): RoadPoint => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const p01 = lerp(c[0], c[1]);
  const p12 = lerp(c[1], c[2]);
  const p23 = lerp(c[2], c[3]);
  const p012 = lerp(p01, p12);
  const p123 = lerp(p12, p23);
  const mid = lerp(p012, p123);
  return [
    [c[0], p01, p012, mid],
    [mid, p123, p23, c[3]],
  ];
}

/**
 * The through-path between edge `i` and edge `j`, tile-local:
 *   P0 = edge i midpoint, leaving along the INWARD radius -> perpendicular;
 *   P3 = edge j midpoint, arriving along the outward radius -> perpendicular;
 * both control points sit `ROAD_PULL` of the span back along their own tangent.
 */
function throughCurve(i: number, j: number): RoadCubic {
  const pi = roadEdgeOffset(i);
  const pj = roadEdgeOffset(j);
  const ai = edgeAxis(i);
  const aj = edgeAxis(j);
  const span = Math.hypot(pj.x - pi.x, pj.y - pi.y) || 1;
  const a = ROAD_PULL * span;
  return [
    pi,
    { x: pi.x - ai.ux * a, y: pi.y - ai.uy * a },
    { x: pj.x - aj.ux * a, y: pj.y - aj.uy * a },
    pj,
  ];
}

/** The sampled point of a cubic nearest `target`. */
function nearestOnCubic(c: RoadCubic, target: RoadPoint): { d: number; p: RoadPoint } {
  let best = { d: Infinity, p: c[0] };
  for (let i = 0; i <= ROAD_WELD_SAMPLES; i++) {
    const p = roadCubicAt(c, i / ROAD_WELD_SAMPLES);
    const d = Math.hypot(p.x - target.x, p.y - target.y);
    if (d < best.d) best = { d, p };
  }
  return best;
}

/**
 * WHERE EDGE `i`'S INWARD RADIUS CROSSES THIS CUBIC, exactly (bisection on the
 * signed perpendicular offset, so the answer is on the curve to machine
 * precision and on the radius line by construction).
 *
 * This is the weld point for an odd edge out, and the reason it is the RADIUS
 * and not "the nearest point on the through-path" is the seam: a branch welded
 * to the nearest point leaves its edge at whatever angle crosses the trunk
 * (measured 29.46 degrees off the radius for a true T, whose branch has to cross
 * its trunk at a right angle), while a branch welded on its own radius leaves
 * exactly perpendicular like every other piece, so EVERY seam of EVERY mask is
 * tangent. Measured across all 64 masks: every leftover edge's radius does meet a
 * through-path, and the first crossing is the weld. The nearest-point form is
 * kept below as the total fallback for a future mask that has no crossing.
 */
function radialCrossingOnCubic(c: RoadCubic, from: RoadPoint, ux: number, uy: number): RoadPoint | null {
  const signedOffset = (t: number): number => {
    const p = roadCubicAt(c, t);
    return (p.x - from.x) * -uy + (p.y - from.y) * ux;
  };
  const along = (p: RoadPoint): number => -((p.x - from.x) * ux + (p.y - from.y) * uy);
  let bestCrossing: RoadPoint | null = null;
  let bestAlong = Infinity;
  // only the crossings on the INWARD side count, and the first one going in
  const consider = (p: RoadPoint): void => {
    const a = along(p);
    if (a > 1e-9 && a < bestAlong) {
      bestAlong = a;
      bestCrossing = p;
    }
  };

  let prevT = 0;
  let prevF = signedOffset(0);
  if (prevF === 0) consider(roadCubicAt(c, 0));
  for (let s = 1; s <= ROAD_WELD_SAMPLES; s++) {
    const t = s / ROAD_WELD_SAMPLES;
    const f = signedOffset(t);
    if (f === 0) {
      // the sample IS the crossing -- take it. (This is the case that broke the
      // first cut of this function: a sample landing exactly on the ray left the
      // bisection without a negative left endpoint, so it walked `lo` up to `hi`
      // and returned a point ~1 px off the ray.)
      consider(roadCubicAt(c, t));
    } else if (prevF !== 0 && prevF < 0 !== f < 0) {
      // Bisect on the SIGN, and on whichever orientation this interval has:
      // f(lo) and f(hi) are strictly on opposite sides, so moving the endpoint
      // whose sign MATCHES lo keeps that invariant. (The first cut compared
      // against the left endpoint's own sign and assumed lo was negative; and
      // the `f === 0` sample above set prevF to 0, which then entered this
      // branch with no sign on the left at all and walked `lo` to `hi` --
      // returning a weld ~1 px off the ray. Both are why the `prevF !== 0`
      // guard and the `loNeg` orientation are here.)
      let lo = prevT;
      let hi = t;
      const loNeg = prevF < 0;
      for (let k = 0; k < 60; k++) {
        const mid = (lo + hi) / 2;
        const midF = signedOffset(mid);
        if (midF === 0) {
          lo = mid;
          hi = mid;
          break;
        }
        if (midF < 0 === loNeg) lo = mid;
        else hi = mid;
      }
      consider(roadCubicAt(c, (lo + hi) / 2));
    }
    prevT = t;
    prevF = f;
  }
  return bestCrossing;
}

const geometryCache = new Map<number, RoadGeometry>();

/**
 * The tile's road for a 6-bit edge mask, in tile-LOCAL coordinates, cached per
 * mask. See the file header for why this is cached and not baked.
 */
export function roadGeometryFor(mask: number): RoadGeometry {
  const cached = geometryCache.get(mask);
  if (cached) return cached;

  const edges = roadMaskEdges(mask);
  const pieces: RoadPiece[] = [];
  const junctions: RoadJunction[] = [];

  if (edges.length > 0) {
    const { pairs, leftover } = roadPairEdges(edges);
    const curves: Array<{ a: number; b: number; cubic: RoadCubic }> = [];

    for (const { a, b } of pairs) {
      const cubic = throughCurve(a, b);
      curves.push({ a, b, cubic });
      const [first, second] = splitCubic(cubic);
      pieces.push({ edge: a, kind: "through", points: first });
      pieces.push({ edge: b, kind: "through", points: second });
    }

    for (const i of leftover) {
      const from = roadEdgeOffset(i);
      const axis = edgeAxis(i);
      let target: RoadPoint = { x: 0, y: 0 };
      if (curves.length > 0) {
        // WELD the branch where its OWN inward radius crosses the through-path
        // it joins. Variant B stubs the odd edge to the tile centre, which
        // FLOATS off a through-path that does not pass through it (worst case
        // mask `011100`, a measured 6.30 world px of gap); variant C -- what
        // landed -- welds instead, so a T is joined and the junction takes a
        // round pad. Welding on the radius rather than to the nearest point is
        // this landing's addition: it keeps the branch perpendicular at its own
        // edge, which is what the seam invariant needs (see
        // radialCrossingOnCubic).
        let crossing: RoadPoint | null = null;
        for (const curve of curves) {
          const hit = radialCrossingOnCubic(curve.cubic, from, axis.ux, axis.uy);
          if (hit && crossing === null) crossing = hit;
        }
        if (crossing) {
          target = crossing;
        } else {
          // total fallback: the nearest point on the through-path. Never reached
          // by any of the 64 masks today (asserted in roadGraph.test.ts).
          let best: { d: number; p: RoadPoint } | null = null;
          for (const curve of curves) {
            const near = nearestOnCubic(curve.cubic, from);
            if (best === null || near.d < best.d) best = near;
          }
          if (best) target = best.p;
        }
      }
      pieces.push({ edge: i, kind: "spur", points: [from, target] });
    }

    if (edges.length >= 3) {
      // A junction pad per crossing through-path and per welded branch, sized at
      // stroke time to the busiest edge through it. On a true T the pair is
      // exactly opposite, its curve passes through the centre, and the weld is
      // that same centre, so the pad lands on both at once. Where those two
      // coincide the pad is listed ONCE: a pad is a filled disc, and two
      // coincident translucent fills double-blend into a visible dot.
      const addPad = (x: number, y: number, padEdges: number[]): void => {
        for (const existing of junctions) {
          if (Math.hypot(existing.x - x, existing.y - y) < 1e-9) return;
        }
        junctions.push({ x, y, edges: padEdges });
      };
      for (const curve of curves) {
        const { p } = nearestOnCubic(curve.cubic, { x: 0, y: 0 });
        addPad(p.x, p.y, [curve.a, curve.b]);
      }
      for (const spur of pieces) {
        if (spur.kind !== "spur") continue;
        const end = spur.points[spur.points.length - 1];
        addPad(end.x, end.y, [spur.edge]);
      }
    }
  }

  const geometry: RoadGeometry = { pieces, junctions };
  geometryCache.set(mask, geometry);
  return geometry;
}
