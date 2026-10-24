import type { BuildingDef, BuildingKind, GameState, PlayerSeat, SettlementId, SettlementState } from "@heroes/contracts";
import { districtKey } from "../control";

export interface DemolishBuildingTarget {
  gx: number;
  gy: number;
  kind: BuildingKind;
  district?: { q: number; r: number };
}

export interface DemolishBuildingResult {
  ok: boolean;
  state: GameState;
  reason: string;
}

/**
 * Removes one building (main city or district) from a settlement the actor
 * owns. New command (section 5 of the faction-construction plan), separate
 * from PlaceBuildings' own cart-based removal (which refunds 50% of the
 * placement cost -- see placeBuildings.ts's DESTROY_REFUND_PCT): this one
 * takes a single target building and refunds NOTHING by design (the
 * simplest default; flagged as a tuning knob in the PR description, not a
 * locked decision).
 *
 * No faction gate: you may demolish anything you own, including a foreign-
 * tagged building you captured -- shrinking a foreign faction's tally is
 * exactly how `settlementFactionTally`'s occupation-morale penalty
 * (section 8) is meant to be fought back, alongside building your own.
 *
 * Consumes the same per-turn construction cap PlaceBuildings does
 * (SettlementState.constructionActionUsedThisTurn) -- whichever of the two
 * commands commits first in a turn blocks the other until the next one.
 */
export function applyDemolishBuilding(
  state: GameState,
  settlementId: SettlementId,
  actor: PlayerSeat,
  target: DemolishBuildingTarget,
): DemolishBuildingResult {
  const s = state.settlements[settlementId];
  if (!s) return { ok: false, state, reason: "no_settlement" };
  if (s.ownerId !== actor) return { ok: false, state, reason: "forbidden_not_your_settlement" };
  if (s.constructionActionUsedThisTurn) {
    return { ok: false, state, reason: "construction_action_already_used_this_turn" };
  }

  if (target.district) {
    const key = districtKey(target.district.q, target.district.r);
    const d = s.districts?.[key];
    const index = d?.buildings.findIndex(
      (b) => b.gx === target.gx && b.gy === target.gy && b.kind === target.kind,
    );
    if (!d || index === undefined || index < 0) {
      return { ok: false, state, reason: "no_building" };
    }
    const buildings = d.buildings.filter((_, i) => i !== index);
    const nextDistricts = { ...s.districts };
    if (buildings.length > 0) {
      nextDistricts[key] = { ...d, buildings };
    } else {
      delete nextDistricts[key];
    }
    const updated: SettlementState = {
      ...s,
      districts: nextDistricts,
      constructionActionUsedThisTurn: true,
    };
    return {
      ok: true,
      state: { ...state, settlements: { ...state.settlements, [settlementId]: updated }, dirty: true },
      reason: "",
    };
  }

  if (target.kind === "townHall") {
    // Every settlement is seeded with exactly one townHall and nothing else
    // guarantees a replacement; demolishing it would strand the settlement
    // (no settlement upgrades, no control-range bonus, and -- after
    // section 3 -- the only guaranteed-present recruit-eligible building
    // kind in some designs). Disallowed outright rather than left as a
    // foot-gun; revisit if a rebuild path is ever added.
    return { ok: false, state, reason: "cannot_demolish_town_hall" };
  }

  const index = s.buildings.findIndex((b) => b.gx === target.gx && b.gy === target.gy && b.kind === target.kind);
  if (index < 0) return { ok: false, state, reason: "no_building" };
  const buildings: BuildingDef[] = s.buildings.filter((_, i) => i !== index);
  const updated: SettlementState = {
    ...s,
    buildings,
    constructionActionUsedThisTurn: true,
  };
  return {
    ok: true,
    state: { ...state, settlements: { ...state.settlements, [settlementId]: updated }, dirty: true },
    reason: "",
  };
}
