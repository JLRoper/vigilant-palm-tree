import { GameStateManager } from "./GameStateManager";
import { SessionManager } from "./SessionManager";
import { ViewManager } from "./ViewManager";
import { UIManager } from "./UIManager";
import { GameMap, type MapSize, MAP_SIZES } from "../map/gameMap";
import { playerWealth, hydrateGameState } from "@heroes/engine";
import { markSaved } from "../state/gameState";
import { playerHeroId } from "../game/initState";
import { CASTLE_COUNT_DEFAULT, defaultCastleSeedFromMapSeed, generateCastles } from "../map/castlePlacement";
import { loadUnitCatalog } from "../data/unitCatalog";
import { MAP_SEED } from "@screens/adventure/adventureView";
import type { Game, TileRow } from "../io/api";
import {
  getInMemoryLocalPlayerId,
  setInMemoryLocalPlayerId,
} from "../players/localPlayer";
import { getMultiplayerSync } from "../io/multiplayerSync";

/**
 * Handles game session lifecycle: loading, creating, and saving games.
 * Bridges SessionManager (API), GameStateManager (state), and ViewManager (display).
 */
export class GameSessionManager {
  constructor(
    private session: SessionManager,
    private state: GameStateManager,
    private view: ViewManager,
    private ui: UIManager,
    private getGameMap: () => GameMap,
    private setGameMap: (m: GameMap) => void,
  ) {}

  private currentGameName: string | null = null;
  private currentGameSeed: number = MAP_SEED;
  private currentMapSize: MapSize = "small";

  getGameName(): string | null { return this.currentGameName; }
  getGameSeed(): number { return this.currentGameSeed; }
  getMapSize(): MapSize { return this.currentMapSize; }

  async getTilesForGame(loaded: Game): Promise<TileRow[]> {
    return await this.session.getTiles(loaded.name);
  }

  private syncMetadata(name: string, seed: number, mapSize: MapSize): void {
    this.currentGameName = name;
    this.currentGameSeed = seed;
    this.currentMapSize = mapSize;
  }

  private inferMapSize(map?: GameMap): MapSize {
    const width = map?.width ?? this.getGameMap().width;
    const height = map?.height ?? this.getGameMap().height;
    if (width === MAP_SIZES.large.width && height === MAP_SIZES.large.height) return "large";
    if (width === MAP_SIZES.medium.width && height === MAP_SIZES.medium.height) return "medium";
    return "small";
  }

  async loadGame(loaded: Game, tiles: TileRow[]): Promise<void> {
    this.session.adopt(loaded);
    const map = GameMap.fromTiles(tiles);
    const inferredSize = this.inferMapSize(map);
    this.syncMetadata(loaded.name, loaded.seed, inferredSize);
    this.setGameMap(map);
    this.state.setGameMap(map);
    const hydrated = hydrateGameState(loaded);
    this.state.replaceState(hydrated);
    this.view.updateMap(map);
    const center = this.state.getHero(playerHeroId())?.tile ?? { q: 6, r: 5 };
    this.view.centerOn(center.q, center.r);
    this.ui.getToolbar()?.refresh();
    void this.session.logEvent(loaded.name, "load_game", {});

    const claimed = (loaded as unknown as { lobby?: { claimed?: Record<string, { handle: string }> } }).lobby?.claimed ?? {};
    const claimedSeat = Number(Object.keys(claimed).find((k) => claimed[k]) ?? "");
    if (Number.isInteger(claimedSeat) && claimedSeat >= 0) {
      setInMemoryLocalPlayerId(loaded.name, claimedSeat);
    }
    // Seed the event-cursor poller from the same response the full hydrate
    // above came from (#146), so its first poll asks for events *after* this
    // snapshot instead of replaying the whole log. A row without
    // last_event_id (POST /games' create response doesn't carry one) starts
    // unseeded, which makes the poller's first tick do its own full hydrate
    // and seed from that.
    const seededCursor = loaded.last_event_id === undefined ? undefined : Number(loaded.last_event_id);
    getMultiplayerSync().start(loaded.name, { cursor: seededCursor, state: hydrated });
  }

