import { Axial, axialToPixel } from "../core/hex";
import type { Faction as StateFaction, HeroId, HeroState, PlayerId } from "../state/gameState";
import { normalizeStacks, type UnitStack } from "../state/units";
import { settings } from "../state/settings";

export type Faction = "player" | "enemy";

/** 8-way direction for isometric/hex entities (heroes, horses, etc.) */
export type Direction = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

/** Alias for backward compatibility */
export type HeroDirection = Direction;

// Hex neighbor directions and their corresponding HeroDirection names
// Matches NEIGHBOR_DIRS in pathfinding.ts
const DELTA_TO_DIRECTION: Array<{ dq: number; dr: number; dir: HeroDirection }> = [
  { dq: 1, dr: 0, dir: "e" },      // +q = east
  { dq: 1, dr: -1, dir: "ne" },    // +q-r = northeast
  { dq: 0, dr: -1, dir: "nw" },    // -r = northwest
  { dq: -1, dr: 0, dir: "w" },     // -q = west
  { dq: -1, dr: 1, dir: "sw" },    // -q+r = southwest
  { dq: 0, dr: 1, dir: "se" },     // +r = southeast
];

export function directionFromDelta(dq: number, dr: number): HeroDirection {
  // Find matching hex direction by exact delta match
  for (const entry of DELTA_TO_DIRECTION) {
    if (entry.dq === dq && entry.dr === dr) {
      return entry.dir;
    }
  }
  // Fallback: use angle-based calculation for non-standard deltas
  return directionFromAngleFallback(dq, dr);
}

export function directionFromAngle(angle: number): HeroDirection {
  const dirs: HeroDirection[] = ["e", "se", "s", "sw", "w", "nw", "n", "ne"];
  const idx = Math.round(((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / (Math.PI / 4)) % 8;
  return dirs[idx];
}

function directionFromAngleFallback(dq: number, dr: number): HeroDirection {
  const sq = dq * Math.sqrt(3);
  const sr = dr * 1.5;
  const angle = Math.atan2(sr, sq);
  return directionFromAngle(angle);
}

export class Hero {
  tile: Axial;
  fromTile: Axial;
  toTile: Axial;
  animationPath: Axial[];
  segIdx = 0;
  moveProgress = 1;
  moving = false;
  pixelOffset = { x: 0, y: 0 };
  faction: Faction;
  id: string;
  name: string;
  ownerId: PlayerId;
  movementRemaining: number;
  trail: Axial[];
  gold: number;
  troops: number;
  stacks: UnitStack[];
  facingDirection: HeroDirection = "n";

  constructor(
    id: string,
    name: string,
    q: number,
    r: number,
    faction: Faction,
    ownerId: PlayerId,
    movementRemaining = 7,
    trail?: Axial[],
    gold = 0,
    troops = 1,
    stacks?: UnitStack[]
  ) {
    this.id = id;
    this.name = name;
    this.tile = { q, r };
    this.fromTile = { q, r };
    this.toTile = { q, r };
    this.animationPath = [{ q, r }];
    this.faction = faction;
    this.ownerId = ownerId;
    this.movementRemaining = movementRemaining;
    this.trail = trail ?? [{ q, r }];
    this.gold = gold;
    this.troops = troops;
    this.stacks = normalizeStacks(stacks);
  }

  get moveDurationMs(): number {
    return settings().moveDurationMs;
  }

  startMoveToPath(path: Axial[]) {
    if (path.length < 2) {
      this.tile = { ...path[0] };
      this.fromTile = this.tile;
      this.toTile = this.tile;
      this.animationPath = [this.tile];
      this.segIdx = 0;
      this.moveProgress = 1;
      this.moving = false;
      this.pixelOffset = { x: 0, y: 0 };
      return;
    }
    this.animationPath = path.map((p) => ({ q: p.q, r: p.r }));
    this.segIdx = 0;
    this.tile = this.animationPath[0];
    this.fromTile = this.animationPath[0];
    this.toTile = this.animationPath[1];
    this.moveProgress = 0;
    this.moving = true;
    this.pixelOffset = { x: 0, y: 0 };
    this.facingDirection = directionFromDelta(
      this.toTile.q - this.fromTile.q,
      this.toTile.r - this.fromTile.r
    );
  }

  update(dtMs: number) {
    if (!this.moving) {
      this.pixelOffset = { x: 0, y: 0 };
      return;
    }
    const duration = this.moveDurationMs;
    this.moveProgress = Math.min(1, this.moveProgress + dtMs / duration);
    const t = easeInOutQuad(this.moveProgress);
    const from = axialToPixel(this.fromTile.q, this.fromTile.r);
    const to = axialToPixel(this.toTile.q, this.toTile.r);
    this.pixelOffset = {
      x: (to.x - from.x) * t,
      y: (to.y - from.y) * t,
    };
    if (this.moveProgress >= 1) {
      this.segIdx++;
      if (this.segIdx >= this.animationPath.length - 1) {
        this.moving = false;
        const last = this.animationPath[this.animationPath.length - 1];
        this.tile = { ...last };
        this.fromTile = this.tile;
        this.toTile = this.tile;
        this.pixelOffset = { x: 0, y: 0 };
      } else {
        this.tile = { ...this.animationPath[this.segIdx] };
        this.fromTile = { ...this.animationPath[this.segIdx] };
        this.toTile = { ...this.animationPath[this.segIdx + 1] };
        this.moveProgress = 0;
        this.facingDirection = directionFromDelta(
          this.toTile.q - this.fromTile.q,
          this.toTile.r - this.fromTile.r
        );
      }
    }
  }

  syncFromState(s: HeroState): void {
    this.ownerId = s.ownerId;
    this.movementRemaining = s.movementRemaining;
    this.trail = (s.trail ?? []).map((p) => ({ q: p.q, r: p.r }));
    this.gold = s.gold ?? 0;
    this.troops = s.troops ?? 1;
    this.stacks = normalizeStacks(s.stacks);
    if (this.moving) return;
    if (this.tile.q === s.q && this.tile.r === s.r) return;
    const start: Axial = { ...this.tile };
    this.tile = { q: s.q, r: s.r };
    this.fromTile = { ...start };
    this.toTile = { ...this.tile };
  }

  toGameState(): HeroState {
    return {
      id: this.id as HeroId,
      name: this.name,
      ownerId: this.ownerId,
      q: this.tile.q,
      r: this.tile.r,
      movementRemaining: this.movementRemaining,
      previousQ: null,
      previousR: null,
      previousMovementRemaining: null,
      trail: this.trail.map((p) => ({ q: p.q, r: p.r })),
      gold: this.gold,
      troops: this.troops,
      stacks: normalizeStacks(this.stacks),
    };
  }

  static fromGameState(s: HeroState): Hero {
    const faction: Faction = mapFactionFromOwner(s.ownerId);
    return new Hero(
      s.id,
      s.name,
      s.q,
      s.r,
      faction,
      s.ownerId,
      s.movementRemaining,
      (s.trail ?? []).map((p) => ({ q: p.q, r: p.r })),
      s.gold ?? 0,
      s.troops ?? 1,
      s.stacks
    );
  }
}

function mapFactionFromOwner(ownerId: PlayerId): Faction {
  return ownerId === 0 ? "player" : "enemy";
}

export function factionForOwner(faction: StateFaction): Faction {
  return faction === "player" ? "player" : "enemy";
}

function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
