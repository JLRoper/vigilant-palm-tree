// Uncharted fog mode (plan/tasks/uncharted-fog-mode §3): a per-game registry
// answering whether the ACTIVE game was created with lobby.uncharted === true.
// Mirrors serverDrivenGames.ts: entries are fed from every game-bearing
// response path (creation + load via GameSessionManager.loadGame, and
// multiplayerSync.resync()) and default FALSE, so an unknown game renders the
// legacy always-fog map until its first full game response lands.
//
// The renderer's uncharted darkness is gated purely on this registry
// (GameEngine.draw reads it into RenderOptions), while the per-player reveal
// rides players[].revealedTiles through normal state hydration.

const unchartedGames = new Set<string>();

export function isUnchartedGame(gameName: string | null | undefined): boolean {
  return gameName != null && unchartedGames.has(gameName);
}

// value === true registers the game; anything else (false, absent flag on a
// legacy row) clears it, so a later refetch of a previously-flagged game
// whose flag was rolled back propagates without a browser restart.
export function setUncharted(gameName: string, value: boolean): void {
  if (value) {
    unchartedGames.add(gameName);
  } else {
    unchartedGames.delete(gameName);
  }
}

export function clearUncharted(gameName: string): void {
  unchartedGames.delete(gameName);
}