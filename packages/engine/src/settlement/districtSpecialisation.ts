import type { BuildingDef, DistrictState } from "@heroes/contracts";
import { isProducerKind, producerResource, type ProducerResource } from "./producers";

// District specialisation, DERIVED.
//
// A district is a 5x5 satellite grid on its own hex (`districtSeed.ts`) and
// every one of its buildings is a row of its own in `settlement_buildings`,
// tagged with the district's own `district_q` / `district_r` (migration
// `035_district_building_ledger.sql`; the OLD shape kept them only inside
// `settlements.districts` JSONB). Until now nothing in the game read that
// ledger's shape: a district's producers were just part of one flat pool, so a
// district of four farms and a district of one farm, one hut, one mine and one
// granary were the same thing to the economy. A district had no identity.
//
// This module gives a district one, and it is DERIVED from the buildings the
// district already persists -- there is no `districtType` field, nothing for a
// player to set, no schema change and no migration. A district's specialisation
// is the share of its OWN buildings that stand on a single production chain
// (the chain being the resource those producers make: the food chain is
// farmField + farmhouse + granary, wood is the woodcutterHut, and so on).
//
// The rule, and why it is shaped this way:
//
//   * A district qualifies only with at least DISTRICT_CHAIN_MIN_PRODUCERS
//     completed producers of ONE resource AND at least DISTRICT_CHAIN_MIN_SHARE
//     of its buildings on that chain. Both bars exist so specialising is work
//     the player chooses to do, not something a district stumbles into.
//   * Below either bar there is NO effect: the scale is exactly 1 for every
//     building, so a mixed district -- and every settlement the game seeds --
//     produces precisely what it produced before this module existed. That is
//     the neutral-by-default half, and it is why a seeded district (two or
//     three buildings, always distinct kinds -- `buildDistrictBuildings`) can
//     never qualify: it holds at most three buildings, one short of the bar.
//   * Above the bar the effect RAMPS with the share, from 0 at the threshold to
//     DISTRICT_CHAIN_MAX_EFFECT at a district that is entirely one chain.
//   * The effect is paid on the chain and TAKEN OFF every producer in the
//     district that is not on it (see `districtSpecialisationScale`). So
//     specialising is not a free multiplier bolted onto a district: it moves
//     the district's output from the chains it is not on to the one it is.
//     That is the trade the player makes, and it is what keeps the choice real
//     rather than strictly better than mixing.

/** Completed producers of one chain a district needs before specialisation pays anything. */
export const DISTRICT_CHAIN_MIN_PRODUCERS = 4;

/** The share of a district's buildings that must stand on one chain. */
export const DISTRICT_CHAIN_MIN_SHARE = 0.6;

/** The effect at full specialisation: +25% on the chain, -25% off it. */
export const DISTRICT_CHAIN_MAX_EFFECT = 0.25;

/** The part of a district this module reads: its own persisted buildings and its own spot set. */
export interface DistrictChainDistrict {
  q: number;
  r: number;
  citySpots: DistrictState["citySpots"];
  buildings: BuildingDef[];
}

export interface DistrictSpecialisation {
  /** The production chain the district is specialised in (the resource its producers make). */
  resource: ProducerResource;
  /** Completed producers in the district standing on that chain. */
  producers: number;
  /** Every building the district holds, whatever its state. */
  buildings: number;
  /** producers / buildings, to 2dp. */
  share: number;
  /** The size of the effect: 0 at the threshold, DISTRICT_CHAIN_MAX_EFFECT at share 1. 2dp. */
  effect: number;
}

/**
 * Tie-break order for the chain a district specialises in: most producers
 * wins, ties broken by this order, so a district holding four farm and four
 * stone producers does not flip its answer between reads.
 */
const CHAIN_ORDER: readonly ProducerResource[] = ["food", "wood", "stone", "iron", "arcane", "gold"];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * The resource a district building produces, or null when it is not a producer
 * or is still under construction. Resolved exactly the way
 * `producerTurnOutput` resolves it: a `mine` reads the district's OWN spots, so
 * the same kind can stand on the stone chain in one district and the iron chain
 * in the next.
 */
function chainOf(building: BuildingDef, district: DistrictChainDistrict): ProducerResource | null {
  if (!isProducerKind(building.kind)) return null;
  if (building.construction) return null;
  return producerResource(building.kind, district.citySpots, building.gx, building.gy);
}

/** Completed producers per chain. The single read of a district's shape. */
function chainCounts(district: DistrictChainDistrict): Map<ProducerResource, number> {
  const counts = new Map<ProducerResource, number>();
  for (const b of district.buildings) {
    const chain = chainOf(b, district);
    if (!chain) continue;
    counts.set(chain, (counts.get(chain) ?? 0) + 1);
  }
  return counts;
}

