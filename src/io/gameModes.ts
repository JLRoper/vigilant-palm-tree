import { DEFAULT_GAME_MODE, resolveGameMode, type GameMode } from "@heroes/contracts";

// Per-game mode registry (SETTLERS-PLAN.md §4 W4): answers which mode the
// ACTIVE game was created with, the src/io/unchartedGames.ts pattern.
//
// Why a registry and not just `state.gameMode`: the mode rides the lobby jsonb
// (`games.lobby.gameMode`) and reaches the client's GameState through
// hydrateClientGame, which is enough for the engine rules the reducers run --
// but a client-side gate that must answer BEFORE (or without) walking the
// game state (the toolbar's founding button, the map gesture's entry point)
// reads it here. Entries are fed from every game-bearing response path and
// default to the classic mode, so an unknown game is a classic game until its
// first full game response lands -- never an error on the load path.
//
// The mode is immutable for a game's lifetime (it is a creation-time field),
// so the feeds below are the load and resync paths only: unlike
// `uncharted`, a mode cannot be rolled back server-side behind the client's
// back, so there is nothing for a later poll to discover.

const gameModes = new Map<string, GameMode>();

/** The mode of `gameName`, or the classic default for an unknown game. */
export function gameModeFor(gameName: string | null | undefined): GameMode {
  if (gameName == null) return DEFAULT_GAME_MODE;
  return gameModes.get(gameName) ?? DEFAULT_GAME_MODE;
}

/** True when the ACTIVE game was created in settlers mode. */
export function isSettlersGame(gameName: string | null | undefined): boolean {
  return gameModeFor(gameName) === "settlers";
}

/**
 * Registers the mode a game-bearing response carried. Junk (an absent flag on
 * a pre-mode row, a hand-edited lobby bag) normalizes to the default mode
 * through the contracts vocabulary -- the store, the wire and the engine
 * share ONE list of modes, so a typo cannot register a mode the server would
 * reject.
 */
export function setGameMode(gameName: string, mode: unknown): void {
  gameModes.set(gameName, resolveGameMode(typeof mode === "string" ? mode : null));
}

export function clearGameMode(gameName: string): void {
  gameModes.delete(gameName);
}

/** Test seam: the registry is module state, so a test resets it between cases. */
export function resetGameModes(): void {
  gameModes.clear();
}
