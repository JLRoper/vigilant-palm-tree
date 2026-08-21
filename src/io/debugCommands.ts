import type { HeroId } from "@heroes/contracts";
import { findPath } from "../map/pathfinding";
import { TERRAIN_COST } from "../map/terrain";
import { axialToPixel } from "../core/hex";
import type { EventLog, LogEntry, LogQuery, LogStats } from "../debug/eventLog";
import type { DevConsoleHandle } from "../debug/devConsole";
import { settings, updateSettings, DEFAULT_SETTINGS, type GameSettings } from "../state/settings";

export interface AttachDebugApiEngine {
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
  eventLog?: EventLog | null;
  consoleHandle?: DevConsoleHandle | null;
  setConsoleHandle?: (handle: DevConsoleHandle | null) => void;
}

/**
 * Attaches the __gameDebug API to window.
 * All heavy logic delegates back to the engine via the provided callbacks.
 */
export function attachDebugApi(engine: AttachDebugApiEngine): void {
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
        if (cumulative >= hero.movementRemaining) break;
        cumulative += stepCost;
        reachableIdx = i + 1;
        actualCost = Math.min(cumulative, hero.movementRemaining);
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
      return true;
    },

    // Injects a charter directly into local state for rendering purposes --
    // the adventure scene's charter overlay only ever reads targetQ/targetR/
    // phase (see CharterPainter.ts / adventureScene.ts), so this skips the
    // real startCharter command/reducer/server round-trip entirely rather
    // than fighting commandHandler.ts's granular-vs-JSONB-storage gate on
    // StartCharter persistence (server/app/commandHandler.ts's "Source gate
    // FIRST" comment) for a game that was never migrated to granular tables.
    debugInjectCharter: (heroId: HeroId, targetQ: number, targetR: number, phase: "traveling" | "constructing", settlementName: string) => {
      const tc = engine.state.getTurnController();
      const gs = tc.getState();
      const hero = gs.heroes[heroId];
      if (!hero) return false;
      const charter = {
        id: `debug-ch-${heroId}`,
        heroId,
        ownerId: hero.ownerId,
        targetQ,
        targetR,
        settlementName,
        phase,
        daysRemaining: 10, // cosmetic only -- not read by the render path
        settlementId: `debug-s-${heroId}`,
        resourceRates: {},
        foundedOnResource: null,
        citySpots: [],
      };
      engine.state.replaceState({
        ...gs,
        activeCharters: [...gs.activeCharters.filter((c: any) => c.heroId !== heroId), charter],
        dirty: true,
      });
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

    eventLog: engine.eventLog ?? null,

    events: (() => {
      const log: EventLog | null | undefined = engine.eventLog;
      return {
        available: () => log !== null && log !== undefined,
        subscribe: (handler: (entry: LogEntry) => void): (() => void) => {
          if (!log) throw new Error("eventLog not attached");
          return log.subscribe(handler);
        },
        getEntries: (query?: LogQuery): LogEntry[] => {
          if (!log) return [];
          return log.getEntries(query);
        },
        clear: (): void => {
          if (log) log.clear();
        },
        stats: (): LogStats | null => (log ? log.stats() : null),
        setCapacity: (n: number): void => {
          if (log) log.setCapacity(n);
        },
      };
    })(),

    console: {
      get isOpen(): boolean {
        return !!engine.consoleHandle;
      },
      get isPinned(): boolean {
        return !!engine.consoleHandle?.isPinned();
      },
      show: (): void => {
        engine.consoleHandle?.show();
      },
      hide: (): void => {
        engine.consoleHandle?.hide();
      },
      togglePin: (): boolean => {
        return engine.consoleHandle?.togglePin() ?? false;
      },
      setPinned: (value: boolean): void => {
        engine.consoleHandle?.setPinned(value);
      },
    },

    settings: {
      get: () => settings(),
      update: (patch: Partial<GameSettings>) => updateSettings(patch),
      reset: () => updateSettings({ ...DEFAULT_SETTINGS }),
    },
  };
}
