import { Axial, axialToPixel } from "../core/hex";
import type { Faction as StateFaction, HeroId, HeroState, PlayerId } from "../state/gameState";
import { settings } from "../state/settings";

export type Faction = "player" | "enemy";

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
  ownerId: PlayerId;
  movementRemaining: number;
  trail: Axial[];
  gold: number;

  constructor(
    id: string,
    q: number,
    r: number,
    faction: Faction,
    ownerId: PlayerId,
    movementRemaining = 7,
    trail?: Axial[],
    gold = 0
  ) {
    this.id = id;
    this.tile = { q, r };
    this.fromTile = { q, r };
    this.toTile = { q, r };
    this.animationPath = [{ q, r }];
    this.faction = faction;
    this.ownerId = ownerId;
    this.movementRemaining = movementRemaining;
    this.trail = trail ?? [{ q, r }];
    this.gold = gold;
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
      }
    }
  }

  syncFromState(s: HeroState): void {
    this.ownerId = s.ownerId;
    this.movementRemaining = s.movementRemaining;
    this.trail = (s.trail ?? []).map((p) => ({ q: p.q, r: p.r }));
    this.gold = s.gold ?? 0;
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
      ownerId: this.ownerId,
      q: this.tile.q,
      r: this.tile.r,
      movementRemaining: this.movementRemaining,
      previousQ: null,
      previousR: null,
      previousMovementRemaining: null,
      trail: this.trail.map((p) => ({ q: p.q, r: p.r })),
      gold: this.gold,
    };
  }

  static fromGameState(s: HeroState): Hero {
    const faction: Faction = mapFactionFromOwner(s.ownerId);
    return new Hero(
      s.id,
      s.q,
      s.r,
      faction,
      s.ownerId,
      s.movementRemaining,
      (s.trail ?? []).map((p) => ({ q: p.q, r: p.r })),
      s.gold ?? 0
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
