import { bus } from "./eventBus";

export function registerBuildingModifiers(): void {
  bus.on("calc:controlRange", (ev) => {
    ev.range = ev.level;
    // Future: check settlement buildings and add deltas
    // e.g., if (settlementHasBuilding(ev.settlementId, "tower")) ev.range += 3;
  });

  bus.on("calc:visionRange", (ev) => {
    ev.range = ev.level;
    // Future: adjust based on buildings
  });

  bus.on("calc:heroSpeed", (ev) => {
    ev.speed = ev.baseSpeed;
    // Future: adjust based on nearby settlement buildings
  });
}
