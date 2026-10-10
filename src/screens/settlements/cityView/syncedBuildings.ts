import type { BuildingDef } from "@heroes/contracts";

// Re-syncing the city view's building cart against live state, extracted from
// CityView.syncedBuildings() so it is unit-testable: cityView.ts's own import
// chain reaches Vite `?url` PNG imports and cannot be loaded under bare
// node:test (the render module's documented pitfall).
//
// Every field the cart must never resurrect stale is copied here:
//   - level (and style, when the live building carries one): EndTurn's round
//     wrap replaces state objects
//   - construction: writing the placement-time copy re-arms finished timers
//   - bank: a pot that changed while the city view was open (multiplayer, or a
//     weekly-interest / 7-day-maturity boundary) would otherwise be written back
//     stale and the change lost on the next commit.
//
// The `else delete` is load-bearing, not defensive tidiness: settlementRepo's
// conditional spread (server/persistence/repositories/settlementRepo.ts) treats
// an absent key and an explicit-undefined key differently, and the repo's
// deepStrictEqual fixtures depend on the absent-key shape.

export function syncCartBuilding(cartB: BuildingDef, liveB: BuildingDef): BuildingDef {
  const merged: BuildingDef = { ...cartB, level: liveB.level, ...(liveB.style !== undefined ? { style: liveB.style } : {}) };
  if (liveB.construction) merged.construction = { ...liveB.construction };
  else delete (merged as { construction?: unknown }).construction;
  if (liveB.bank) merged.bank = { ...liveB.bank, pendingOut: liveB.bank.pendingOut.map((e) => ({ ...e })) };
  else delete (merged as { bank?: unknown }).bank;
  return merged;
}

/** Every cart building matched to its live twin by (gx, gy, kind); unmatched cart entries pass through untouched. */
export function syncCartBuildings(cart: BuildingDef[], live: BuildingDef[]): BuildingDef[] {
  return cart.map((b) => {
    const liveB = live.find((m) => m.gx === b.gx && m.gy === b.gy && m.kind === b.kind);
    return liveB ? syncCartBuilding(b, liveB) : b;
  });
}