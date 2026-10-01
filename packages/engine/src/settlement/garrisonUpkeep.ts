import type { SettlementId, SettlementState } from "@heroes/contracts";
import { platoonTroopTotal, settlementStacks } from "../units";
import {
  resolveTroopUpkeep,
  type TroopUpkeepOptions,
} from "../economy/troopUpkeep";

export type GarrisonUpkeepOptions = TroopUpkeepOptions;

export function applyGarrisonUpkeep(
  settlements: Record<SettlementId, SettlementState>,
  options: GarrisonUpkeepOptions = {},
): Record<SettlementId, SettlementState> {
  const newSettlements: Record<SettlementId, SettlementState> = { ...settlements };
  for (const s of Object.values(newSettlements)) {
    if (s.ownerId === null) continue;
    const stacks = settlementStacks(s);
    if (platoonTroopTotal(stacks) <= 0) continue;
    // Rule-identical to hero upkeep (economy/troopUpkeep.ts's resolveTroopUpkeep):
    // a settlement's treasury plays the hero's purse and its warehouse food the
    // hero's cargo, its morale field is the same 0..100 scale, and the shortfall
    // bookkeeping lives on the garrisonUnpaid* trio.
    const resolved = resolveTroopUpkeep(
      {
        id: s.id,
        stacks,
        gold: s.gold,
        food: s.warehouse.food,
        morale: s.morale,
        unpaidSinceDay: s.garrisonUnpaidSinceDay,
        unpaidTroops: s.garrisonUnpaidTroops,
        unpaidGold: s.garrisonUnpaidGold,
      },
      options,
    );
    // stacks is only written back when desertion rewrote it: a garrison-less
    // settlement keeps its absent `stacks` field rather than gaining a
    // normalized empty array.
    newSettlements[s.id] = {
      ...s,
      ...(resolved.deserted ? { stacks: resolved.stacks } : {}),
      gold: resolved.gold,
      morale: resolved.morale,
      warehouse: { ...s.warehouse, food: resolved.food },
      garrisonUnpaidSinceDay: resolved.unpaidSinceDay,
      garrisonUnpaidTroops: resolved.unpaidTroops,
      garrisonUnpaidGold: resolved.unpaidGold,
    };
  }
  return newSettlements;
}