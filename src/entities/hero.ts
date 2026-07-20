import { Axial, axialToPixel } from "../core/hex";
import type { Faction as StateFaction, HeroId, HeroState, PlayerId } from "../state/gameState";

export type Faction = "player" | "enemy";

export class Hero {
  tile: Axial;
  fromTile: Axial;
  toTile: Axial;
  moveProgress = 1;
  moving = false;
  pixelOffset = { x: 0, y: 0 };
  moveDurationMs = 220;
  faction: Faction;
  id: string;
  ownerId: PlayerId;
  movementRemaining: number;

  constructor(
    id: string,
    q: number,
    r: number,
    faction: Faction,
    ownerId: PlayerId,
    movementRemaining = 7
  ) {
    this.id = id;
    this.tile = { q, r };
    this.fromTile = { q, r };
    this.toTile = { q, r };
    this.faction = faction;
    this.ownerId = ownerId;
    this.movementRemaining = movementRemaining;
  }

  startMoveTo(target: Axial) {
    if (this.moving) return;
    if (target.q === this.tile.q && target.r === this.tile.r) return;
    this.fromTile = { ...this.tile };
    this.toTile = { ...target };
    this.moveProgress = 0;
    this.moving = true;
  }

  update(dtMs: number) {
    if (!this.moving) {
      this.pixelOffset = { x: 0, y: 0 };
      return;
    }
    this.moveProgress = Math.min(1, this.moveProgress + dtMs / this.moveDurationMs);
    const t = easeInOutQuad(this.moveProgress);
    const from = axialToPixel(this.fromTile.q, this.fromTile.r);
    const to = axialToPixel(this.toTile.q, this.toTile.r);
    this.pixelOffset = {
      x: (to.x - from.x) * t,
      y: (to.y - from.y) * t,
    };
    if (this.moveProgress >= 1) {
      this.moving = false;
      this.tile = { ...this.toTile };
      this.pixelOffset = { x: 0, y: 0 };
    }
  }

  syncFromState(s: HeroState): void {
    this.ownerId = s.ownerId;
    this.movementRemaining = s.movementRemaining;
    if (!this.moving) {
      this.tile = { q: s.q, r: s.r };
      this.fromTile = { q: s.q, r: s.r };
      this.toTile = { q: s.q, r: s.r };
    }
  }

  toGameState(): HeroState {
    return {
      id: this.id as HeroId,
      ownerId: this.ownerId,
      q: this.tile.q,
      r: this.tile.r,
      movementRemaining: this.movementRemaining,
      previousQ: null,
      previousR: null,
      previousMovementRemaining: null,
    };
  }

  static fromGameState(s: HeroState): Hero {
    const faction: Faction = mapFactionFromOwner(s.ownerId);
    return new Hero(s.id, s.q, s.r, faction, s.ownerId, s.movementRemaining);
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
