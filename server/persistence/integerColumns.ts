// The full-precision guard every numeric game write passes through.
//
// HISTORY. Every numeric game quantity the engine models is a two-decimal
// float, deliberately:
//   - packages/engine/src/settlement/producers.ts's producerTurnOutput rounds to
//     100ths (`Math.round(x * 100) / 100`), so a farmField yields e.g. 6.4 food;
//   - packages/engine/src/settlement/produceResources.ts's produceSettlementResources
//     applies the same rule to gold via its own round2;
//   - packages/engine/src/economy/consumption.ts's moraleDecay derives a
//     continuous foodDeficitRatio, so morale lands on values like 90.4.
// Every column these land in (games.gold; settlements/hero gold + morale;
// settlement_resources.amount; the #89 snapshot/transaction tables) was
// declared INTEGER, and an unrounded float write aborted the whole statement
// ("invalid input syntax for type integer: \"4171.6\"") — one food-producing
// settlement made every EndTurn return HTTP 500. The 2026-10-01 interim fix
// rounded at this boundary (Math.round at all 8 write sites), which unblocked
// EndTurn but left the granular tables a permanently-rounded shadow of the
// full-precision games.heroes/games.settlements JSONB — and hydrateFromRepos
// PREFERS the granular tables, so every granular-read game shed up to half a
// coin per quantity per command.
//
// Migration 027_numeric_columns.sql widened all of those columns to NUMERIC
// (with the OID-1700 node-postgres parser in pgTypes.ts reading them back as
// numbers), so the shadow is gone: writes pass through at FULL PRECISION and
// 6.4 persisted comes back 6.4. This module survives only as the write-boundary
// guard — Postgres would reject NaN/Infinity just as loudly as it rejected the
// old floats, so non-finite input collapses to 0 rather than propagating, the
// same defensive convention consumption.ts's clampWarehouseNonNegative
// (NaN -> 0) and clamp (non-finite -> min) already run. No rounding: the
// engine's quantities are 2-dp by construction, and identity is what keeps the
// granular mirrors byte-identical to their JSONB sources (hydrate.test.ts's
// read-path parity pins that).
export function toNumericColumn(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value;
}
