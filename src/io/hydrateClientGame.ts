import { hydrateGameState, readPendingBattle } from "@heroes/engine";
import type { GameState } from "@heroes/contracts";
import type { Game } from "./api";

// The raw API game nests the pending-battle marker under `lobby` (the
// games.lobby jsonb bag), while hydrateGameState reads a TOP-LEVEL
// `pendingBattle` field. server/persistence/hydrate.ts applies the same
// mapping before its hydrateGameState call; both client call sites
// (GameSessionManager.loadGame and multiplayerSync.resync) go through here
// so the mapping cannot drift. Without it, a reload/resync during an
// offered battle hydrates a faction-derived phase and the defender's
// battle modal never re-fires.
export function hydrateClientGame(game: Game): GameState {
  return hydrateGameState({ ...game, pendingBattle: readPendingBattle(game.lobby) });
}
