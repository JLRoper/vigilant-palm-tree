import {
  axialToPixel,
  hexCorners,
  HEX_DIRECTIONS,
  hexDistance,
  nearestHexEdge,
  pixelToAxial,
  type Axial,
} from "../../../core/hex";
import {
  computeSpecialty,
  totalHealth,
  totalUnits,
  type BattleSide,
  type Combatant,
  type ManualBattleState,
} from "@heroes/engine";
import { CANVAS_MARGIN, HEX_SIZE_MAX, HEX_SIZE_MIN, SPECIALTY_VISIBILITY_THRESHOLD } from "./constants";

export {
  axialToPixel,
  hexCorners,
  HEX_DIRECTIONS,
  hexDistance,
  nearestHexEdge,
  pixelToAxial,
};
export type { Axial };

export function fmtHex(h: Axial): string {
  return `(${h.q},${h.r})`;
}

export function platoonLabel(side: BattleSide, slotIndex: number): string {
  return `${side}#${slotIndex}`;
}

export interface GridExtent {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function gridExtent(state: ManualBattleState, size: number): GridExtent {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const hex of state.grid.hexes) {
    const { x, y } = axialToPixel(hex.q, hex.r, size);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

export function fitHexSize(unitExtent: GridExtent, availW: number, availH: number): number {
  const spanX = unitExtent.maxX - unitExtent.minX;
  const spanY = unitExtent.maxY - unitExtent.minY;
  const byWidth = (availW - CANVAS_MARGIN * 2) / (spanX + 2);
  const byHeight = (availH - CANVAS_MARGIN * 2) / (spanY + 2);
  return Math.max(HEX_SIZE_MIN, Math.min(HEX_SIZE_MAX, Math.floor(Math.min(byWidth, byHeight))));
}

const SPECIALTY_ICONS: Record<string, string> = {
  archery: "🏹",
  shield: "🛡",
  pike: "🔱",
  sword: "⚔",
  cavalry: "🐎",
  monster: "🐲",
  prayer: "✨",
  militia: "👥",
};

export function specialtyIcon(specialty: string): string {
  return SPECIALTY_ICONS[specialty] ?? "⚔";
}

export function isAlive(c: Combatant): boolean {
  return !c.retreated && c.entries.some((e) => e.count > 0);
}

export function visibleSpecialty(
  state: ManualBattleState,
  c: Combatant,
): { tag: string; dominant: number; total: number } | null {
  const specialty = computeSpecialty(c.entries, state.unitTypes);
  if (!specialty) return null;
  const total = totalUnits(c.entries);
  if (total === 0) return null;
  let dominant = 0;
  for (const e of c.entries) {
    if (e.count <= 0) continue;
    if (state.unitTypes[e.unitTypeId]?.specialty === specialty) dominant += e.count;
  }
  return dominant / total >= SPECIALTY_VISIBILITY_THRESHOLD ? { tag: specialty, dominant, total } : null;
}

export function hpRatio(state: ManualBattleState, c: Combatant): number {
  return c.maxHealth > 0 ? totalHealth(c.entries, state.unitTypes) / c.maxHealth : 0;
}

export function hpColor(pct: number): string {
  return pct > 0.5 ? "#4caf50" : pct > 0.25 ? "#ffb300" : "#e53935";
}