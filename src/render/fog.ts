import type { Hero } from "../entities/hero";
import type { Castle } from "../entities/settlement";
import { hexDistance, type Axial } from "../core/hex";
import { controlRange } from "@heroes/engine";

export const VISION_RANGE = 4;

export function computeVision(
  heroes: readonly Hero[],
  castles: readonly Castle[],
  viewPlayerId: number,
  range: number = VISION_RANGE,
): Set<string> {
  const visible = new Set<string>();
  for (const hero of heroes) {
    if (hero.ownerId !== viewPlayerId) continue;
    addRing(visible, hero.tile, range);
  }
  for (const c of castles) {
    if (c.ownerId !== viewPlayerId) continue;
    addRing(visible, c.tile, controlRange(c.level, c.buildings));
  }
  return visible;
}

function addRing(out: Set<string>, center: Axial, range: number): void {
  for (let dq = -range; dq <= range; dq++) {
    for (let dr = -range; dr <= range; dr++) {
      if (Math.abs(dq + dr) > range) continue;
      const q = center.q + dq;
      const r = center.r + dr;
      out.add(`${q},${r}`);
    }
  }
}

export function isVisible(visible: Set<string>, q: number, r: number): boolean {
  return visible.has(`${q},${r}`);
}

/**
 * Single-tile equivalent of `computeVision(...).has(...)`, without allocating
 * a Set over every hero/castle ring -- for call sites that only need to test
 * one hex (e.g. tile inspection on click) rather than build a frame's full
 * visible set.
 */
export function isTileVisibleTo(
  heroes: readonly Hero[],
  castles: readonly Castle[],
  viewPlayerId: number,
  q: number,
  r: number,
): boolean {
  for (const hero of heroes) {
    if (hero.ownerId !== viewPlayerId) continue;
    if (hexDistance(hero.tile, { q, r }) <= VISION_RANGE) return true;
  }
  for (const c of castles) {
    if (c.ownerId !== viewPlayerId) continue;
    if (hexDistance(c.tile, { q, r }) <= controlRange(c.level, c.buildings)) return true;
  }
  return false;
}

export { hexDistance };
