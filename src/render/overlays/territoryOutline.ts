import { Castle } from "../../entities/settlement";
import { controlledPositions, territoryBoundaryEdges } from "../../core/control";
import { axialToPixel, hexCorners, hexDistance, HEX_SIZE } from "../../core/hex";
import { settings } from "../../state/settings";

export function drawTerritoryOutlines(
  ctx: CanvasRenderingContext2D,
  castles: readonly Castle[],
  colorForOwner: (ownerId: number | null) => string,
  mapWidth: number,
  mapHeight: number,
  visible: Set<string>,
): void {
  const owned = castles.filter((c): c is Castle & { ownerId: number } => c.ownerId !== null);
  if (owned.length === 0) return;

  const groups = new Map<number, Castle[]>();
  for (const c of owned) {
    const group = groups.get(c.ownerId);
    if (group) {
      group.push(c);
    } else {
      groups.set(c.ownerId, [c]);
    }
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
  for (const ownerId of groups.keys()) {
    partitioned.set(ownerId, new Set<string>());
  }

  if (groups.size === 1) {
    const [ownerId, hexes] = [...ownerHexes][0];
    for (const key of hexes) {
      if (visible.has(key)) {
        partitioned.get(ownerId)!.add(key);
      }
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

  for (const [ownerId, hexSet] of partitioned) {
    if (hexSet.size === 0) continue;
    const edges = territoryBoundaryEdges(hexSet, HEX_SIZE, axialToPixel, hexCorners);
    const color = colorForOwner(ownerId);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = settings().territoryBorderWidth;
    ctx.globalAlpha = 0.45;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (const e of edges) {
      ctx.moveTo(e.x1, e.y1);
      ctx.lineTo(e.x2, e.y2);
    }
    ctx.stroke();
    ctx.restore();
  }
}
