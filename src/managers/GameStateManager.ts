import type { GameState, HeroId, PlayerId } from "../state/gameState";
import { Hero } from "../entities/hero";
import { Castle } from "../entities/settlement";
import { findPath } from "../map/pathfinding";
import { GameMap } from "../map/gameMap";
import { TurnController, createAiTurnMemory, type AiTurnMemory, type TurnControllerOptions } from "../state/turnController";
import type { TurnControllerHooks } from "../state/turnController";
import type { Axial } from "../core/hex";
import { bus } from "../core/eventBus";

export interface PathPreviewLock {
  heroId: HeroId;
  waypoint: Axial;
  reachableIdx: number;
}

export class GameStateManager {
  private gameState!: GameState;
  private turnController!: TurnController;
  private heroes: Record<string, Hero> = {};
  private settlements: Record<string, Castle> = {};
  private gameMap!: GameMap;
  private hooks: TurnControllerHooks | null = null;
  private primaryActorSource: (() => boolean) | null = null;
  // S3 (logistics-interface-fixes plan §5.8): the local viewer's seat, read
  // lazily at construction time -- the active game (and its seat) changes on
  // adopt/load, same lifecycle as primaryActorSource.
  private localSeatSource: (() => PlayerId | null) | null = null;
  private pathPreviewLock: PathPreviewLock | null = null;
  // Owner of the AI-turn state (I1 garrison backoff, B1 recruit guard) that
  // must survive a controller rebuild: every makeTurnController() call hands
  // this one instance to the new controller, so replaceState()'s rebuild --
  // auto-resolve settle, SSE full-refetch resync, save, sync merge -- carries
  // the state across instead of wiping it. resetAiTurnMemory() drops it only
  // when a different game session is loaded.
  private aiMemory: AiTurnMemory = createAiTurnMemory();

  setHooks(hooks: TurnControllerHooks): void {
    this.hooks = hooks;
  }

  // plan/2026-09-29-ai-enemies.md D3: only the primary client drives the AI
  // tick. The source is read lazily at tick time because the active game
  // name changes over the session (adopt/load).
  setPrimaryActorSource(source: (() => boolean) | null): void {
    this.primaryActorSource = source;
  }

  setLocalSeatSource(source: (() => PlayerId | null) | null): void {
    this.localSeatSource = source;
  }

  private makeTurnController(state: GameState): TurnController {
    const opts: TurnControllerOptions = { aiMemory: this.aiMemory };
    if (this.primaryActorSource) opts.isPrimaryActor = this.primaryActorSource;
    if (this.localSeatSource) opts.localSeat = this.localSeatSource();
    return new TurnController(state, this.hooks ?? ({} as TurnControllerHooks), opts);
  }

  // Fresh AI-turn memory for a newly loaded game session: backoff and
  // recruit-guard entries are round/hero/settlement-id-keyed for the game
  // that produced them and must not leak into the next game's ids.
  resetAiTurnMemory(): void {
    this.aiMemory = createAiTurnMemory();
  }

  setGameMap(map: GameMap): void {
    this.gameMap = map;
  }

  getGameMap(): GameMap {
    return this.gameMap;
  }

  setPathPreviewLock(lock: PathPreviewLock | null): void {
    this.pathPreviewLock = lock;
  }

  getPathPreviewLock(): PathPreviewLock | null {
    if (!this.pathPreviewLock) return null;
    const hero = this.heroes[this.pathPreviewLock.heroId];
    if (
      this.gameState?.selectedHeroId !== this.pathPreviewLock.heroId ||
      !hero ||
      !hero.moving
    ) {
      this.pathPreviewLock = null;
      return null;
    }
    return this.pathPreviewLock;
  }

  getPathReachableIdx(): number | null {
    return this.getPathPreviewLock()?.reachableIdx ?? null;
  }

  getPathOrigin(): Axial | null {
    return this.getPathPreviewLock()?.waypoint ?? null;
  }

  setState(state: GameState): void {
    this.gameState = state;
    this.turnController = this.makeTurnController(state);
  }

  replaceState(state: GameState): void {
    this.gameState = state;
    this.turnController = this.makeTurnController(state);
    bus.emit({ type: "state:committed" });
  }

  rebuildHeroesFromState(): void {
    const next: Record<string, Hero> = {};
    for (const [id, h] of Object.entries(this.gameState.heroes)) {
      const existing = this.heroes[id];
      if (existing) {
        existing.syncFromState(h);
        // A hero mid-tween keeps its tween; syncFromState's own moving guard
        // skips the position, so the four snap lines below must be skipped too.
        if (!existing.moving) {
          existing.tile = { q: h.q, r: h.r };
        existing.fromTile = { q: h.q, r: h.r };
          existing.toTile = { q: h.q, r: h.r };
          existing.moving = false;
          existing.pixelOffset = { x: 0, y: 0 };
        }
        next[id] = existing;
      } else {
        next[id] = Hero.fromGameState(h);
      }
    }
    this.heroes = next;
  }

  rebuildSettlementsFromState(): void {
    const next: Record<string, Castle> = {};
    for (const [id, s] of Object.entries(this.gameState.settlements)) {
      next[id] = Castle.fromGameState(s);
    }
    this.settlements = next;
  }

  syncHeroVisualsToState(): void {
    for (const [id, h] of Object.entries(this.gameState.heroes)) {
      const v = this.heroes[id];
      if (!v) continue;
      v.movementRemaining = h.movementRemaining;
      v.trail = (h.trail ?? []).map((p) => ({ q: p.q, r: p.r }));
      v.gold = h.gold ?? 0;
      v.isChartering = h.isChartering ?? false;
      v.charterId = h.charterId ?? null;
      if (v.moving) continue;
      if (v.tile.q === h.q && v.tile.r === h.r) continue;
      const start = { ...v.tile };
      const end = { q: h.q, r: h.r };
      const partialPath = findPath(this.gameMap, start, end);
      if (partialPath.length > 0) {
        v.startMoveToPath([start, ...partialPath]);
      } else {
        v.tile = end;
        v.fromTile = end;
        v.toTile = end;
      }
    }
  }

  update(dtMs: number): boolean {
    let changed = false;
    let heroFinishedMove = false;
    for (const hero of Object.values(this.heroes)) {
      const wasMoving = hero.moving;
      hero.update(dtMs);
      if (wasMoving && !hero.moving) heroFinishedMove = true;
    }
    if (this.turnController) {
      this.turnController.tick(dtMs);
      const nextState = this.turnController.getState();
      if (nextState !== this.gameState || heroFinishedMove) {
        this.gameState = nextState;
        this.syncHeroVisualsToState();
        changed = true;
      }
    }
    return changed;
  }

  getState(): GameState { return this.gameState; }
  getTurnController(): TurnController { return this.turnController; }
  getHeroes(): Hero[] { return Object.values(this.heroes); }
  getSettlements(): Castle[] { return Object.values(this.settlements); }
  getHero(id: string): Hero | undefined { return this.heroes[id]; }
  getSettlement(id: string): Castle | undefined { return this.settlements[id]; }
  getHeroesMap(): Record<string, Hero> { return this.heroes; }
  getSettlementsMap(): Record<string, Castle> { return this.settlements; }
}
