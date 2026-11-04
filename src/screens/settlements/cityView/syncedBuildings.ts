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
//   - workers / draft: server-owned staffing state (AssignWorkers / Recruit).
//     The cart is a placement-time snapshot; without this merge, closing the
//     city view -- or any placement/destroy commit -- wrote the open-time
//     counts back into client state, so freshly assigned workers vanished as
//     soon as the player left the city (server kept them; the views diverged).
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
  if (liveB.workers !== undefined) merged.workers = liveB.workers;
  else delete (merged as { workers?: unknown }).workers;
  if (liveB.draft) merged.draft = { ...liveB.draft };
  else delete (merged as { draft?: unknown }).draft;
  return merged;
}

/**
 * The staffing a cart entry that has NO live twin -- a fresh placement -- must
 * carry into the client's own commit, as the ENGINE will store it
 * (`freshPlacementWorkers`: `undefined` for the free auto crew of a bootstrap
 * town, an explicit `0` once the settlement is being grown).
 *
 * `syncCartBuilding` cannot do this: it only ever copies an EXISTING building's
 * staffing, so a fresh placement left the cart with no `workers` at all. That is
 * not cosmetic. The city view's commit hands the cart to TWO writers -- UIManager
 * .onClose writes it into the client's state first (the optimistic resource
 * settle), and only then does UIManager.onPlaceBuildings run the engine's own
 * `applyPlaceBuildings` over that already-written state -- and the resolver
 * treats any entry it finds in the settlement as an EXISTING building whose
 * staffing must be preserved. So the fresh placement reached the reducer looking
 * pre-existing, its new-placement branch never ran on the CLIENT, and the row
 * kept no count at all: `buildersOnSite` read that as the auto crew (the
 * construction ceiling, 4), and the menu printed `2.00x (4 of 4 builders)` for a
 * site the server holds at `workers: 0` -- a site that makes no progress. Only
 * the next EndTurn's wholesale state replace reconciled it (measured in a real
 * game, 2026-11-03).
 *
 * `freshWorkers` is the verdict read off the LIVE settlement before the commit,
 * so a bootstrap town's placement stays legacy (`undefined`) on both sides.
 */
export function withFreshPlacementStaffing(
  cart: BuildingDef[],
  live: BuildingDef[],
  freshWorkers: number | undefined,
): BuildingDef[] {
  return cart.map((b) => {
    if (live.some((m) => m.gx === b.gx && m.gy === b.gy && m.kind === b.kind)) return b;
    const merged: BuildingDef = { ...b };
    if (freshWorkers === undefined) delete (merged as { workers?: unknown }).workers;
    else merged.workers = freshWorkers;
    return merged;
  });
}

/** Every cart building matched to its live twin by (gx, gy, kind); unmatched cart entries pass through untouched. */
export function syncCartBuildings(cart: BuildingDef[], live: BuildingDef[]): BuildingDef[] {
  return cart.map((b) => {
    const liveB = live.find((m) => m.gx === b.gx && m.gy === b.gy && m.kind === b.kind);
    return liveB ? syncCartBuilding(b, liveB) : b;
  });
}