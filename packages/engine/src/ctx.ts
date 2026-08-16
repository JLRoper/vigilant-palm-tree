import type { UnitType } from "./units";

// The injected, non-deterministic-but-controlled context every engine
// command runs against. Deliberately minimal -- see
// plan/2026-08-16-phase-3-parallel-dev-plan.md's "Doc contradictions to
// resolve before Track 3.A writes EngineCtx" section:
//   - No actor identity here. Combat/charter events need to know who
//     caused them, but the engine reads that from the command
//     (`cmd.actor`), not from ctx. Keeps commands self-describing and
//     replay-safe.
//   - No clock/tick here. All time effects are turn- or day-counted
//     already (state.round / state.day). If a real need for elapsed-time
//     shows up, it is added explicitly then, not speculatively now.
export type Rng = () => number;

export interface Catalog {
  unitTypes: UnitType[];
}

export interface EngineCtx {
  rng: Rng;
  catalog: Catalog;
}
