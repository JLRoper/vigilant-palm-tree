// mulberry32 now lives in @heroes/engine (deterministic, seeded — safe for
// the engine's purity contract); re-exported here so existing consumers of
// core/rng don't need to change their import path.
export { mulberry32 } from "@heroes/engine";

// rng() is a global, mutable, unseeded LCG used for non-deterministic
// client-only randomness (AI wandering, decorative city-grid placement) —
// deliberately NOT in @heroes/engine, whose whole point is excluding exactly
// this kind of ambient non-determinism.
let rngState = 0x12345678;

export function rng(): number {
  rngState = (rngState * 1664525 + 1013904223) >>> 0;
  return rngState / 4294967296;
}
