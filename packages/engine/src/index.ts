// @heroes/engine — deterministic game rules. Depends on @heroes/contracts
// only: no DOM, no Canvas, no Date.now, no Math.random, no fetch. All
// non-determinism is injected via EngineCtx = { rng, catalog }.
export * from "./combat";
export * from "./combatConfig";
export * from "./horseVariants";
export * from "./map/gameMap";
export * from "./map/terrain";
export * from "./map/resourceTiles";
export * from "./rng";
export * from "./styleResolver";
export * from "./units";
export * from "./validation/gameIntegrity";
