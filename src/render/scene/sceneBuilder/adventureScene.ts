import { axialToPixel, hexCorners, HEX_SIZE, type Axial } from "../../../core/hex";
import { getRowQBounds, isTileInViewportBounds, type ViewportAxialBounds } from "../../camera";
import type { GameMap } from "../../../map/gameMap";
import type { Hero } from "../../../entities/hero";
import type { Castle } from "../../../entities/settlement";
import type { RenderOptions } from "../../renderTypes";
import { computeVision, isVisible } from "../../fog";
import { computeReachableSplit } from "../../overlays/pathOverlay";
import type { BuildingDef } from "@heroes/contracts";
import { controlledPositions, isDistrictBlockedByHero, resolveControllingSettlement, territoryBoundaryEdges } from "@heroes/engine";
import type { EntityMirror } from "../entityMirror";
import type {
  SceneNode,
  HeroNode,
  HeroTrailNode,
  PathSegmentNode,
  TerritoryOutlineEdgeNode,
  WorldPoint,
} from "../types";

// Faithful decomposition of MapRenderer.draw()'s per-frame "what to draw"
// decisions into pure data. Not yet covered: the minimap (its own
// self-contained secondary view, drawn outside the main camera transform).
//
// Hero/Castle entities are supplied via EntityMirror (or directly as arrays
// for standalone unit tests).

export interface AdventureSceneInput {
  map: GameMap;
  mirror?: EntityMirror;
  heroes?: Hero[];
  castles?: readonly Castle[];
  path: Axial[];
  hover: Axial | null;
  opts: RenderOptions;
  /** Precomputed fog-of-war set. Callers that also need it (MapRenderer draws
   * the minimap from the same set) pass it in so it isn't derived twice per
   * frame; omitted, it is computed here. */
  visible?: Set<string>;
  viewportBounds?: ViewportAxialBounds;
}

export function districtVariantForBuildings(buildings: readonly BuildingDef[]): "standard" | "farm" {
  return buildings.some((b) => b.kind === "farmField" || b.kind === "farmhouse") ? "farm" : "standard";
}

export function districtTierForCount(count: number): 1 | 2 | 3 {
  if (count >= 9) return 3;
  if (count >= 4) return 2;
  return 1;
}

export function settlementFullnessForCount(count: number): 1 | 2 | 3 | 4 | 5 {
  if (count >= 13) return 5;
  if (count >= 10) return 4;
  if (count >= 7) return 3;
  if (count >= 4) return 2;
  return 1;
}

