import type { GameState, HeroId, Platoon, SettlementId, TransferResult } from "@heroes/contracts";
import {
  ARMY_STACK_SLOTS,
  MAX_PLATOON_ENTRIES,
  normalizePlatoons,
  settlementStacks,
} from "../units";
import { depositIntoGarrison } from "./recruitUnits";

function totalOfType(stacks: Platoon[], unitTypeId: string): number {
  let total = 0;
  for (const p of stacks) {
    for (const e of p.entries) {
      if (e.unitTypeId === unitTypeId) total += e.count;
    }
  }
  return total;
}

// Remove `count` units of one type, highest slot index first (mirrors
// trimPlatoonsFromEnd's ordering, scoped to a single type); emptied entries
// are dropped.
function removeByType(stacks: Platoon[], unitTypeId: string, count: number): Platoon[] {
  const out = stacks.map((p) => ({ entries: p.entries.map((e) => ({ ...e })) }));
  let remaining = count;
  for (let i = out.length - 1; i >= 0 && remaining > 0; i--) {
    const entries = out[i].entries;
    for (let j = entries.length - 1; j >= 0 && remaining > 0; j--) {
      const e = entries[j];
      if (e.unitTypeId !== unitTypeId) continue;
      const take = Math.min(e.count, remaining);
      e.count -= take;
      remaining -= take;
      if (e.count === 0) entries.splice(j, 1);
    }
  }
  return out;
}

export function transferUnits(
  state: GameState,
  opts: {
    heroId: HeroId;
    settlementId: SettlementId;
    direction: "toHero" | "toGarrison";
    unitTypeId: string;
    count: number;
    toSlot?: number;
  },
): TransferResult {
  const hero = state.heroes[opts.heroId];
  const settlement = state.settlements[opts.settlementId];
  if (!hero) return { state, ok: false, reason: "no_hero" };
  if (!settlement) return { state, ok: false, reason: "no_settlement" };
  if (hero.q !== settlement.q || hero.r !== settlement.r) {
    return { state, ok: false, reason: "hero_not_at_settlement" };
  }
  if (settlement.ownerId === null || settlement.ownerId !== hero.ownerId) {
    return { state, ok: false, reason: "not_owned_settlement" };
  }
  if (!Number.isInteger(opts.count) || opts.count < 1) {
    return { state, ok: false, reason: "invalid_count" };
  }

  if (opts.direction === "toHero") {
    const garrison = settlementStacks(settlement);
    if (opts.count > totalOfType(garrison, opts.unitTypeId)) {
      return { state, ok: false, reason: "not_enough_units" };
    }
    const heroStacks = normalizePlatoons(hero.stacks);
    let updated: Platoon[];
    if (opts.toSlot !== undefined) {
      if (!Number.isInteger(opts.toSlot) || opts.toSlot < 0 || opts.toSlot >= ARMY_STACK_SLOTS) {
        return { state, ok: false, reason: "invalid_slot" };
      }
      const platoon = heroStacks[opts.toSlot];
      const entry = platoon.entries.find((e) => e.unitTypeId === opts.unitTypeId);
      if (entry) entry.count += opts.count;
      else if (platoon.entries.length < MAX_PLATOON_ENTRIES) {
        platoon.entries.push({ unitTypeId: opts.unitTypeId, count: opts.count });
      } else {
        return { state, ok: false, reason: "platoon_full" };
      }
      updated = heroStacks;
    } else {
      const deposit = depositIntoGarrison(heroStacks, opts.unitTypeId, opts.count);
      if (!deposit.ok) return { state, ok: false, reason: "platoon_full" };
      updated = deposit.stacks;
    }
    return {
      state: {
        ...state,
        heroes: { ...state.heroes, [hero.id]: { ...hero, stacks: updated } },
        settlements: {
          ...state.settlements,
          [settlement.id]: { ...settlement, stacks: removeByType(garrison, opts.unitTypeId, opts.count) },
        },
        dirty: true,
      },
      ok: true,
      reason: "",
    };
  }

  if (opts.direction === "toGarrison") {
    const heroStacks = normalizePlatoons(hero.stacks);
    if (opts.count > totalOfType(heroStacks, opts.unitTypeId)) {
      return { state, ok: false, reason: "not_enough_units" };
    }
    const deposit = depositIntoGarrison(settlementStacks(settlement), opts.unitTypeId, opts.count);
    if (!deposit.ok) return { state, ok: false, reason: "garrison_full" };
    return {
      state: {
        ...state,
        heroes: {
          ...state.heroes,
          [hero.id]: { ...hero, stacks: removeByType(heroStacks, opts.unitTypeId, opts.count) },
        },
        settlements: { ...state.settlements, [settlement.id]: { ...settlement, stacks: deposit.stacks } },
        dirty: true,
      },
      ok: true,
      reason: "",
    };
  }

  return { state, ok: false, reason: "invalid_direction" };
}
