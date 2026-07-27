import { bus } from "./eventBus";

export function registerAllListeners(): void {
  // state:committed, turn, movement, and economy listeners are registered
  // by their respective managers (GameEngine, TurnController, etc.)
}

export { bus };
