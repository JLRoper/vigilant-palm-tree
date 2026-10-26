import { hydrateGameState, readGameMode, readPendingBattle } from "@heroes/engine";
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
//
// `gameMode` gets the same treatment for the same reason (SETTLERS-PLAN.md
// §4 W4): it is stored as `games.lobby.gameMode` and read by the engine's
// rules off the TOP-LEVEL `gameMode` field, so without this mapping a
// client-side settlers game would hydrate as classic and its own local
// founding reducer would refuse with `not_settlers_mode` while the server
// accepted the command. Read through the engine's own `readGameMode` (the
// `readPendingBattle` shape) so absent/junk stays absent rather than
// fabricating a mode.
//
// `charters` gets the same treatment (C-BLOCKER-1): the API returns the game's
// in-flight charters as `game.charters` (games' own `charters` table, joined in
// server/routes.ts's GET /games/:name), while the engine's rules and the
// client's travel loop both read `state.activeCharters`. Without this mapping
// every load hydrated `activeCharters: []` -- advanceAutoTravel() had nothing to
// walk, no settlement was ever founded, and the chartering hero stayed locked
// (and unpaid) for good, even though `heroes.<id>.isChartering` had persisted.
// Absent (a create response, the list route) stays `[]` via hydrateGameState's
// own default, which also unlocks a hero left flagged with no charter behind it.
export function hydrateClientGame(game: Game): GameState {
  return hydrateGameState({
    ...game,
    pendingBattle: readPendingBattle(game.lobby),
    gameMode: readGameMode(game.lobby),
    activeCharters: game.charters,
  });
}
