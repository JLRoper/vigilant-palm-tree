import type { HeroId } from "@heroes/contracts";
import { findPath } from "../map/pathfinding";
import { axialToPixel } from "../core/hex";
import type { EventLog, LogEntry, LogQuery, LogStats } from "../debug/eventLog";
import type { DevConsoleHandle } from "../debug/devConsole";
import type { CityGridDebug } from "@screens/settlements/cityView/cityGridDebug";
import { settings, updateSettings, DEFAULT_SETTINGS, type GameSettings } from "../state/settings";
import type { GameState } from "../state/gameState";

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
  /**
   * The live city-view grid geometry, or null when no city view is open
   * (playthrough ledger #22). Optional so the contract test's fake engine and
   * any catalog-less caller keep working; `cityGrid()` answers null without it.
   */
  getCityGrid?: () => CityGridDebug | null;
}

export interface DebugHeroSnapshot {
  id: string;
  q: number;
  r: number;
  ownerId: number;
  movementRemaining: number;
  trail: Array<{ q: number; r: number }>;
  gold: number;
}

export interface DebugBuildingSnapshot {
  kind: string;
  level: number;
  /** Still under construction: it pays nothing yet (the rule the income passes share). */
  construction: boolean;
  /** The district this building stands in, or null for the settlement's own grid. */
  district: { q: number; r: number } | null;
}

export interface DebugSettlementSnapshot {
  id: string;
  q: number;
  r: number;
  level: number;
  ownerId: number | null;
  /**
   * Every building the settlement holds, main city and districts, with its OWN
   * level (playthrough ledger #11). `level` above is the SETTLEMENT's tier, so
   * before this a town hall that had reached L2 while the settlement stayed L1
   * was invisible to a probe: there was no way to read a building's level at
   * all. District buildings are tagged with the district hex they stand in,
   * because their `gx`/`gy` are local to that district's own grid.
   */
  buildings: DebugBuildingSnapshot[];
}

export interface DebugPointerInfo {
  q?: number;
  r?: number;
  moved?: boolean;
  [key: string]: unknown;
}

export interface GameDebugEvents {
  available(): boolean;
  subscribe(handler: (entry: LogEntry) => void): () => void;
  getEntries(query?: LogQuery): LogEntry[];
  clear(): void;
  stats(): LogStats | null;
  setCapacity(n: number): void;
}

export interface GameDebugConsole {
  readonly isOpen: boolean;
  readonly isPinned: boolean;
  show(): void;
  hide(): void;
  togglePin(): boolean;
  setPinned(value: boolean): void;
}

export interface GameDebugSettings {
  get(): GameSettings;
  update(patch: Partial<GameSettings>): GameSettings;
  reset(): GameSettings;
}

export interface GameDebugApi {
  getState(): GameState;
  getGameState(): GameState;
  getTurnController(): unknown;
  endTurn(): void;
  setSelectedHero(id: HeroId): void;
  requestMove(id: HeroId, q: number, r: number): boolean;
  enterBattle(attackerId: HeroId, defenderId: HeroId): void;
  captureSettlement(heroId: HeroId, settlementId: string): boolean;
  teleportHero(id: HeroId, q: number, r: number): boolean;
  debugInjectCharter(
    heroId: HeroId,
    targetQ: number,
    targetR: number,
    phase: "traveling" | "constructing",
    settlementName: string
  ): boolean;
  getHeroes(): DebugHeroSnapshot[];
  getSettlements(): DebugSettlementSnapshot[];
  /**
   * The open city view's LIVE grid geometry — its layout, its cells in paint
   * order, and the same cell<->screen conversions the view paints and picks
   * with — or null while no city view is open (playthrough ledger #22: the
   * geometry used to have to be re-implemented from `src/core/cityGrid.ts`).
   */
  cityGrid(): CityGridDebug | null;
  readonly hover: () => DebugPointerInfo | null;
  readonly lastClick: () => DebugPointerInfo | null;
  readonly phase: () => GameState["phase"];
  readonly round: () => GameState["round"];
  readonly activeGameId: () => number | null;
  readonly activeGameName: () => string | null;
  readonly screenFor: (q: number, r: number) => { x: number; y: number };
  isPassable(q: number, r: number): boolean;
  getMoveDurationMs(): number;
  readonly eventLog: () => EventLog | null;
  readonly events: GameDebugEvents;
  readonly console: GameDebugConsole;
  readonly settings: GameDebugSettings;
}

/** One building, as much as the debug snapshot needs (structural, so this file stays contract-light). */
interface BuildingLike {
  kind: string;
  level: number;
  construction?: unknown;
}

/**
 * Every building a settlement holds — its own city grid first, then each
 * district's, tagged with the district hex those local `gx`/`gy` belong to.
 * Ledger #11: the settlement's `level` is its TIER, so a probe could not see a
 * town hall that had reached L2 while the settlement stayed L1.
 */
function buildingSnapshots(castle: {
  buildings?: BuildingLike[];
  districts?: Record<string, { q: number; r: number; buildings?: BuildingLike[] }>;
}): DebugBuildingSnapshot[] {
  const out: DebugBuildingSnapshot[] = [];
  for (const b of castle.buildings ?? []) {
    out.push({ kind: b.kind, level: b.level, construction: b.construction === true, district: null });
  }
  for (const d of Object.values(castle.districts ?? {})) {
    for (const b of d.buildings ?? []) {
      out.push({
        kind: b.kind,
        level: b.level,
        construction: b.construction === true,
        district: { q: d.q, r: d.r },
      });
    }
  }
  return out;
}

/**
 * Attaches the __gameDebug API to window.
 * All heavy logic delegates back to the engine via the provided callbacks.
 */
export function attachDebugApi(engine: AttachDebugApiEngine): void {
  const debugApi: GameDebugApi = {
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
        const stepCost = gm.cost(newPath[i].q, newPath[i].r);
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
    // phase (see adventureScene.ts / paint2d's paintCharterOverlay), so this skips the
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
      buildings: buildingSnapshots(c),
    })),

    cityGrid: () => engine.getCityGrid?.() ?? null,

    // Every readout on this surface is a CALL, not a getter (playthrough
    // ledger #20): a driver must not have to know which spelling each member
    // uses, and a call makes it plain that the value is taken when you ask for
    // it. The pointer pair moved first, then the five scalars below.
    hover: () => engine.view.view?.hover ?? null,
    lastClick: () => engine.view.view?.lastClickDebug ?? null,
    phase: () => engine.state.getState().phase,
    round: () => engine.state.getState().round,
    activeGameId: () => engine.session.getActiveGameId(),
    activeGameName: () => engine.session.getActiveGameName(),

    get screenFor() {
      return (q: number, r: number) => {
        const { x: wx, y: wy } = axialToPixel(q, r);
        return { x: wx * engine.view.camera.zoom + engine.view.camera.x, y: wy * engine.view.camera.zoom + engine.view.camera.y };
      };
    },

    isPassable: (q: number, r: number) => engine.state.getGameMap().isPassable(q, r),
    getMoveDurationMs: () => engine.state.getHeroes()[0]?.moveDurationMs ?? 0,

    eventLog: () => engine.eventLog ?? null,

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
  (window as unknown as { __gameDebug: GameDebugApi }).__gameDebug = debugApi;
}