export function buildAdventureScene(input: AdventureSceneInput): SceneNode[] {
  const { map, path, hover, opts } = input;
  const heroes = input.heroes ?? input.mirror?.getHeroes() ?? [];
  const castles = input.castles ?? input.mirror?.getSettlements() ?? [];
  const nodes: SceneNode[] = [];
  const visible = input.visible ?? computeVision(heroes, castles, opts.viewPlayerId);
  const bounds: ViewportAxialBounds = input.viewportBounds ?? {
    qMin: 0,
    qMax: map.width - 1,
    rMin: 0,
    rMax: map.height - 1,
  };

  for (let r = bounds.rMin; r <= bounds.rMax; r++) {
    const { qMin: rowQMin, qMax: rowQMax } = getRowQBounds(bounds, r);
    for (let q = rowQMin; q <= rowQMax; q++) {
      const terrain = map.get(q, r);
      if (!terrain) continue;
      const world = axialToPixel(q, r);
      nodes.push({ kind: "terrainHex", q, r, world, terrain });
      if (terrain !== "grass" && terrain !== "dirt") {
        nodes.push({ kind: "terrainDecoration", q, r, world, terrain });
      }
      if (!isVisible(visible, q, r)) {
        nodes.push({ kind: "fogHex", q, r, world });
      }
    }
  }

  if (map.placedResourceTiles) {
    for (const tile of map.placedResourceTiles) {
      if (!isTileInViewportBounds(bounds, tile.q, tile.r)) continue;
      if (!isVisible(visible, tile.q, tile.r)) continue;
      nodes.push({ kind: "resourceIcon", q: tile.q, r: tile.r, world: axialToPixel(tile.q, tile.r), resource: tile.resource });
    }
  } else {
    for (let r = bounds.rMin; r <= bounds.rMax; r++) {
      const { qMin: rowQMin, qMax: rowQMax } = getRowQBounds(bounds, r);
      for (let q = rowQMin; q <= rowQMax; q++) {
        const tile = map.resourceTileAt(q, r);
        if (!tile) continue;
        if (!isVisible(visible, q, r)) continue;
        nodes.push({ kind: "resourceIcon", q, r, world: axialToPixel(q, r), resource: tile.resource });
      }
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

  if (opts.validCharterHexes && opts.validCharterHexes.size > 0) {
    for (let r = bounds.rMin; r <= bounds.rMax; r++) {
      const { qMin: rowQMin, qMax: rowQMax } = getRowQBounds(bounds, r);
      for (let q = rowQMin; q <= rowQMax; q++) {
        if (!isVisible(visible, q, r)) continue;
        if (!opts.validCharterHexes.has(`${q},${r}`)) continue;
        nodes.push({ kind: "validCharterHex", q, r, world: axialToPixel(q, r) });
      }
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
      ...(c.level === 1 && c.buildings.length > 0 ? { fullness: settlementFullnessForCount(c.buildings.length) } : {}),
      ownerId: c.ownerId,
      selected: opts.selectedSettlementId === c.id,
      color: c.ownerId === null ? "rgba(255,255,255,0.18)" : opts.colorForOwner(c.ownerId),
      dashedBorder: c.ownerId === null,
    });
  }

  const heroCoords = heroes.map((h) => ({ ownerId: h.ownerId, q: h.tile.q, r: h.tile.r }));
  for (const c of castles) {
    for (const d of Object.values(c.districts ?? {})) {
      if (!d.buildings || d.buildings.length === 0) continue;
      const canSee = c.ownerId === opts.viewPlayerId || isVisible(visible, d.q, d.r);
      if (!canSee) continue;
      const blocked = isDistrictBlockedByHero(c.ownerId, d.q, d.r, heroCoords);
      nodes.push({
        kind: "district",
        settlementId: c.id,
        ownerId: c.ownerId,
        q: d.q,
        r: d.r,
        world: axialToPixel(d.q, d.r),
        tier: districtTierForCount(d.buildings.length),
        variant: districtVariantForBuildings(d.buildings),
        color: c.ownerId === null ? "rgba(255,255,255,0.18)" : opts.colorForOwner(c.ownerId),
        ...(blocked ? { blocked: true } : {}),
      });
    }
  }

  for (const edge of buildTerritoryOutlineEdges(castles, opts.colorForOwner, map.width, map.height, visible)) {
    nodes.push(edge);
  }

  for (const node of buildPathNodes(heroes, path, map, opts, visible)) {
    nodes.push(node);
  }

  if (opts.inspectedTile) {
    nodes.push({
      kind: "selectedTileHighlight",
      q: opts.inspectedTile.q,
      r: opts.inspectedTile.r,
      world: axialToPixel(opts.inspectedTile.q, opts.inspectedTile.r),
    });
  }

  if (hover && isVisible(visible, hover.q, hover.r)) {
    nodes.push({ kind: "hoverHighlight", q: hover.q, r: hover.r, world: axialToPixel(hover.q, hover.r) });
  }

  // Trade-route caravan markers (docs/wagons-stockpiles-trade-routes-plan.md
  // §5.2): pre-resolved by the caller (a still-loading caravan never gets
  // this far) and fog-gated exactly like hero and castle nodes -- a caravan
  // hidden in enemy fog is invisible. Emitted after the path/overlay layers
  // and before heroes so the marker paints with the entity layer, with a
  // hero drawing above a caravan sharing its tile.
  for (const caravan of opts.caravans ?? []) {
    const canSee = caravan.ownerId === opts.viewPlayerId || isVisible(visible, caravan.q, caravan.r);
    if (!canSee) continue;
    const base = axialToPixel(caravan.q, caravan.r);
    const ox = caravan.pixelOffset?.x ?? 0;
    const oy = caravan.pixelOffset?.y ?? 0;
    const moveProgress = caravan.moveProgress ?? 1;
    const bobAmplitude = 3;
    const swingPhase = moveProgress * Math.PI * 2;
    const bobY = caravan.moving ? -Math.sin(swingPhase) * bobAmplitude : 0;
    nodes.push({
      kind: "caravanMarker",
      q: caravan.q,
      r: caravan.r,
      world: { x: base.x + ox, y: base.y + oy + bobY },
      ...(caravan.moving || ox !== 0 || oy !== 0 ? { markerWorld: { x: base.x + ox, y: base.y + oy } } : {}),
      color: opts.colorForOwner(caravan.ownerId),
      wagons: caravan.wagons,
      ...(caravan.payloadKind !== undefined ? { payloadKind: caravan.payloadKind } : {}),
      ...(caravan.facingDirection !== undefined ? { facingDirection: caravan.facingDirection } : {}),
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
    const runFrame: 0 | 1 = hero.moving && Math.floor(hero.moveProgress * 2) % 2 === 1 ? 1 : 0;
    const fadeAlpha = hero.ownerId !== opts.viewPlayerId ? opts.heroAlpha?.[hero.id] : undefined;
    const node: HeroNode = {
      kind: "hero",
      heroId: hero.id,
      ownerId: hero.ownerId,
      world: { x: base.x + hero.pixelOffset.x, y: base.y + hero.pixelOffset.y + bobY },
      markerWorld: { x: base.x + hero.pixelOffset.x, y: base.y + hero.pixelOffset.y },
      facingDirection: hero.facingDirection,
      horseVariant: hero.horseVariant,
      faction: hero.faction,
      scaleY,
      runFrame,
      color: opts.colorForOwner(hero.ownerId),
      selected: opts.selectedHeroId === hero.id,
    };
    if (fadeAlpha !== undefined && fadeAlpha < 1) node.alpha = fadeAlpha;
    nodes.push(node);
  }

  return nodes;
}

interface TerritoryCoord {
  q: number;
  r: number;
  key: string;
}

interface TerritoryPartitionCache {
  settlementSig: string;
  partitionedCoords: Map<number, TerritoryCoord[]>;
}

interface TerritoryEdgesCache {
  settlementSig: string;
  colorSig: string;
  visHash: number;
  visCount: number;
  edges: TerritoryOutlineEdgeNode[];
}

let territoryPartitionCache: TerritoryPartitionCache | null = null;
let territoryEdgesCache: TerritoryEdgesCache | null = null;

function buildTerritoryOutlineEdges(
  castles: readonly Castle[],
  colorForOwner: (ownerId: number | null) => string,
  mapWidth: number,
  mapHeight: number,
  visible: Set<string>,
): TerritoryOutlineEdgeNode[] {
  const owned = castles.filter((c): c is Castle & { ownerId: number } => c.ownerId !== null);
  if (owned.length === 0) return [];

  let settlementSig = `${mapWidth}x${mapHeight}`;
  for (const c of owned) {
    const dKeys = Object.keys(c.districts ?? {}).sort().join(";");
    settlementSig += `|${c.id}@${c.ownerId}:${c.tile.q},${c.tile.r}:${c.level}[${dKeys}]`;
  }

  if (!territoryPartitionCache || territoryPartitionCache.settlementSig !== settlementSig) {
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

    const partitionedCoords = new Map<number, TerritoryCoord[]>();
    for (const ownerId of groups.keys()) partitionedCoords.set(ownerId, []);

    if (groups.size === 1) {
      const [ownerId, hexes] = [...ownerHexes][0];
      const list = partitionedCoords.get(ownerId)!;
      for (const key of hexes) {
        const comma = key.indexOf(",");
        const q = parseInt(key.slice(0, comma), 10);
        const r = parseInt(key.slice(comma + 1), 10);
        list.push({ q, r, key });
      }
    } else {
      const allHexes = new Set<string>();
      for (const hexes of ownerHexes.values()) {
        for (const h of hexes) allHexes.add(h);
      }
      for (const key of allHexes) {
        const comma = key.indexOf(",");
        const q = parseInt(key.slice(0, comma), 10);
        const r = parseInt(key.slice(comma + 1), 10);
        const winner = resolveControllingSettlement(owned, q, r, mapWidth, mapHeight);
        if (winner && winner.ownerId !== null) {
          partitionedCoords.get(winner.ownerId)?.push({ q, r, key });
        }
      }
    }

    territoryPartitionCache = { settlementSig, partitionedCoords };
  }

  let colorSig = "";
  let visHash = 2166136261;
  let visCount = 0;
  let idx = 0;
  for (const [ownerId, coords] of territoryPartitionCache.partitionedCoords) {
    colorSig += `${ownerId}:${colorForOwner(ownerId)}|`;
    for (let i = 0; i < coords.length; i++) {
      idx++;
      const c = coords[i];
      if (isVisible(visible, c.q, c.r)) {
        visCount++;
        visHash ^= idx;
        visHash = Math.imul(visHash, 16777619);
      }
    }
  }
  visHash >>>= 0;

  if (
    territoryEdgesCache &&
    territoryEdgesCache.settlementSig === settlementSig &&
    territoryEdgesCache.colorSig === colorSig &&
    territoryEdgesCache.visHash === visHash &&
    territoryEdgesCache.visCount === visCount
  ) {
    return territoryEdgesCache.edges;
  }

  const edges: TerritoryOutlineEdgeNode[] = [];
  for (const [ownerId, coords] of territoryPartitionCache.partitionedCoords) {
    const hexSet = new Set<string>();
    for (let i = 0; i < coords.length; i++) {
      const c = coords[i];
      if (isVisible(visible, c.q, c.r)) {
        hexSet.add(c.key);
      }
    }
    if (hexSet.size === 0) continue;
    const color = colorForOwner(ownerId);
    for (const e of territoryBoundaryEdges(hexSet, HEX_SIZE, axialToPixel, hexCorners)) {
      edges.push({ kind: "territoryOutlineEdge", ownerId, color, x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2 });
    }
  }
  territoryEdgesCache = { settlementSig, colorSig, visHash, visCount, edges };
  return edges;
}

function buildPathNodes(heroes: Hero[], path: Axial[], map: GameMap, opts: RenderOptions, visible: Set<string>): SceneNode[] {
  // Path preview and trail render only for the local viewer's OWN selected
  // hero: a foreign selection (e.g. leaked through a turn hand-off) would
  // draw a bright-gold route from a fog-hidden hero's tile, revealing its
  // position. No selection (or a hero the mirror no longer carries) means no
  // path/trail nodes at all.
  const nodes: SceneNode[] = [];
  const selectedHero = opts.selectedHeroId ? heroes.find((h) => h.id === opts.selectedHeroId) : undefined;
  if (selectedHero && selectedHero.ownerId === opts.viewPlayerId && path.length > 0) {
    const pathPx = path.map((t) => axialToPixel(t.q, t.r));
    const originTile = opts.pathOrigin ?? opts.selectedHeroTile ?? { q: selectedHero.tile.q, r: selectedHero.tile.r };
    const originPx = axialToPixel(originTile.q, originTile.r);
    const fullPx = [originPx, ...pathPx];
    // Per-point fog flags, aligned with fullPx: index 0 is the origin tile,
    // index i >= 1 is path[i - 1]. A segment counts as fogged when ANY of the
    // tiles it spans is fogged -- the split index itself is always the last
    // reachable tile, so an "all fogged" rule would never fire on the dim tail.
    const pointFog = [
      !isVisible(visible, originTile.q, originTile.r),
      ...path.map((t) => !isVisible(visible, t.q, t.r)),
    ];

    const splitIdx = Math.min(
      opts.pathReachableIdx ?? computeReachableSplit(path, map, selectedHero.movementRemaining),
      path.length,
    );

    const reachable = slicePoints(fullPx, 0, splitIdx + 1);
    if (reachable.length >= 2) {
      const reachableNode: PathSegmentNode = { kind: "pathSegment", reachable: true, points: reachable };
      if (pointFog.slice(0, splitIdx + 1).some(Boolean)) reachableNode.fogged = true;
      nodes.push(reachableNode);
    }
    if (splitIdx < path.length) {
      const unreachable = slicePoints(fullPx, splitIdx, pathPx.length);
      if (unreachable.length >= 2) {
        const unreachableNode: PathSegmentNode = { kind: "pathSegment", reachable: false, points: unreachable };
        if (pointFog.slice(splitIdx, pathPx.length).some(Boolean)) unreachableNode.fogged = true;
        nodes.push(unreachableNode);
      }
    }

    if (selectedHero.trail.length >= 2) {
      const trailNode: HeroTrailNode = {
        kind: "heroTrail",
        heroId: selectedHero.id,
        color: opts.colorForOwner(selectedHero.ownerId),
        points: selectedHero.trail.slice(-25).map((p) => axialToPixel(p.q, p.r)),
      };
      nodes.push(trailNode);
    }
  }

  // Enemy trails: a visible foreign hero shows where it walked from. The trail
  // points are NOT fog-gated -- walking out of the fog is the whole reveal.
  for (const hero of heroes) {
    if (hero.ownerId === opts.viewPlayerId) continue;
    if (!isVisible(visible, hero.tile.q, hero.tile.r)) continue;
    if (hero.trail.length < 2) continue;
    const trailNode: HeroTrailNode = {
      kind: "heroTrail",
      heroId: hero.id,
      color: opts.colorForOwner(hero.ownerId),
      points: hero.trail.slice(-8).map((p) => axialToPixel(p.q, p.r)),
      intensity: 0.45,
    };
    nodes.push(trailNode);
  }

  return nodes;
}

function slicePoints(points: WorldPoint[], fromIdx: number, toIdx: number): WorldPoint[] {
  if (toIdx <= fromIdx) return [];
  return points.slice(fromIdx, toIdx);
}
