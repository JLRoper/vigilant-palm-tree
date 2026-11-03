import type { FactionEconomyModifier, FactionId, ResourceType } from "@heroes/contracts";
import { FACTION_REGISTRY, playerFactionId } from "../factionRegistry";

/**
 * THE ONE SEAM between a seat's roster faction and the economy it runs.
 *
 * `FactionDef.economy` (packages/contracts/src/factions.ts) is the one optional
 * field; this module is the one place it is ever read. Everything that pays or
 * displays a building's output asks this module for a multiplier, so the
 * display and the payout cannot drift apart the way they would if the table
 * were consulted in the income function and again in the production loop.
 *
 * The type is deliberately the minimum a seat has to look like: `Player` and
 * any `{ factionId?: FactionId }` shape both fit, and `undefined` (a legacy
 * seat, a neutral settlement, a bare test fixture) resolves to the neutral
 * modifier -- which is the whole reason this is safe to thread through paths
 * that predate factions.
 */
export type FactionEconomySeat = { factionId?: FactionId } | undefined;

/** The shared neutral modifier. Frozen so no caller can mutate the baseline. */
const NEUTRAL: FactionEconomyModifier = Object.freeze({});

const PCT_KEY: Record<ResourceType, keyof FactionEconomyModifier> = {
  gold: "goldPct",
  food: "foodPct",
  wood: "woodPct",
  stone: "stonePct",
  iron: "ironPct",
  arcane: "arcanePct",
};

/**
 * The seat's raw economy modifier: its faction's table entry, or the neutral
 * (empty) one when the seat has no faction, a faction the registry has no
 * entry for, or a faction that simply carries no `economy` key (human,
 * neutral). Never returns undefined, so callers never need a fallback.
 */
export function factionEconomyModifier(seat: FactionEconomySeat): FactionEconomyModifier {
  return FACTION_REGISTRY[playerFactionId(seat)].economy ?? NEUTRAL;
}

/**
 * The multiplier the seat's faction applies to one resource's building output.
 *
 * Exactly 1 when the faction has no entry for that resource -- including the
 * whole neutral modifier -- and callers must treat 1 as "multiply by nothing"
 * rather than "multiply by 1.0": the arithmetic is then literally the
 * pre-faction expression, which is what makes neutrality provable by
 * measurement instead of by reading the diff.
 *
 * Applied to the BASE a building pays, before the tile multiplier and the
 * staffing effort, so the three compose multiplicatively and the existing
 * single rounding step is unchanged.
 */
export function factionOutputScale(seat: FactionEconomySeat, resource: ResourceType): number {
  const pct = factionEconomyModifier(seat)[PCT_KEY[resource]] ?? 0;
  return pct === 0 ? 1 : 1 + pct / 100;
}