/** The chain with the most producers and how many, or null when the district has no producer at all. */
function leadingChain(
  counts: Map<ProducerResource, number>,
): { resource: ProducerResource; count: number } | null {
  let resource: ProducerResource | null = null;
  let count = 0;
  for (const chain of CHAIN_ORDER) {
    const n = counts.get(chain) ?? 0;
    if (n > count) {
      count = n;
      resource = chain;
    }
  }
  return resource ? { resource, count } : null;
}

/**
 * What a district is specialised in, or null when it is not specialised. Pure:
 * the same buildings always give the same answer, which is what makes the
 * engine's number and the number on screen the same number (see
 * `districtSpecialisationScale`, which both production loops and the city
 * view's label go through).
 */
export function districtSpecialisation(district: DistrictChainDistrict): DistrictSpecialisation | null {
  const buildingsInDistrict = district.buildings.length;
  if (buildingsInDistrict === 0) return null;

  const lead = leadingChain(chainCounts(district));
  if (!lead || lead.count < DISTRICT_CHAIN_MIN_PRODUCERS) return null;

  const share = round2(lead.count / buildingsInDistrict);
  if (share < DISTRICT_CHAIN_MIN_SHARE) return null;

  // Deliberately NOT rounded here: the effect is a fraction of a producer's
  // output and the amount is rounded once, at the point it becomes a number a
  // player is paid (`districtProductionLines`). Rounding the fraction to 2dp
  // first turned the clean 0.8-share case into 0.13 rather than 0.125.
  const effect =
    (DISTRICT_CHAIN_MAX_EFFECT * (share - DISTRICT_CHAIN_MIN_SHARE)) / (1 - DISTRICT_CHAIN_MIN_SHARE);
  return { resource: lead.resource, producers: lead.count, buildings: buildingsInDistrict, share, effect };
}

/**
 * The multiplier one district producer's output takes: `1 + effect` on the
 * specialised chain, `1 - effect` off it. Exactly 1 for every resource when the
 * district is not specialised, which is what keeps a mixed district's numbers
 * identical to the pre-specialisation game.
 */
export function districtSpecialisationScale(
  spec: DistrictSpecialisation | null,
  resource: ProducerResource,
): number {
  if (!spec || spec.effect === 0) return 1;
  return spec.resource === resource ? 1 + spec.effect : 1 - spec.effect;
}

/** A fraction as words: whole percents where it is one, one decimal where it is not (0.125 -> "12.5%"). */
function pct(fraction: number): string {
  const p = Math.round(fraction * 1000) / 10;
  return `${Number.isInteger(p) ? p : p.toFixed(1)}%`;
}

function chainName(resource: ProducerResource): string {
  return resource.charAt(0).toUpperCase() + resource.slice(1);
}

/**
 * The district's specialisation as one line a player reads. Specialisation is a
 * decision, so this string must say what the district is doing NOW and, when it
 * is paying nothing, what the player would have to do differently for it to pay
 * -- a bonus nobody can see is a number, not a decision. Rendered by the city
 * view's corner labels (`cityScene.ts`), under the district's own title.
 */
export function districtSpecialisationLabel(district: DistrictChainDistrict): string {
  const spec = districtSpecialisation(district);
  if (spec) {
    return `${chainName(spec.resource)} district — ${spec.producers} of ${spec.buildings} buildings on one chain: +${pct(spec.effect)} ${spec.resource}, -${pct(spec.effect)} other chains here`;
  }

  const lead = leadingChain(chainCounts(district));
  if (!lead) {
    // Distinguish "nothing here produces" from "the producer is still a site":
    // a district holding one unbuilt farm field used to read "no producer",
    // which contradicts the building the player can see on its grid.
    const hasUnbuiltProducer = district.buildings.some(
      (b) => isProducerKind(b.kind) && Boolean(b.construction),
    );
    return hasUnbuiltProducer
      ? "No specialisation — this district's producers are still under construction"
      : "No specialisation — no producer in this district";
  }
  if (lead.count < DISTRICT_CHAIN_MIN_PRODUCERS) {
    return `No specialisation — ${lead.count} of ${district.buildings.length} buildings on the ${lead.resource} chain; ${DISTRICT_CHAIN_MIN_PRODUCERS} needed`;
  }
  const needed = Math.ceil(DISTRICT_CHAIN_MIN_SHARE * district.buildings.length);
  return `No specialisation — ${lead.count} of ${district.buildings.length} buildings on the ${lead.resource} chain; ${needed} needed (${pct(DISTRICT_CHAIN_MIN_SHARE)})`;
}
