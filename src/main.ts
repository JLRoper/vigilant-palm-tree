import { GameEngine } from "./managers/GameEngine";
import { createHomeView } from "./views/homeView";
import type { Game } from "./io/api";

const engine = new GameEngine();

async function start(): Promise<void> {
  await engine.init();
  await engine.initBackend();

  const home = createHomeView({
    isBackendOk: () => engine.session.isBackendOk(),
    onNewGame: async (opts) => {
      await engine.sessions.handleNewGame(opts);
      void engine.fullFrame();
    },
    onLoadGame: async (loaded: Game) => {
      const tiles = await engine.sessions.getTilesForGame(loaded);
      await engine.sessions.loadGame(loaded, tiles);
      engine.refreshToolbarAndFrame();
    },
    onEnterGame: () => {
      // The rAF loop is already running; the home overlay simply hides.
    },
  });
  home.show();

  requestAnimationFrame((now) => engine.loop(now));
}

start();

export {};
