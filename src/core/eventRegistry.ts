import { bus } from "./eventBus";
import { registerBuildingModifiers } from "./buildingModifiers";

export function registerAllListeners(): void {
  registerBuildingModifiers();
  // state:committed, turn, movement, and economy listeners are registered
  // by their respective managers (GameEngine, TurnController, etc.)
}

export { bus };
