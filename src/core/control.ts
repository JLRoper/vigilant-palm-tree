import { HEX_DIRECTIONS, type Axial } from "./hex";
import type { CastleLevel } from "../entities/settlement";
import type { BuildingDef } from "../render/cityBuildingDraw";
import { computeSettlementBonuses } from "./buildingModifiers";

export function controlRange(level: CastleLevel, buildings?: BuildingDef[]): number {
  let range = level;
  if (buildings) {
    range += computeSettlementBonuses(buildings).controlRangeBonus;
  }
  return range;
}

export function settlementRateRadius(level: CastleLevel): number {
  return level - 1;
}

export function controlledPositions(
  center: Axial,
  level: CastleLevel,
  mapWidth: number,
  mapHeight: number,
): Set<string> {
  const range = controlRange(level);
  const set = new Set<string>();
  for (let dq = -range; dq <= range; dq++) {
    for (let dr = -range; dr <= range; dr++) {
      if (Math.abs(dq + dr) > range) continue;
      const q = center.q + dq;
      const r = center.r + dr;
      if (q < 0 || q >= mapWidth || r < 0 || r >= mapHeight) continue;
      set.add(`${q},${r}`);
    }
  }
  return set;
}

export function territoryBoundaryEdges(
  controlled: Set<string>,
  hexSize: number,
  toPixel: (q: number, r: number, size: number) => { x: number; y: number },
  cornersFn: (cx: number, cy: number, size: number) => { x: number; y: number }[],
): { x1: number; y1: number; x2: number; y2: number }[] {
  const edges: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (const key of controlled) {
    const [qs, rs] = key.split(",");
    const q = parseInt(qs, 10);
    const r = parseInt(rs, 10);
    const { x: cx, y: cy } = toPixel(q, r, hexSize);
    const corners = cornersFn(cx, cy, hexSize);
    for (let edge = 0; edge < 6; edge++) {
      const { q: dq, r: dr } = HEX_DIRECTIONS[edge];
      const nKey = `${q + dq},${r + dr}`;
      if (controlled.has(nKey)) continue;
      const c1 = corners[edge];
      const c2 = corners[(edge + 1) % 6];
      edges.push({ x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y });
    }
  }
  return edges;
}
