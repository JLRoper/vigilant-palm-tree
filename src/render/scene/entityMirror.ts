import type { EngineEvent, GameState } from "@heroes/contracts";
import { Hero } from "../../entities/hero";
import { Castle } from "../../entities/settlement";

// The render path's entity view over the canonical Hero/Castle collections.
//
// In production, syncWith() reconciles the store's id -> instance mapping
// against GameStateManager's live collections and stores the SAME instances --
// so MapRenderer.draw() reads exactly the objects the state layer mutates and
// tweens in place per frame.
//
// bootstrap(), applyEvent(), and update() are retained for standalone/headless
// usage, multiplayerSync event application, and unit testing.
export class EntityMirror {
  private heroes = new Map<string, Hero>();
  private castles = new Map<string, Castle>();

  syncWith(
    heroes: readonly Hero[] | Record<string, Hero>,
    castles: readonly Castle[] | Record<string, Castle>,
  ): void {
    this.adopt(this.heroes, Object.values(heroes));
    this.adopt(this.castles, Object.values(castles));
  }

  private adopt<T extends { id: string }>(target: Map<string, T>, collection: T[]): void {
    target.clear();
    for (const entity of collection) {
      target.set(entity.id, entity);
    }
  }

  bootstrap(state: GameState): void {
    this.heroes = new Map(
      Object.entries(state.heroes).map(([id, h]) => [id, Hero.fromGameState(h)]),
    );
    this.castles = new Map(
      Object.entries(state.settlements).map(([id, s]) => [id, Castle.fromGameState(s)]),
    );
  }

  /** Ticks all mirrored heroes' tween animations. Returns true while at least one is still moving. */
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
      case "CharterTravelAdvanced":
        return this.applyHeroMoved(event.heroId, event.to);
      case "SettlementCaptured":
        return this.applySettlementCaptured(event.settlementId, event.actor);
      case "GoldTransferred":
      case "BankGoldMoved":
      case "TurnEnded":
      case "BattleResolved":
      case "HeroRecruited":
      case "TownHallUpgradeStarted":
      case "AutoTradeToggled":
      case "StackReordered":
      case "CharterStarted":
      case "BuildingUpgradeStarted":
      case "SettlementUpgradeStarted":
      case "BuildingsPlaced":
      case "ResourcesTransferred":
      case "WagonsAssigned":
      case "WagonsBought":
      case "TradeRouteCreated":
      case "TradeRouteUpdated":
      case "TradeRouteRemoved":
      case "UnitsRecruited":
      case "UnitsTransferred":
      case "SettlementBattleResolved":
      case "BattleOffered":
        return false;
      default: {
        const exhaustive: never = event;
        void exhaustive;
        return false;
      }
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
