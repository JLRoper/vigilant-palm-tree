import { api, type Game, type TileRow } from "../io/api";
import { rememberGame, listUserGames } from "../io/userGames";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export class SessionManager {
  private activeGameId: number | null = null;
  private activeGameName: string | null = null;
  private lastSavedAt: string | null = null;
  private backendOk = false;
  private saveStatus: SaveStatus = "idle";

  async init(): Promise<boolean> {
    try {
      await api.health();
      this.backendOk = true;
      return true;
    } catch (e) {
      this.backendOk = false;
      console.warn("backend offline:", e);
      return false;
    }
  }

  getActiveGameName(): string | null {
    return this.activeGameName;
  }

  getActiveGameId(): number | null {
    return this.activeGameId;
  }

  isBackendOk(): boolean {
    return this.backendOk;
  }

  getSaveStatus(): SaveStatus {
    return this.saveStatus;
  }

  getLastSavedAt(): string | null {
    return this.lastSavedAt;
  }

  setSaveStatus(s: SaveStatus): void {
    this.saveStatus = s;
  }

  resetToIdle(): void {
    if (this.saveStatus === "saved" || this.saveStatus === "error") {
      this.saveStatus = "idle";
    }
  }

  forget(id: number): void {
    if (this.activeGameId === id) {
      this.activeGameId = null;
      this.activeGameName = null;
    }
  }

  /**
   * Sets the active game id/name from a loaded or created game.
   */
  adopt(loaded: Game): void {
    this.activeGameId = loaded.id;
    this.activeGameName = loaded.name;
    rememberGame(loaded.id, loaded.name);
  }

  async manualSave(args: {
    playerHeroTile: { q: number; r: number };
    round: number;
    wealth: number;
    enemyPositions: { q: number; r: number }[];
  }): Promise<{ updated_at: string } | null> {
    if (!this.backendOk || !this.activeGameName) return null;
    this.saveStatus = "saving";
    try {
      const updated = await api.patchGame(this.activeGameName, {
        hero_q: args.playerHeroTile.q,
        hero_r: args.playerHeroTile.r,
        turn: args.round,
        gold: args.wealth,
        enemy_positions: args.enemyPositions,
      });
      this.lastSavedAt = updated.updated_at;
      this.saveStatus = "saved";
      return updated;
    } catch (e) {
      console.warn("manual save failed:", e);
      this.saveStatus = "error";
      return null;
    }
  }

  async createGame(name: string, seed: number, heroQ: number, heroR: number, enemyPositions: { q: number; r: number }[]): Promise<Game> {
    return await api.createGame(name, seed, heroQ, heroR, enemyPositions);
  }

  async getTiles(name: string): Promise<TileRow[]> {
    return await api.getTiles(name);
  }

  async logEvent(name: string, kind: string, payload: Record<string, unknown>): Promise<void> {
    try {
      await api.logEvent(name, kind, payload);
    } catch (e) {
      console.warn(`logEvent(${kind}) failed:`, e);
    }
  }

  getLatestGames() {
    return listUserGames();
  }
}
