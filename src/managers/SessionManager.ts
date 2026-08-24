import { api, type Game, type TileRow } from "../io/api";
import { rememberGame, listUserGames } from "../io/userGames";
import { getLastPersistedAt } from "../io/commands";
import type { TurnController } from "../state/turnController";

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

  async manualSave(turnController: TurnController): Promise<{ savedAt: string } | null> {
    if (!this.backendOk || !this.activeGameName) return null;
    this.saveStatus = "saving";
    await turnController.flushPendingCommands();
    const savedAt = getLastPersistedAt() ?? new Date().toISOString();
    this.lastSavedAt = savedAt;
    this.saveStatus = "saved";
    return { savedAt };
  }

  async createGame(name: string, seed: number, heroQ: number, heroR: number, enemyPositions: { q: number; r: number }[], mapSize?: "small" | "medium" | "large", humanSeatCount?: number): Promise<Game> {
    return await api.createGame(name, seed, heroQ, heroR, enemyPositions, mapSize, humanSeatCount);
  }

  async claimLobbySeat(name: string, seat: number, handle: string): Promise<Game> {
    return await api.claimLobbySeat(name, seat, handle);
  }

  async getTiles(name: string): Promise<TileRow[]> {
    return await api.getTiles(name);
  }

  async getTilesForGame(loaded: Game): Promise<TileRow[]> {
    return await api.getTiles(loaded.name);
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
