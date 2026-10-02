// The one place the persistence layer reconciles the engine's 2-decimal
// quantities with the INTEGER columns it writes them into.
//
// WHY THIS EXISTS. Every numeric game quantity the engine models is a
// two-decimal float, deliberately:
//   - packages/engine/src/settlement/producers.ts's producerTurnOutput rounds to
//     100ths (`Math.round(x * 100) / 100`), so a farmField yields e.g. 6.4 food;
//   - packages/engine/src/settlement/produceResources.ts's produceSettlementResources
//     applies the same rule to gold via its own round2;
//   - packages/engine/src/economy/consumption.ts's moraleDecay derives a
//     continuous foodDeficitRatio, so morale lands on values like 90.4.
// But every column these land in is declared INTEGER: games.gold
// (server/schema.sql:8), settlement_snapshots.gold / effective_income
// (migrations/003_resource_tables.sql:20,23), resource_transactions.amount /
// gold_paid (same file, 8-9), heroes.gold + heroes.morale and
// settlements.gold + settlements.morale + settlement_resources.amount
// (migrations/009_granular_entities.sql:20,26,60,69,92).
//
// Writing a float straight through does not truncate -- Postgres rejects the
// WHOLE statement with `invalid input syntax for type integer: "4171.6"`,
// which aborts the command's transaction. That is what made every EndTurn
// return HTTP 500: the legacy games.gold total sums hero and settlement purses,
// and auto-trade pays a fractional food amount out of a settlement's treasury,
// so a single food-producing settlement is enough to make the total fractional.
//
// THE RULE: Math.round, matching the engine's own idiom for gold -- see
// effectiveIncome() (`Math.round((population * goldTax * morale) / 100)`) and
// the Math.round in runAutoTrade-adjacent accounting. Deliberately NOT
// Math.floor/truncation: 0.6 gold is real money produced by a real farm, and
// flooring would silently destroy it on every single persist while still
// keeping the write "successful". Math.round is the only rule that cannot move
// a purse by more than half a coin, and it is the identity on the
// overwhelmingly common integer input -- so the existing round-trip pins
// (test/persistence/gameRepo.test.ts's `assert.equal(row.gold, 42)`) stay exact.
//
// Non-finite input collapses to 0 rather than propagating: NaN/Infinity is
// never a meaningful purse, morale or stockpile, and the same defensive
// convention already runs in consumption.ts's clampWarehouseNonNegative
// (NaN -> 0) and clamp (non-finite -> min).
export function toIntColumn(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value);
}