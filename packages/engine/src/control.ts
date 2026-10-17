import { HEX_DIRECTIONS, hexDistance } from "@heroes/contracts";
import type { Axial, CastleLevel, BuildingDef } from "@heroes/contracts";
import { computeSettlementBonuses } from "./buildingModifiers";

export function districtKey(q: number, r: number): string {
  return `${q},${r}`;
}

export type ControllableSettlementLike = {
  id: string;
  ownerId: number | null;
  level: CastleLevel;
  q?: number;
  r?: number;
  tile?: Axial;
  districts?: Record<string, { q: number; r: number; buildings?: BuildingDef[] }>;
};

function isIterable<T>(value: Iterable<T> | Record<string, T>): value is Iterable<T> {
  return typeof (value as Iterable<T>)[Symbol.iterator] === "function";
}

function settlementCenter(s: ControllableSettlementLike): Axial | undefined {
  if (s.tile) return { q: s.tile.q, r: s.tile.r };
  if (typeof s.q === "number" && typeof s.r === "number") return { q: s.q, r: s.r };
  return undefined;
}

export function resolveControllingSettlement<T extends ControllableSettlementLike>(
  settlements: Iterable<T> | Record<string, T>,
  q: number,
  r: number,
  mapWidth: number,
  mapHeight: number,
): T | undefined {
  if (q < 0 || r < 0 || q >= mapWidth || r >= mapHeight) return undefined;
  const list: T[] = isIterable(settlements) ? Array.from(settlements) : Object.values(settlements);
  const target: Axial = { q, r };
  const key = districtKey(q, r);
  const matching: Array<{ settlement: T; dist: number; hasDistrict: boolean }> = [];

  for (const s of list) {
    if (s.ownerId === null || s.ownerId === undefined) continue;
    const center = settlementCenter(s);
    if (!center) continue;
    const dist = hexDistance(center, target);
    if (dist <= controlRange(s.level)) {
      matching.push({
        settlement: s,
        dist,
        hasDistrict: Boolean(s.districts?.[key]),
      });
    }
  }

  if (matching.length === 0) return undefined;

  const anyHasDistrict = matching.some((m) => m.hasDistrict);
  const pool = anyHasDistrict ? matching.filter((m) => m.hasDistrict) : matching;

  pool.sort((a, b) => {
    if (a.dist !== b.dist) return a.dist - b.dist;
    const idCmp = a.settlement.id.localeCompare(b.settlement.id);
    if (idCmp !== 0) return idCmp;
    return (a.settlement.ownerId ?? 0) - (b.settlement.ownerId ?? 0);
  });

  return pool[0].settlement;
}

export function controlRange(level: CastleLevel, buildings?: BuildingDef[]): number {
  let range = level;
  if (buildings) {
    range += computeSettlementBonuses(buildings).controlRangeBonus;
  }
  return range;
}

export function settlementRateRadius(level: CastleLevel): number {
  // Cannot be `level - 1`: that would give an L1 settlement a radius of 0, i.e. a
  // scan of its own tile alone -- and castles may not stand on a resource tile
  // (see map/castlePlacement.ts), so L1 settlements would earn provably nothing.
  return level;
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
