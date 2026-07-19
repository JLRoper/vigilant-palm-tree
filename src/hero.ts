import { Axial, axialToPixel } from "./hex";

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

  constructor(id: string, q: number, r: number, faction: Faction) {
    this.id = id;
    this.tile = { q, r };
    this.fromTile = { q, r };
    this.toTile = { q, r };
    this.faction = faction;
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
}

function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
