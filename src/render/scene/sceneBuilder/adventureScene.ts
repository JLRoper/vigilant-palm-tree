import { axialToPixel, hexCorners, hexDistance, HEX_SIZE, type Axial } from "../../../core/hex";
import type { GameMap } from "../../../map/gameMap";
import type { Hero } from "../../../entities/hero";
import type { Castle } from "../../../entities/settlement";
import type { RenderOptions } from "../../renderTypes";
import { computeVision, isVisible } from "../../fog";
import { computeReachableSplit } from "../../overlays/pathOverlay";
import { controlledPositions, territoryBoundaryEdges } from "@heroes/engine";
import type {
  SceneNode,
  HeroTrailNode,
  TerritoryOutlineEdgeNode,
  WorldPoint,
} from "../types";

// Faithful decomposition of MapRenderer.draw()'s per-frame "what to draw"
// decisions into pure data. Not yet covered: the minimap (its own
// self-contained secondary view, drawn outside the main camera transform).
//
// Takes the same Hero[]/Castle[] wrapper inputs MapRenderer.draw() takes today
// rather than raw GameState — see entityMirror.ts for why that mirror isn't
// replaced yet.

export interface AdventureSceneInput {
  map: GameMap;
  heroes: Hero[];
  castles: readonly Castle[];
  path: Axial[];
  hover: Axial | null;
  opts: RenderOptions;
}

export function buildAdventureScene(input: AdventureSceneInput): SceneNode[] {
  const { map, heroes, castles, path, hover, opts } = input;
  const nodes: SceneNode[] = [];
  const visible = computeVision(heroes, castles, opts.viewPlayerId);

  for (let r = 0; r < map.height; r++) {
    for (let q = 0; q < map.width; q++) {
      const terrain = map.get(q, r);
      if (!terrain) continue;
      const world = axialToPixel(q, r);
      nodes.push({ kind: "terrainHex", q, r, world, terrain });
      nodes.push({ kind: "terrainDecoration", q, r, world, terrain });
      if (!isVisible(visible, q, r)) {
        nodes.push({ kind: "fogHex", q, r, world });
      }
    }
  }

  for (let r = 0; r < map.height; r++) {
    for (let q = 0; q < map.width; q++) {
      const tile = map.resourceTileAt(q, r);
      if (!tile) continue;
      if (!isVisible(visible, q, r)) continue;
      nodes.push({ kind: "resourceIcon", q, r, world: axialToPixel(q, r), resource: tile.resource });
    }
  }

  for (const charter of opts.activeCharters ?? []) {
    if (!isVisible(visible, charter.targetQ, charter.targetR)) continue;
    nodes.push({
      kind: "charterOverlay",
      q: charter.targetQ,
      r: charter.targetR,
      world: axialToPixel(charter.targetQ, charter.targetR),
      phase: charter.phase,
    });
  }

  if (opts.validCharterHexes) {
    for (const key of opts.validCharterHexes) {
      const [qs, rs] = key.split(",");
      const q = Number(qs);
      const r = Number(rs);
      if (Number.isNaN(q) || Number.isNaN(r)) continue;
      if (!isVisible(visible, q, r)) continue;
      nodes.push({ kind: "validCharterHex", q, r, world: axialToPixel(q, r) });
    }
  }

  for (const c of castles) {
    const canSee = c.ownerId === opts.viewPlayerId || isVisible(visible, c.tile.q, c.tile.r);
    if (!canSee) continue;
    nodes.push({
      kind: "castle",
      settlementId: c.id,
      world: axialToPixel(c.tile.q, c.tile.r),
      level: c.level,
      variant: c.castleVariant,
      ownerId: c.ownerId,
      selected: opts.selectedSettlementId === c.id,
      color: c.ownerId === null ? "rgba(255,255,255,0.18)" : opts.colorForOwner(c.ownerId),
      dashedBorder: c.ownerId === null,
    });
  }

  for (const edge of buildTerritoryOutlineEdges(castles, opts.colorForOwner, map.width, map.height, visible)) {
    nodes.push(edge);
  }

  for (const node of buildPathNodes(heroes, path, map, opts)) {
    nodes.push(node);
  }

  if (hover && isVisible(visible, hover.q, hover.r)) {
    nodes.push({ kind: "hoverHighlight", q: hover.q, r: hover.r, world: axialToPixel(hover.q, hover.r) });
  }

  if (opts.inspectedTile) {
    nodes.push({
      kind: "selectedTileHighlight",
      q: opts.inspectedTile.q,
      r: opts.inspectedTile.r,
      world: axialToPixel(opts.inspectedTile.q, opts.inspectedTile.r),
    });
  }

  for (const hero of heroes) {
    const canSee = hero.ownerId === opts.viewPlayerId || isVisible(visible, hero.tile.q, hero.tile.r);
    if (!canSee) continue;
    const base = axialToPixel(hero.tile.q, hero.tile.r);
    const bobAmplitude = 6;
    const swingPhase = hero.moveProgress * Math.PI * 2;
    const bobY = hero.moving ? -Math.sin(swingPhase) * bobAmplitude : 0;
    const scaleY = hero.moving ? 1.0 + 0.06 * Math.sin(swingPhase) : 1.0;
    nodes.push({
      kind: "hero",
      heroId: hero.id,
      ownerId: hero.ownerId,
      world: { x: base.x + hero.pixelOffset.x, y: base.y + hero.pixelOffset.y + bobY },
      facingDirection: hero.facingDirection,
      horseVariant: hero.horseVariant,
      faction: hero.faction,
      scaleY,
      color: opts.colorForOwner(hero.ownerId),
      selected: opts.selectedHeroId === hero.id,
    });
  }

  return nodes;
}

