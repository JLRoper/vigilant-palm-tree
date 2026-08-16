// EngineCtx -- the non-determinism the engine takes as input instead of
// reaching for Date.now()/Math.random() itself. No actor, no clock: a
// command's actor lives on the command (PlayerSeat), not here, so commands
// stay self-describing and replay-safe. Add a clock only against a concrete
// need, not speculatively.

// Matches mulberry32's closure return type (./rng.ts) exactly.
export type Rng = () => number;

// Static game-content data (unit stats, building costs, etc.) injected so
// the engine never imports a registry directly. Left opaque for now: no
// command shipped so far reads it. Fill in the real shape when a
// catalog-consuming command (e.g. RecruitHero) is ported.
export type Catalog = Record<string, unknown>;

export interface EngineCtx {
  rng: Rng;
  catalog: Catalog;
}