  async handleManualSave(): Promise<void> {
    const gs = this.state.getState();
    const gameName = this.getGameName() ?? "";
    const ownerId = getInMemoryLocalPlayerId(gameName) ?? 0;
    const playerId = playerHeroId();
    const playerHero = this.state.getHero(playerId);
    const wealth = playerWealth(gs, ownerId);
    const enemies = this.state.getHeroes()
      .filter((h) => h.ownerId !== ownerId)
      .map((h) => ({ q: h.tile.q, r: h.tile.r }));
    const updated = await this.session.manualSave({
      playerHeroTile: playerHero?.tile ?? { q: 0, r: 0 },
      round: gs.round,
      wealth,
      enemyPositions: enemies,
    });
    if (updated) {
      this.state.replaceState(markSaved(this.state.getState()));
      setTimeout(() => {
        this.session.resetToIdle();
      }, 1500);
    }
  }

  async handleNewGame(opts: { name: string; seed: number; castleSeed?: number; castleCount?: number; mapSize?: "small" | "medium" | "large"; playerCount?: 1 | 2 | 3 | 4; humanSeatCount?: number }): Promise<void> {
    const effectiveCastleSeed =
      typeof opts.castleSeed === "number" && Number.isFinite(opts.castleSeed)
        ? opts.castleSeed
        : defaultCastleSeedFromMapSeed(opts.seed);
    const playerCount = opts.playerCount ?? 3;
    const humanSeatCount = Math.max(1, Math.min(playerCount, opts.humanSeatCount ?? 1));
    const effectiveCastleCount = opts.castleCount ?? (2 * playerCount);
    const castles = generateCastles(this.getGameMap(), {
      castleSeed: effectiveCastleSeed,
      playerCount,
      castleCount: Math.max(effectiveCastleCount, playerCount),
    });
    const localCastle = castles.find((c) => c.ownerId === 0);
    const aiCastles = castles.filter((c) => c.ownerId !== null && c.ownerId !== 0);
    const heroQ = localCastle?.tile.q ?? 6;
    const heroR = localCastle?.tile.r ?? 5;
    const enemyPositions = aiCastles.length
      ? aiCastles.map((c) => ({ q: c.tile.q, r: c.tile.r }))
      : [{ q: 14, r: 8 }, { q: 17, r: 9 }];
    const created = await this.session.createGame(opts.name, opts.seed, heroQ, heroR, enemyPositions, opts.mapSize, humanSeatCount);
    const gameTiles = await this.session.getTiles(created.name);
    await this.loadGame(created, gameTiles);
    void this.session.logEvent(created.name, "new_game", {
      seed: opts.seed,
      castleSeed: effectiveCastleSeed,
      castleCount: effectiveCastleCount,
      humanSeatCount,
    });
  }

  async createFreshStarter(): Promise<void> {
    try {
      this.syncMetadata("starter", MAP_SEED, "small");
      const castleSeed = defaultCastleSeedFromMapSeed(MAP_SEED);
      const castles = generateCastles(this.getGameMap(), {
        castleSeed,
        playerCount: 3,
        castleCount: CASTLE_COUNT_DEFAULT,
      });
      const playerCastle = castles.find((c) => c.ownerId === 0);
      const aiCastle = castles.find((c) => c.ownerId === 1);
      const heroQ = playerCastle?.tile.q ?? 6;
      const heroR = playerCastle?.tile.r ?? 5;
      const enemyPositions = aiCastle
        ? [
            { q: aiCastle.tile.q, r: aiCastle.tile.r },
            { q: aiCastle.tile.q + 3, r: aiCastle.tile.r + 1 },
          ]
        : [{ q: 14, r: 8 }, { q: 17, r: 9 }];
      const name = `starter-${Date.now().toString(36)}`;
      const created = await this.session.createGame(name, MAP_SEED, heroQ, heroR, enemyPositions, "small");
      const tiles = await this.session.getTiles(created.name);
      await this.loadGame(created, tiles);
      void this.session.logEvent(created.name, "session_start", {
        seed: MAP_SEED,
        castleSeed,
        castleCount: CASTLE_COUNT_DEFAULT,
        round: 1,
      });
    } catch (e) {
      console.warn("failed to start starter game:", e);
      this.session.setSaveStatus("error");
    }
  }

  async initBackend(): Promise<boolean> {
    const ok = await this.session.init();
    if (ok) {
      void loadUnitCatalog().catch((e) => console.warn("unit catalog load failed:", e));
      const cached = this.session.getLatestGames();
      if (cached.length === 0) {
        await this.createFreshStarter();
      }
    }
    return ok;
  }
}
