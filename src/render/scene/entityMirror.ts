import type { EngineEvent, GameState } from "@heroes/contracts";
import { Hero } from "../../entities/hero";
import { Castle } from "../../entities/settlement";

// The visual Hero[]/Castle[] tween cache. Fixes the GameEngine.ts pattern of
// wholesale-rebuilding both collections (and force-snapping every hero's
// tile/fromTile/toTile/moving/pixelOffset) on every "state:committed" --
// which discards any in-flight movement animation whenever *anything*
// changes, not just when that hero actually moved.
//
// bootstrap() is the hard resync (initial load, or a full resync fallback
// for event types not handled below). applyEvent() is the soft, targeted
// path meant to run per-event off the event-cursor stream once that exists
// client-side (see plan/2026-08-17-consolidated-phase-1-5-track-map.md
// §7.1/§7.2) -- it only ever touches the fields a given event actually
// carries, so unrelated commits can't interrupt a hero's tween.
//
// EngineEvent's HeroMoved has no `from` field, only `to` -- the mirror's own
// last-known tile for that hero is the tween's start point. Event types with
// no visual-mirror-relevant payload (or whose full apply semantics this
// mirror can't yet reconstruct from the event alone, e.g. HeroRecruited
// lacks starting gold/troops/stacks) are deliberately no-ops here; callers
// should re-bootstrap() from a fresh GameState to pick those up until this
// mirror's event coverage grows.
export class EntityMirror {
  private heroes = new Map<string, Hero>();
  private castles = new Map<string, Castle>();

  bootstrap(state: GameState): void {
    this.heroes = new Map(
      Object.entries(state.heroes).map(([id, h]) => [id, Hero.fromGameState(h)]),
    );
    this.castles = new Map(
      Object.entries(state.settlements).map(([id, s]) => [id, Castle.fromGameState(s)]),
    );
  }

  /** Ticks all mirrored heroes' tween animations. Returns true while at least one is still moving, so a caller's render loop knows whether another frame is needed. */
  update(dtMs: number): boolean {
    let stillMoving = false;
    for (const hero of this.heroes.values()) {
      hero.update(dtMs);
      if (hero.moving) stillMoving = true;
    }
    return stillMoving;
  }

  /** Applies one engine event to the mirror. Returns true if a mirrored entity actually changed. */
  applyEvent(event: EngineEvent): boolean {
    switch (event.type) {
      case "HeroMoved":
        return this.applyHeroMoved(event.heroId, event.to);
      case "SettlementCaptured":
        return this.applySettlementCaptured(event.settlementId, event.actor);
      default:
        return false;
    }
  }

  private applyHeroMoved(heroId: string, to: { q: number; r: number }): boolean {
    const hero = this.heroes.get(heroId);
    if (!hero) return false;
    if (hero.tile.q === to.q && hero.tile.r === to.r) return false;
    hero.startMoveToPath([{ ...hero.tile }, { q: to.q, r: to.r }]);
    return true;
  }

  private applySettlementCaptured(settlementId: string, newOwnerId: number): boolean {
    const castle = this.castles.get(settlementId);
    if (!castle) return false;
    if (castle.ownerId === newOwnerId) return false;
    castle.ownerId = newOwnerId;
    return true;
  }

  getHeroes(): Hero[] {
    return [...this.heroes.values()];
  }

  getSettlements(): Castle[] {
    return [...this.castles.values()];
  }

  getHero(id: string): Hero | undefined {
    return this.heroes.get(id);
  }

  getSettlement(id: string): Castle | undefined {
    return this.castles.get(id);
  }
}
