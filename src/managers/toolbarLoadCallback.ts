import type { Game } from "../io/api";

// The toolbar's Load callback, as the engine wires it (GameEngine.initUI).
//
// The Load modal awaits the value this returns -- `await opts.onLoad(game)`,
// src/screens/shared/loadGameModal.ts -- so that a load that fails leaves the
// dialog up with its row back on a retryable "Open". The wiring that landed in
// PR #289 returned `void` (`(loaded) => void this.sessions.loadGame(loaded)`),
// so that await settled immediately: a rejected load closed the dialog anyway
// and the retryable state was unreachable in production, no matter what the
// modal's own failure branch did.
//
// So the returned value IS the contract. `afterLoad` (the engine's post-load
// frame work) runs only once the load has resolved; the rejection passes
// through to the caller that awaits it.

export interface ToolbarLoadDeps {
  loadGame: (game: Game) => Promise<void>;
  /** Runs after a successful load only. */
  afterLoad: () => void;
}

export function createToolbarLoadCallback(deps: ToolbarLoadDeps): (game: Game) => Promise<void> {
  return (game) =>
    deps.loadGame(game).then(() => {
      deps.afterLoad();
    });
}
