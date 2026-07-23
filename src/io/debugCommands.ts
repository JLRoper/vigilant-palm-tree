import type { HeroId } from "../state/gameState";
import { findPath } from "../map/pathfinding";
import { TERRAIN_COST } from "../map/terrain";
import { axialToPixel } from "../core/hex";

/**
 * Attaches the __gameDebug API to window.
 * All heavy logic delegates back to the engine via the provided callbacks.
 */
export function attachDebugApi(engine: {
  getState: () => any;
  getTurnController: () => any;
  handleEndTurn: () => Promise<void>;
  syncFromController: () => void;
  maybeAutoResolveBattle: () => void;
  refresh: () => void;
  state: {
    getState: () => any;
    getTurnController: () => any;
    getGameMap: () => any;
    getHero: (id: string) => any;
    getHeroes: () => any[];
    getSettlements: () => any[];
    rebuildHeroesFromState: () => void;
    replaceState: (s: any) => void;
    syncHeroVisualsToState: () => void;
  };
    view: {
        camera: { zoom: number; x: number; y: number };
        view: { hover: any; lastClickDebug: any };
      };
  session: {
    getActiveGameId: () => number | null;
    getActiveGameName: () => string | null;
  };
}): void {
  (window as any).__gameDebug = {
    getState: () => engine.state.getTurnController()?.getState() ?? engine.state.getState(),
    getGameState: () => engine.state.getState(),
    getTurnController: () => engine.state.getTurnController(),
    endTurn: () => { void engine.handleEndTurn(); },
    setSelectedHero: (id: HeroId) => engine.state.getTurnController().selectHero(id),

    requestMove: (id: HeroId, q: number, r: number) => {
      const tc = engine.state.getTurnController();
      const gs = tc.getState();
      const hero = gs.heroes[id];
      if (!hero) return false;
      const gm = engine.state.getGameMap();
      const newPath = findPath(gm, { q: hero.q, r: hero.r }, { q, r });
      if (newPath.length === 0) return false;

      let cumulative = 0, reachableIdx = 0, actualCost = 0;
      for (let i = 0; i < newPath.length; i++) {
        const t = gm.get(newPath[i].q, newPath[i].r);
        const stepCost = t ? (TERRAIN_COST as Record<string, number>)[t] : 1;
        if (!Number.isFinite(stepCost) || stepCost <= 0) break;
        if (cumulative + stepCost > hero.movementRemaining) break;
        cumulative += stepCost;
        reachableIdx = i + 1;
        actualCost = cumulative;
      }
      if (reachableIdx === 0) return false;
      const dest = newPath[reachableIdx - 1];
      const trailExtension = newPath.slice(0, reachableIdx);
      const ok = tc.requestMove(id, dest, actualCost, trailExtension);
      if (ok) engine.syncFromController();
      return ok;
    },

    enterBattle: (attackerId: HeroId, defenderId: HeroId) => {
      const tc = engine.state.getTurnController();
      tc.enterBattle(attackerId, defenderId);
      engine.syncFromController();
      engine.maybeAutoResolveBattle();
    },

    captureSettlement: (heroId: HeroId, settlementId: string) => {
      const tc = engine.state.getTurnController();
      const ok = tc.captureSettlement(heroId, settlementId);
      engine.syncFromController();
      engine.refresh();
      return ok;
    },

    tradeResources: (fromId: string, toId: string, resource: "wood" | "stone" | "iron" | "arcane", amount: number) => {
      const tc = engine.state.getTurnController();
      const result = tc.tradeResources(fromId, toId, resource, amount);
      engine.syncFromController();
      engine.refresh();
      return result;
    },

    teleportHero: (id: HeroId, q: number, r: number) => {
      const tc = engine.state.getTurnController();
      const gs = tc.getState();
      const existing = gs.heroes[id];
      if (!existing) return false;
      engine.state.replaceState({
        ...gs,
        heroes: { ...gs.heroes, [id]: { ...existing, q, r, previousQ: null, previousR: null, previousMovementRemaining: null } },
        dirty: true,
      });
      const hero = engine.state.getHero(id);
      if (hero) {
        hero.tile = { q, r };
        hero.fromTile = { q, r };
        hero.toTile = { q, r };
        hero.moving = false;
        hero.pixelOffset = { x: 0, y: 0 };
      }
      engine.state.rebuildHeroesFromState();
      engine.refresh();
      return true;
    },

    getHeroes: () => engine.state.getHeroes().map((h: any) => ({
      id: h.id, q: h.tile.q, r: h.tile.r, ownerId: h.ownerId,
      movementRemaining: h.movementRemaining,
      trail: h.trail.map((p: any) => ({ q: p.q, r: p.r })), gold: h.gold,
    })),

    getSettlements: () => engine.state.getSettlements().map((c: any) => ({
      id: c.id, q: c.tile.q, r: c.tile.r, level: c.level, ownerId: c.ownerId,
    })),

    get hover() { return engine.view.view?.hover ?? null; },
    get lastClick() { return engine.view.view?.lastClickDebug ?? null; },
    get phase() { return engine.state.getState().phase; },
    get round() { return engine.state.getState().round; },
    get activeGameId() { return engine.session.getActiveGameId(); },
    get activeGameName() { return engine.session.getActiveGameName(); },

    get screenFor() {
      return (q: number, r: number) => {
        const { x: wx, y: wy } = axialToPixel(q, r);
        return { x: wx * engine.view.camera.zoom + engine.view.camera.x, y: wy * engine.view.camera.zoom + engine.view.camera.y };
      };
    },

    isPassable: (q: number, r: number) => engine.state.getGameMap().isPassable(q, r),
    getMoveDurationMs: () => engine.state.getHeroes()[0]?.moveDurationMs ?? 0,
  };
}