function buildTerritoryOutlineEdges(
  castles: readonly Castle[],
  colorForOwner: (ownerId: number | null) => string,
  mapWidth: number,
  mapHeight: number,
  visible: Set<string>,
): TerritoryOutlineEdgeNode[] {
  const owned = castles.filter((c): c is Castle & { ownerId: number } => c.ownerId !== null);
  if (owned.length === 0) return [];

  const groups = new Map<number, Castle[]>();
  for (const c of owned) {
    const group = groups.get(c.ownerId);
    if (group) group.push(c);
    else groups.set(c.ownerId, [c]);
  }

  const ownerHexes = new Map<number, Set<string>>();
  for (const [ownerId, group] of groups) {
    const hexes = new Set<string>();
    for (const c of group) {
      for (const pos of controlledPositions(c.tile, c.level, mapWidth, mapHeight)) {
        hexes.add(pos);
      }
    }
    ownerHexes.set(ownerId, hexes);
  }

  const partitioned = new Map<number, Set<string>>();
  for (const ownerId of groups.keys()) partitioned.set(ownerId, new Set<string>());

  if (groups.size === 1) {
    const [ownerId, hexes] = [...ownerHexes][0];
    for (const key of hexes) {
      if (visible.has(key)) partitioned.get(ownerId)!.add(key);
    }
  } else {
    const allHexes = new Set<string>();
    for (const hexes of ownerHexes.values()) {
      for (const h of hexes) allHexes.add(h);
    }
    const castleAxial: Array<{ ownerId: number; q: number; r: number }> = owned.map((c) => ({
      ownerId: c.ownerId,
      q: c.tile.q,
      r: c.tile.r,
    }));
    for (const key of allHexes) {
      if (!visible.has(key)) continue;
      const [qs, rs] = key.split(",");
      const q = parseInt(qs, 10);
      const r = parseInt(rs, 10);
      let bestOwner = 0;
      let bestDist = Infinity;
      for (const { ownerId: oid, q: cq, r: cr } of castleAxial) {
        const dist = hexDistance({ q, r }, { q: cq, r: cr });
        if (dist < bestDist || (dist === bestDist && oid < bestOwner)) {
          bestDist = dist;
          bestOwner = oid;
        }
      }
      partitioned.get(bestOwner)!.add(key);
    }
  }

  const edges: TerritoryOutlineEdgeNode[] = [];
  for (const [ownerId, hexSet] of partitioned) {
    if (hexSet.size === 0) continue;
    const color = colorForOwner(ownerId);
    for (const e of territoryBoundaryEdges(hexSet, HEX_SIZE, axialToPixel, hexCorners)) {
      edges.push({ kind: "territoryOutlineEdge", ownerId, color, x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2 });
    }
  }
  return edges;
}

function buildPathNodes(heroes: Hero[], path: Axial[], map: GameMap, opts: RenderOptions): SceneNode[] {
  if (path.length === 0 || heroes.length === 0) return [];

  const pathPx = path.map((t) => axialToPixel(t.q, t.r));
  const originPx = opts.pathOrigin
    ? axialToPixel(opts.pathOrigin.q, opts.pathOrigin.r)
    : opts.selectedHeroTile
    ? axialToPixel(opts.selectedHeroTile.q, opts.selectedHeroTile.r)
    : axialToPixel(heroes[0].tile.q, heroes[0].tile.r);
  const fullPx = [originPx, ...pathPx];

  const selectedHero = opts.selectedHeroId ? heroes.find((h) => h.id === opts.selectedHeroId) : heroes[0];
  const movementRemaining = selectedHero?.movementRemaining ?? 0;
  const splitIdx = Math.min(
    opts.pathReachableIdx ?? computeReachableSplit(path, map, movementRemaining),
    path.length,
  );

  const nodes: SceneNode[] = [];
  const reachable = slicePoints(fullPx, 0, splitIdx + 1);
  if (reachable.length >= 2) {
    nodes.push({ kind: "pathSegment", reachable: true, points: reachable });
  }
  if (splitIdx < path.length) {
    const unreachable = slicePoints(fullPx, splitIdx, pathPx.length);
    if (unreachable.length >= 2) {
      nodes.push({ kind: "pathSegment", reachable: false, points: unreachable });
    }
  }

  if (selectedHero && selectedHero.trail.length >= 2) {
    const trailNode: HeroTrailNode = {
      kind: "heroTrail",
      heroId: selectedHero.id,
      color: opts.colorForOwner(selectedHero.ownerId),
      points: selectedHero.trail.map((p) => axialToPixel(p.q, p.r)),
    };
    nodes.push(trailNode);
  }

  return nodes;
}

function slicePoints(points: WorldPoint[], fromIdx: number, toIdx: number): WorldPoint[] {
  if (toIdx <= fromIdx) return [];
  return points.slice(fromIdx, toIdx);
}
