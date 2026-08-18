// @heroes/contracts — the wire. Types and vocabulary only: ids, geometry,
// resources, castle/building shapes, settlement/charter state, and the core
// game-state result types. Zero runtime logic beyond trivial pure geometry
// helpers; zero dependencies on @heroes/engine, src/, server/, or shared/.
export * from "./ids";
export * from "./geometry";
export * from "./castle";
export * from "./buildings";
export * from "./resources";
export * from "./units";
export * from "./settlement";
export * from "./gameState";
export * from "./commands";
export * from "./events";
export * from "./telemetry";
