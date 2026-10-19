import type { Hero } from "../entities/hero";
import type { Castle } from "../entities/settlement";
import type { GameState } from "../state/gameState";
import { hexDistance, type Axial } from "../core/hex";
import { caravanTile, controlRange, HERO_VISION_RANGE } from "@heroes/engine";

export const VISION_RANGE = HERO_VISION_RANGE;
/** Caravans are scouts-lite: a 2-tile ring around every own wagon, smaller than a hero's 4. */
export const CARAVAN_VISION_RANGE = 2;

type CaravanVisionSource = { q: number; r: number; ownerId: number };

const VISION_GRID_OFFSET = 32;
const VISION_GRID_STRIDE = 256;

export class VisionSet extends Set<string> {
  readonly signature: string;
  private readonly grid = new Uint8Array(VISION_GRID_STRIDE * VISION_GRID_STRIDE);

  constructor(signature: string) {
    super();
    this.signature = signature;
  }

  hasCoords(q: number, r: number): boolean {
    const gq = q + VISION_GRID_OFFSET;
    const gr = r + VISION_GRID_OFFSET;
    if ((gq >>> 8) === 0 && (gr >>> 8) === 0) {
      return this.grid[(gr << 8) | gq] === 1;
    }
    return super.has(`${q},${r}`);
  }

  addCoords(q: number, r: number): void {
    const gq = q + VISION_GRID_OFFSET;
    const gr = r + VISION_GRID_OFFSET;
    if ((gq >>> 8) === 0 && (gr >>> 8) === 0) {
      const idx = (gr << 8) | gq;
      if (this.grid[idx] === 1) return;
      this.grid[idx] = 1;
    }
    super.add(`${q},${r}`);
  }

  override add(value: string): this {
    const comma = value.indexOf(",");
    if (comma > 0) {
      const q = Number(value.slice(0, comma));
      const r = Number(value.slice(comma + 1));
      if (Number.isInteger(q) && Number.isInteger(r)) {
        const gq = q + VISION_GRID_OFFSET;
        const gr = r + VISION_GRID_OFFSET;
        if ((gq >>> 8) === 0 && (gr >>> 8) === 0) {
          this.grid[(gr << 8) | gq] = 1;
        }
      }
    }
    return super.add(value);
  }

  override delete(value: string): boolean {
    const comma = value.indexOf(",");
    if (comma > 0) {
      const q = Number(value.slice(0, comma));
      const r = Number(value.slice(comma + 1));
      if (Number.isInteger(q) && Number.isInteger(r)) {
        const gq = q + VISION_GRID_OFFSET;
        const gr = r + VISION_GRID_OFFSET;
        if ((gq >>> 8) === 0 && (gr >>> 8) === 0) {
          this.grid[(gr << 8) | gq] = 0;
        }
      }
    }
    return super.delete(value);
  }

  override clear(): void {
    this.grid.fill(0);
    super.clear();
  }
}

let lastVisionCache: VisionSet | null = null;
let lastStateVisionCache: VisionSet | null = null;

export function computeVision(
  heroes: readonly Hero[],
  castles: readonly Castle[],
  viewPlayerId: number,
  range: number = VISION_RANGE,
  caravans: readonly CaravanVisionSource[] = [],
): VisionSet {
  let sig = `${viewPlayerId}:${range}|H`;
  for (const hero of heroes) {
    if (hero.ownerId !== viewPlayerId) continue;
    sig += `;${hero.tile.q},${hero.tile.r}`;
  }
  sig += "|C";
  for (const c of castles) {
    if (c.ownerId !== viewPlayerId) continue;
    sig += `;${c.tile.q},${c.tile.r},${controlRange(c.level, c.buildings)}`;
  }
  sig += "|V";
  for (const c of caravans) {
    if (c.ownerId !== viewPlayerId) continue;
    sig += `;${c.q},${c.r}`;
  }
  if (lastVisionCache && lastVisionCache.signature === sig) {
    return lastVisionCache;
  }

  const visible = new VisionSet(sig);
  for (const hero of heroes) {
    if (hero.ownerId !== viewPlayerId) continue;
    addRingCoords(visible, hero.tile, range);
  }
  for (const c of castles) {
    if (c.ownerId !== viewPlayerId) continue;
    addRingCoords(visible, c.tile, controlRange(c.level, c.buildings));
  }
  for (const c of caravans) {
    if (c.ownerId !== viewPlayerId) continue;
    addRingCoords(visible, { q: c.q, r: c.r }, CARAVAN_VISION_RANGE);
  }
  lastVisionCache = visible;
  return visible;
}

/** Own-seat caravan tiles, resolved from live trade routes (the loading ones have no marker and no vision). */
function caravanVisionSourcesFromState(state: GameState): CaravanVisionSource[] {
  const sources: CaravanVisionSource[] = [];
  for (const route of state.tradeRoutes ?? []) {
    const caravan = route.caravan;
    if (!caravan) continue;
    const origin =
      route.from.kind === "settlement" ? state.settlements[route.from.id] : state.heroes[route.from.id];
    if (!origin || origin.ownerId === null) continue;
    const tile = caravanTile(caravan, { q: origin.q, r: origin.r });
    sources.push({ q: tile.q, r: tile.r, ownerId: origin.ownerId });
  }
  return sources;
}

export function computeVisionFromState(
  state: GameState,
  viewPlayerId: number,
  range: number = VISION_RANGE,
): VisionSet {
  const caravanSources = caravanVisionSourcesFromState(state);
  let sig = `${viewPlayerId}:${range}|H`;
  for (const hero of Object.values(state.heroes)) {
    if (hero.ownerId !== viewPlayerId) continue;
    sig += `;${hero.q},${hero.r}`;
  }
  sig += "|C";
  for (const s of Object.values(state.settlements)) {
    if (s.ownerId !== viewPlayerId) continue;
    sig += `;${s.q},${s.r},${controlRange(s.level, s.buildings)}`;
  }
  sig += "|V";
  for (const c of caravanSources) {
    if (c.ownerId !== viewPlayerId) continue;
    sig += `;${c.q},${c.r}`;
  }
  if (lastStateVisionCache && lastStateVisionCache.signature === sig) {
    return lastStateVisionCache;
  }

  const visible = new VisionSet(sig);
  for (const hero of Object.values(state.heroes)) {
    if (hero.ownerId !== viewPlayerId) continue;
    addRingCoords(visible, { q: hero.q, r: hero.r }, range);
  }
  for (const s of Object.values(state.settlements)) {
    if (s.ownerId !== viewPlayerId) continue;
    addRingCoords(visible, { q: s.q, r: s.r }, controlRange(s.level, s.buildings));
  }
  for (const c of caravanSources) {
    if (c.ownerId !== viewPlayerId) continue;
    addRingCoords(visible, { q: c.q, r: c.r }, CARAVAN_VISION_RANGE);
  }
  lastStateVisionCache = visible;
  return visible;
}

function addRingCoords(out: VisionSet, center: Axial, range: number): void {
  for (let dq = -range; dq <= range; dq++) {
    for (let dr = -range; dr <= range; dr++) {
      if (Math.abs(dq + dr) > range) continue;
      out.addCoords(center.q + dq, center.r + dr);
    }
  }
}

export function isVisible(visible: Set<string>, q: number, r: number): boolean {
  if (visible instanceof VisionSet) {
    return visible.hasCoords(q, r);
  }
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
