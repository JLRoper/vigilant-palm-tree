import { GameEngine } from "./managers/GameEngine";

const engine = new GameEngine();

async function start(): Promise<void> {
  await engine.init();
  await engine.initBackend();
  requestAnimationFrame((now) => engine.loop(now));
}

start();

export {};
