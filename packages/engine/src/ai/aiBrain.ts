import { Axial, isCoveredWagonId, resolveGameMode } from "@heroes/contracts";
import { findPath, NEIGHBOR_DIRS, hexDistance } from "../map/pathfinding";
import { GameMap } from "../map/gameMap";
import type { BuildingDef, BuildingKind, FactionId, GameState, HeroId, HeroState, SettlementId, SettlementState } from "@heroes/contracts";
import {
  platoonPower,
  platoonTroopTotal,
  platoonsHaveTroops,
  settlementStacks,
  unitPower,
  type UnitType,
} from "../units";
import {
  depositIntoGarrison,
  eligibleRecruitSources,
  type RecruitSource,
} from "../settlement/recruitUnits";
import {
  buildingDraftMax,
  buildingFootprintFromRegistry,
  buildingPlacementCost,
  getBuildingEffect,
  isRecruitBuilding,
} from "../buildingRegistry";
import { cityViewSizeFor } from "../settlement/citySpots";
import { RESOURCES } from "../map/resourceTiles";
import { computeSettlementRates, generateSettlementName } from "../economy/settlementRates";
import { evaluateCharterRequirements, validCharterHexes } from "../charter/requirements";
import { canFoundSettlement } from "../settlers/found";

export interface AiMove {
  toTile: Axial;
  cost: number;
}

type TargetKind = "enemy" | "garrisoned_settlement" | "enemy_settlement" | "neutral_settlement" | "resource" | "founding" | "wander";

interface Target {
  kind: TargetKind;
  tile: Axial;
  priority: number;
}

const ENEMY_REACH = 7;
const RESOURCE_REACH = 8;
const SETTLEMENT_RESOURCE_BUFFER = 2;

export function aiTargetReachForMap(
  baseReach: number,
  map: { width?: number; height?: number },
): number {
  const w = map.width ?? 24;
  const h = map.height ?? 18;
  const total = w * h;
  if (!(total > 24 * 18)) return baseReach;
  return Math.round(baseReach * Math.sqrt(total / (24 * 18)));
}

/**
 * The settlement target band spans the whole map. A settlement anywhere is a
 * candidate, so the reach is derived from the map's own dimensions -- its hex
 * diameter, the greatest straight-line distance between any two of its hexes --
 * rather than a fixed radius scaled by area. The hardcoded radius it replaces
 * (8, sqrt-scaled to 12 on a 36x27 map) left the far corner of a medium board
 * invisible: the sixth capital stood 19-20 hexes away, never entered the target
 * list, and the seat converted five of six capitals and then wandered in place.
 * The band keeps its distance-decayed priorities, so a nearer settlement still
 * outranks a far one; only the "not a target at all" cutoff moves.
 */
export function aiSettlementReachForMap(map: { width?: number; height?: number }): number {
  const w = map.width ?? 24;
  const h = map.height ?? 18;
  return Math.max(0, w + h - 2);
}

// Target priority bands (higher wins; ties break by distance decay). Enemy
// heroes stay the top band; the settlement bands sit between heroes and
// resources so the AI prefers fights it can win over empty expansion, and
// empty expansion over resource pickups. Decay is per hex of straight-line
// distance inside each band.
const GARRISON_ATTACK_RATIO = 1.5;
const GARRISONED_SETTLEMENT_PRIORITY = 700;
const ENEMY_SETTLEMENT_PRIORITY = 650;
const NEUTRAL_SETTLEMENT_PRIORITY = 600;
const SETTLEMENT_PRIORITY_DECAY = 5;

// The AI attacks a non-owned garrisoned settlement (enemy-owned or neutral)
// when its army power is at least this multiple of the garrison's; weaker
// armies treat the garrison as a path obstacle and route around it. Power
// weights each unit by catalog stats (attack + defence, see engine
// unitPower), so quality counts — an unknown unit (no catalog yet) weighs
// like baseline troops, which degrades the ratio exactly to the old
// troop-count comparison.
function attackerBeatsGarrison(attackerPower: number, garrison: SettlementState, unitTypes: Record<string, UnitType>): boolean {
  return attackerPower >= GARRISON_ATTACK_RATIO * platoonPower(settlementStacks(garrison), unitTypes);
}

// After a bounced (lost or drawn) garrison assault the AI leaves the
// settlement alone for this many rounds — recorded round R means rounds R
// and R+1 are excluded, and the hero may re-attack in round R + value. The
// expiry source is GameState.round (advanced by the engine's advanceRound
// on every round wrap); the entries live in an in-memory map on the primary
// client's TurnController.
export const GARRISON_BACKOFF_ROUNDS = 2;

export interface GarrisonRecruitment {
  settlementId: string;
  buildingKind: BuildingKind;
  gx: number;
  gy: number;
  unitTypeId: string;
  count: number;
  district?: { q: number; r: number };
}

// Enemy heroes within this straight-line reach of a settlement count toward
// its threat level (same reach style as the target bands above; path-cost
// reach is plan item I2).
const GARRISON_THREAT_REACH = 8;
// Target garrison power = ratio x nearby threat power...
const GARRISON_TARGET_RATIO = 1.0;
// ...but never below this floor, so unthreatened towns still grow a
// skeleton garrison (two baseline-strength units).
const GARRISON_POWER_FLOOR = 4;
// Never spend a settlement below this much gold (no AI-consumption
// precedent exists in applyGarrisonUpkeep/economy, so this is a named
// constant floor).
const GARRISON_GOLD_RESERVE = 100;

// B1 (plan/2026-09-29-settlement-battle-followups.md): for every settlement
// the seat owns that has no hero standing on it, size a garrison against the
// total power of enemy heroes in reach and buy the best power-per-gold
// recruitable units the engine's own eligibility gate admits (see
// eligibleRecruitSources — the same building/construction/minLevel gating
// recruitUnits enforces), limited by the gold reserve, warehouse resources,
// and the engine's garrison deposit cap. Pure and deterministic: no clock,
// no randomness, stable tie-breaks.
export function pickGarrisonRecruitment(
  state: GameState,
  seat: number,
  unitTypes: Record<string, UnitType> = {},
): GarrisonRecruitment[] {
  const out: GarrisonRecruitment[] = [];
  for (const [settlementId, settlement] of Object.entries(state.settlements)) {
    if (settlement.ownerId !== seat) continue;
    if (heroStandsOn(state, settlement)) continue;
    const threat = settlementThreat(state, settlement, seat, unitTypes);
    const targetPower = Math.max(GARRISON_POWER_FLOOR, GARRISON_TARGET_RATIO * threat);
    const deficit = targetPower - platoonPower(settlementStacks(settlement), unitTypes);
    if (deficit <= 0) continue;
    out.push(...garrisonPurchases(settlement, settlementId, deficit, unitTypes, state.players.find((player) => player.id === seat)?.factionId));
  }
  return out;
}

function heroStandsOn(state: GameState, settlement: SettlementState): boolean {
  for (const hero of Object.values(state.heroes)) {
    if (hero.q === settlement.q && hero.r === settlement.r) return true;
  }
  return false;
}

function settlementThreat(
  state: GameState,
  settlement: SettlementState,
  seat: number,
  unitTypes: Record<string, UnitType>,
): number {
  let threat = 0;
  for (const hero of Object.values(state.heroes)) {
    if (hero.ownerId === seat) continue;
    if (hexDistance(hero, settlement) > GARRISON_THREAT_REACH) continue;
    threat += platoonPower(hero.stacks, unitTypes);
  }
  return threat;
}

function garrisonPurchases(
  settlement: SettlementState,
  settlementId: string,
  deficit: number,
  unitTypes: Record<string, UnitType>,
  factionId?: FactionId,
): GarrisonRecruitment[] {
  const candidates = eligibleRecruitSources(settlement, { unitTypes, seatFactionId: factionId })
    .filter((source) => source.entry.goldCost > 0)
    .sort(
      (a, b) =>
        powerPerGold(b, unitTypes) - powerPerGold(a, unitTypes) ||
        b.entry.goldCost - a.entry.goldCost ||
        (a.entry.unitTypeId < b.entry.unitTypeId ? -1 : 1),
    );
  let gold = settlement.gold - GARRISON_GOLD_RESERVE;
  const warehouse = { ...settlement.warehouse };
  let workingStacks = settlementStacks(settlement);
  let remaining = deficit;
  const out: GarrisonRecruitment[] = [];
  for (const source of candidates) {
    if (remaining <= 0) break;
    if (gold < source.entry.goldCost) continue;
    // recruitUnits rejects any order above the source building's draft pool
    // (draft_pool_empty); a plan ignoring it would be re-planned identically
    // every round, so cap the order here against the same pool.
    const building = recruitSourceBuilding(settlement, source);
    const avail = building
      ? Math.floor(building.draft?.[source.entry.unitTypeId] ?? buildingDraftMax(building.kind))
      : 0;
    if (avail <= 0) continue;
    const deposit = depositIntoGarrison(workingStacks, source.entry.unitTypeId, 1);
    if (!deposit.ok) continue;
    const power = unitPower(unitTypes[source.entry.unitTypeId]);
    let count = Math.min(Math.floor(gold / source.entry.goldCost), Math.ceil(remaining / power), avail);
    for (const [res, perUnit] of Object.entries(source.entry.resourceCost ?? {})) {
      const available = warehouse[res as keyof typeof warehouse] ?? 0;
      count = Math.min(count, perUnit > 0 ? Math.floor(available / perUnit) : count);
    }
    if (count < 1) continue;
    out.push({
      settlementId,
      buildingKind: source.buildingKind,
      gx: source.gx,
      gy: source.gy,
      unitTypeId: source.entry.unitTypeId,
      count,
      ...(source.district ? { district: { q: source.district.q, r: source.district.r } } : {}),
    });
    gold -= source.entry.goldCost * count;
    for (const [res, perUnit] of Object.entries(source.entry.resourceCost ?? {})) {
      const key = res as keyof typeof warehouse;
      warehouse[key] = (warehouse[key] ?? 0) - perUnit * count;
    }
    workingStacks = depositIntoGarrison(workingStacks, source.entry.unitTypeId, count).stacks;
    remaining -= power * count;
  }
  return out;
}

// RecruitSource carries the building's kind/coords, not the building itself,
// so resolve it back for the draft pool on the real BuildingDef (a district
// source resolves inside its own district first).
function recruitSourceBuilding(
  settlement: SettlementState,
  source: RecruitSource,
): BuildingDef | undefined {
  const district = source.district;
  if (district) {
    const d = Object.values(settlement.districts ?? {}).find(
      (dd) => dd.q === district.q && dd.r === district.r,
    );
    const match = d?.buildings.find(
      (b) => b.kind === source.buildingKind && b.gx === source.gx && b.gy === source.gy,
    );
    if (match) return match;
  }
  return settlement.buildings.find(
    (b) => b.kind === source.buildingKind && b.gx === source.gx && b.gy === source.gy,
  );
}

function powerPerGold(source: RecruitSource, unitTypes: Record<string, UnitType>): number {
  return unitPower(unitTypes[source.entry.unitTypeId]) / source.entry.goldCost;
}

// ── The hero's own army: an AI seat's route THROUGH the capital garrison ───
//
// `pickGarrisonRecruitment` above spends a seat's gold on the troops standing
// IN its towns, and `aiDriver` dispatches those into settlement garrisons
// only. That left the seat with no route past a garrisoned target at all once
// neutral capitals started garrisoned (settlement/neutralGarrison.ts): the
// hero's army never grew, and `attackerBeatsGarrison` (1.5x the garrison's
// power) declined the 168-power capital forever with the 132-power starting
// army. A player faces the same 1.5x-equivalent gate and gets through it the
// only way the engine offers: recruit at a settlement (`RecruitUnits` lands in
// the GARRISON) and `TransferUnits` the recruits onto the hero standing on
// that settlement's tile. These planners are that same route for the AI.
//
// SIZING — the player's realistic force at the turn it can first reach a
// capital, measured the same way the garrison table was (resolveBattle, real
// unit catalog, 12 obstacle seeds against the 168-power capital garrison):
// the player's starting army (216 power) LOSES 12/12, +10 swordsmen (316) wins
// 12/12, and the +13 swordsmen / 2,600g force the garrison doc calls one
// turn's recruiting (346) wins 12/12. So 346 is the number that same curve
// ends at, and it is deliberately BOTH:
//   * below what a player can field at that turn (it IS the player's number),
//     so the AI can never be stronger than the player at the same turn, since
//     it pays the same gold, warehouse and draft-pool prices for every unit;
//   * above this brain's own gate (1.5 x 168 = 252), which is what makes an
//     army grown to it ATTACK the capital instead of routing around it.
export const HERO_ARMY_TARGET_POWER = 346;

// How far from its city a hero will still walk home to collect troops that are
// waiting there — the same reach style as the settlement bands above.
const HERO_REFIT_REACH = 14;

export interface HeroArmyRecruitment {
  heroId: HeroId;
  settlementId: SettlementId;
  buildingKind: BuildingKind;
  gx: number;
  gy: number;
  unitTypeId: string;
  count: number;
  district?: { q: number; r: number };
}

/**
 * The purchases that grow a seat's hero armies toward HERO_ARMY_TARGET_POWER,
 * taken from the city each hero recruits out of (heroArmyHome: the city it
 * stands on when that one can recruit, else the nearest of the seat's that
 * can — a player recruits where the barracks are, wherever the hero happens to
 * be).
 *
 * `RecruitUnits` deposits into that settlement's garrison, and only
 * `TransferUnits` moves the recruits onto a hero — a command that refuses a
 * hero anywhere but the settlement's own tile, which is why the hero's walk
 * home (pickHeroRefitStep) is the other half of this loop. The purchases are
 * sized to what the hero plus its waiting garrison still lack, priced by the
 * same shopping rule the garrison planner uses (best power per gold, the same
 * gold reserve, warehouse and draft-pool limits — one rule for both spenders),
 * and the caller dispatches a transfer straight after each accepted recruit
 * that the hero is standing there for.
 *
 * Settlers mode is excluded outright: a covered wagon has no army and must
 * never be given one (the mode's whole premise, pickSettlersWagonAction above).
 * Pure and deterministic: no clock, no rng, stable tie-breaks.
 */
export function pickHeroArmyRecruitment(
  state: GameState,
  seat: number,
  unitTypes: Record<string, UnitType> = {},
): HeroArmyRecruitment[] {
  if (resolveGameMode(state.gameMode) === "settlers") return [];
  const out: HeroArmyRecruitment[] = [];
  for (const hero of Object.values(state.heroes)) {
    if (hero.ownerId !== seat) continue;
    if (isCoveredWagonId(hero.id)) continue;
    const home = heroArmyHome(state, hero);
    if (!home) continue;
    const deficit = heroArmyDeficit(hero, home, unitTypes);
    if (deficit <= 0) continue;
    for (const item of garrisonPurchases(
      home,
      home.id,
      deficit,
      unitTypes,
      state.players.find((player) => player.id === seat)?.factionId,
    )) {
      out.push({ ...item, heroId: hero.id });
    }
  }
  return out;
}

/**
 * The seat's city a hero grows its army from: the settlement it is standing on
 * when that one can recruit at all, else the nearest of its own that can, else
 * the nearest own settlement. A player recruits where the barracks are; the
 * hero then walks there to collect (pickHeroRefitStep below), which is why the
 * city is chosen independently of where the hero happens to be standing.
 */
function heroArmyHome(state: GameState, hero: HeroState): SettlementState | null {
  const owned = Object.values(state.settlements).filter((s) => s.ownerId === hero.ownerId);
  if (owned.length === 0) return null;
  const standingOn = owned.find((s) => s.q === hero.q && s.r === hero.r);
  if (standingOn && eligibleRecruitSources(standingOn).length > 0) return standingOn;
  const ranked = owned
    .slice()
    .sort((a, b) => hexDistance(hero, a) - hexDistance(hero, b) || a.q - b.q || a.r - b.r);
  return ranked.find((s) => eligibleRecruitSources(s).length > 0) ?? ranked[0];
}

/**
 * What the hero's army is still missing: the target, less what it already
 * carries, less what its city is already holding for it. Counting the waiting
 * garrison is what keeps the purchases from piling up a second army at home
 * while the hero is still walking back.
 */
function heroArmyDeficit(
  hero: HeroState,
  home: SettlementState,
  unitTypes: Record<string, UnitType>,
): number {
  return (
    HERO_ARMY_TARGET_POWER -
    platoonPower(hero.stacks, unitTypes) -
    platoonPower(settlementStacks(home), unitTypes)
  );
}

export interface HeroArmyPlacement {
  settlementId: SettlementId;
  kind: BuildingKind;
  gx: number;
  gy: number;
}

/**
 * Extra recruit buildings for the seat's city, when its recruits alone cannot
 * reach HERO_ARMY_TARGET_POWER.
 *
 * This is the half the draft pool makes unavoidable, and it was measured, not
 * assumed: a seat holds ONE recruit building for its faction on a fresh map, at
 * `draftMax` 3 units recharged `draftPerDay` per day, so the troop trickle
 * alone buys about +14 power in 24 rounds (seed 26 medium, ghoul-class units)
 * or +42 in 24 rounds (seed 12) — far short of the 252 an assault needs. A
 * player answers that by placing more recruit buildings in the city view, and
 * this is the same answer through the same `PlaceBuildings` command, paying the
 * same placement cost, resource cost and build days. Measured with it: capital
 * reach (346) in ten rounds on the same boards.
 *
 * The kind is a recruit building the settlement ALREADY has, so a fresh
 * placement is always faction-legal and its level-1 recruits are known; the
 * copies needed are whatever covers the deficit at `draftMax` units per
 * building. City cells come from the front of the same grid the city view
 * draws (`cityViewSizeFor`), first fit, skipping every cell an existing
 * building's footprint covers.
 */
export function pickHeroArmyBuildings(
  state: GameState,
  seat: number,
  unitTypes: Record<string, UnitType> = {},
): HeroArmyPlacement[] {
  if (resolveGameMode(state.gameMode) === "settlers") return [];
  const out: HeroArmyPlacement[] = [];
  for (const hero of Object.values(state.heroes)) {
    if (hero.ownerId !== seat) continue;
    if (isCoveredWagonId(hero.id)) continue;
    const settlement = heroArmyHome(state, hero);
    if (!settlement) continue;
    const deficit = heroArmyDeficit(hero, settlement, unitTypes);
    if (deficit <= 0) continue;
    if (recruitCapacityPower(settlement, unitTypes) >= deficit) continue;
    const kind = bestRecruitKindOwned(settlement, unitTypes);
    if (!kind) continue;
    const perBuilding = buildingDraftMax(kind) * bestLevelOnePower(kind, unitTypes);
    if (perBuilding <= 0) continue;
    let needed = Math.ceil((deficit - recruitCapacityPower(settlement, unitTypes)) / perBuilding);
    const cells = freeCityCells(settlement, kind, needed);
    for (const cell of cells) {
      if (needed <= 0) break;
      const cost = buildingPlacementCost(kind);
      if ((cost.gold ?? 0) + GARRISON_GOLD_RESERVE > settlement.gold) break;
      if ((cost.wood ?? 0) > settlement.warehouse.wood) break;
      if ((cost.stone ?? 0) > settlement.warehouse.stone) break;
      if ((cost.iron ?? 0) > settlement.warehouse.iron) break;
      if ((cost.arcane ?? 0) > settlement.warehouse.arcane) break;
      out.push({ settlementId: settlement.id, kind, gx: cell.gx, gy: cell.gy });
      needed -= 1;
    }
  }
  return out;
}

/** Power the settlement's recruit buildings can still field from their draft pools right now. */
function recruitCapacityPower(
  settlement: SettlementState,
  unitTypes: Record<string, UnitType>,
): number {
  let power = 0;
  for (const source of eligibleRecruitSources(settlement, { unitTypes })) {
    const building = recruitSourceBuilding(settlement, source);
    const avail = building
      ? Math.floor(building.draft?.[source.entry.unitTypeId] ?? buildingDraftMax(building.kind))
      : 0;
    if (avail <= 0) continue;
    power += avail * unitPower(unitTypes[source.entry.unitTypeId]);
  }
  return power;
}

/** The strongest unit a level-1 copy of this kind offers (a fresh placement starts at level 1). */
function bestLevelOnePower(kind: BuildingKind, unitTypes: Record<string, UnitType>): number {
  let power = 0;
  for (const entry of getBuildingEffect(kind).recruits) {
    if ((entry.minLevel ?? 1) > 1) continue;
    power = Math.max(power, unitPower(unitTypes[entry.unitTypeId]));
  }
  return power;
}

/** The recruit kind this settlement already holds the AI should copy: best power per gold at level 1. */
function bestRecruitKindOwned(
  settlement: SettlementState,
  unitTypes: Record<string, UnitType>,
): BuildingKind | null {
  let best: { kind: BuildingKind; value: number } | null = null;
  for (const building of settlement.buildings) {
    if (!isRecruitBuilding(building.kind)) continue;
    for (const entry of getBuildingEffect(building.kind).recruits) {
      if ((entry.minLevel ?? 1) > 1 || entry.goldCost <= 0) continue;
      const value = unitPower(unitTypes[entry.unitTypeId]) / entry.goldCost;
      if (!best || value > best.value) best = { kind: building.kind, value };
    }
  }
  return best?.kind ?? null;
}

/** The first `count` footprint-free cells of the settlement's own city grid, in row order. */
function freeCityCells(
  settlement: SettlementState,
  kind: BuildingKind,
  count: number,
): Array<{ gx: number; gy: number }> {
  const grid = cityViewSizeFor(settlement.level);
  const footprint = buildingFootprintFromRegistry(kind, 1);
  const occupied = new Set<string>();
  for (const building of settlement.buildings) {
    const fp = buildingFootprintFromRegistry(building.kind, building.level);
    const w = Math.max(1, Math.ceil(building.w ?? fp.w));
    const h = Math.max(1, Math.ceil(building.h ?? fp.h));
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) occupied.add(`${building.gx + dx},${building.gy + dy}`);
    }
  }
  const out: Array<{ gx: number; gy: number }> = [];
  for (let gy = 0; gy + footprint.h <= grid && out.length < count; gy++) {
    for (let gx = 0; gx + footprint.w <= grid && out.length < count; gx++) {
      let free = true;
      for (let dy = 0; dy < footprint.h && free; dy++) {
        for (let dx = 0; dx < footprint.w && free; dx++) {
          if (occupied.has(`${gx + dx},${gy + dy}`)) free = false;
        }
      }
      if (free) {
        out.push({ gx, gy });
        for (let dy = 0; dy < footprint.h; dy++) {
          for (let dx = 0; dx < footprint.w; dx++) occupied.add(`${gx + dx},${gy + dy}`);
        }
      }
    }
  }
  return out;
}

/**
 * The step a hero takes toward the friendly city whose garrison is holding
 * troops for it, or null.
 *
 * The collect half of the loop above: recruits land in a settlement garrison,
 * and only a hero standing on that tile can take them. The errand exists ONLY
 * while troops are actually waiting (`platoonsHaveTroops`), so a hero with an
 * empty home city — which is every hero in a game the AI is not growing an
 * army in — plans exactly as it did before, and `pickAiMove` keeps its
 * contract. Pure and deterministic: no clock, no rng.
 */
export function pickHeroRefitStep(
  state: GameState,
  heroId: HeroId,
  map: GameMap,
  unitTypes: Record<string, UnitType> = {},
  blocked: ReadonlySet<string> = new Set<string>(),
): AiMove | null {
  if (resolveGameMode(state.gameMode) === "settlers") return null;
  if (isCoveredWagonId(heroId)) return null;
  const hero = state.heroes[heroId];
  if (!hero) return null;
  if (hero.movementRemaining < 1) return null;
  if (platoonPower(hero.stacks, unitTypes) >= HERO_ARMY_TARGET_POWER) return null;
  const homes = Object.values(state.settlements).filter(
    (s) =>
      s.ownerId === hero.ownerId &&
      !(s.q === hero.q && s.r === hero.r) &&
      platoonsHaveTroops(settlementStacks(s)) &&
      hexDistance(hero, s) <= HERO_REFIT_REACH,
  );
  if (homes.length === 0) return null;
  homes.sort((a, b) => hexDistance(hero, a) - hexDistance(hero, b) || a.q - b.q || a.r - b.r);
  const obstacles = new Set<string>(blocked);
  for (const [otherId, other] of Object.entries(state.heroes)) {
    if (otherId !== heroId) obstacles.add(`${other.q},${other.r}`);
  }
  for (const home of homes) {
    const step = stepToward(hero, { q: home.q, r: home.r }, map, obstacles);
    if (step) return step;
  }
  return null;
}

export interface CharterAction {
  heroId: string;
  targetQ: number;
  targetR: number;
  settlementName: string;
}

// A charter is only founded where the hero can plausibly walk soon — the same
// reach style as the settlement target bands above.
export const CHARTER_TARGET_REACH = 8;

// B3 chartering: the human-parity gate first (the shared evaluator, so the AI
// is held to exactly the purse/warehouse rules a human player is), then the
// best legal target — highest chartered-city production, nearest to the hero,
// then stable record order. Pure and deterministic: no rng is consumed unless
// a name is actually drawn, and the legal target set is the same valid-hex
// rule the client's placement overlay uses.
export function pickCharterAction(
  state: GameState,
  heroId: string,
  map: GameMap,
  rng: () => number,
): CharterAction | null {
  // Settlers mode does not charter (SETTLERS-PLAN.md §4 W5): its founding is a
  // SEPARATE path (settlers/found.ts), reached with the FoundSettlement command
  // by pickSettlersWagonAction's caller -- the charter path's own rules
  // (charter/**) are not rewritten. Returning null here is the ONE place the
  // AI's charter decision is suppressed, so both drivers are covered: the
  // server actor (server/app/aiDriver.ts) and the browser tick of an unflagged
  // legacy game (src/state/turnController.ts). A classic game -- the default
  // mode, and every game created before the feature -- reads exactly as before.
  if (resolveGameMode(state.gameMode) === "settlers") return null;
  if (!evaluateCharterRequirements(state, heroId).canStart) return null;
  const hero = state.heroes[heroId];
  if (!hero) return null;

  const valid = validCharterHexes(state, map, {
    center: hero,
    maxDistance: CHARTER_TARGET_REACH,
  });
  const candidates: Array<{ q: number; r: number; rateSum: number; dist: number }> = [];
  const rMin = Math.max(0, hero.r - CHARTER_TARGET_REACH);
  const rMax = Math.min(map.height - 1, hero.r + CHARTER_TARGET_REACH);
  const qMin = Math.max(0, hero.q - CHARTER_TARGET_REACH);
  const qMax = Math.min(map.width - 1, hero.q + CHARTER_TARGET_REACH);
  for (let r = rMin; r <= rMax; r++) {
    for (let q = qMin; q <= qMax; q++) {
      const dist = hexDistance(hero, { q, r });
      if (dist > CHARTER_TARGET_REACH) continue;
      if (!valid.has(`${q},${r}`)) continue;
      const rates = computeSettlementRates(map, q, r, 1).rates;
      let rateSum = 0;
      for (const resource of RESOURCES) rateSum += rates[resource] ?? 0;
      candidates.push({ q, r, rateSum, dist });
    }
  }
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.rateSum - a.rateSum || a.dist - b.dist || a.q - b.q || a.r - b.r);
  const best = candidates[0];
  return {
    heroId,
    targetQ: best.q,
    targetR: best.r,
    settlementName: generateSettlementName(rng, hero.ownerId),
  };
}

// ── Settlers mode: what a covered wagon decides (SETTLERS-PLAN.md §4 W5) ───
//
// In settlers mode a seat owns no castle and no commander: it owns one covered
// wagon (contracts' coveredWagonIdFor / isCoveredWagonId), and founding a
// settlement is what that wagon is for. Two consequences shape this section:
//
//  1. The RULE is the engine's, not the brain's. Every hex a wagon considers is
//     asked about through canFoundSettlement (settlers/found.ts) -- the same
//     predicate the client's founding gesture gates on -- so the mode's
//     spacing, terrain and occupancy answers stay in one place, the AI can
//     never found where a human could not, and no mode tunable is restated
//     here (the numbers are read from gameModeSettings inside the rule).
//  2. A wagon has NO army, so it may never be ordered into an army-only action:
//     no enemy hero, no garrison assault, no settlement capture, no battle. Its
//     whole decision set is "found on the hex I stand on" and "walk toward the
//     hex I would found on".

/** How far from its own hex a wagon looks for a hex it may found on. */
const FOUNDING_SEARCH_RADIUS = 12;

/**
 * How many of the nearest legal founding hexes are path-probed before the
 * wagon gives up for the turn: a legal hex behind water or off an island is
 * not a destination, and the probe is what keeps "nearest legal" from meaning
 * "unreachable".
 */
const FOUNDING_PATH_ATTEMPTS = 16;

export type SettlersWagonAction =
  | { kind: "found"; heroId: HeroId; q: number; r: number }
  | { kind: "move"; heroId: HeroId; toTile: Axial; cost: number };

/**
 * Whether the engine would let this founder found on (q, r).
 *
 * The founder is relocated in a shallow copy before the predicate is asked:
 * canFoundSettlement refuses a mover that is not standing on the request's hex
 * (`founder_not_at_tile`), and relocating is what lets ONE implementation
 * answer for the hex the wagon would WALK to as well as the one it stands on.
 * Nothing else about the rule is restated here.
 */
function canFoundAt(
  state: GameState,
  heroId: HeroId,
  hero: HeroState,
  q: number,
  r: number,
  map: GameMap,
): boolean {
  const relocated: GameState = { ...state, heroes: { ...state.heroes, [heroId]: { ...hero, q, r } } };
  return canFoundSettlement({ state: relocated, founderId: heroId, q, r, map }).ok;
}

/**
 * The nearest hex this wagon may found on and can actually reach, or null.
 * Deterministic and bounded: FOUNDING_SEARCH_RADIUS around the wagon, ties
 * broken by hex distance, then record order (q, then r), then the first
 * candidate with a path.
 *
 * `obstacles` is the set the caller will STEP with. Passing it matters: probe
 * and step must agree on what is impassable, or a candidate reachable only
 * THROUGH a blocked hex passes here and then fails at `stepToward` -- the wagon
 * wastes the attempt and falls back to wandering (W7 review, L5). Omitted, the
 * probe falls back to the other heroes' hexes alone.
 */
export function pickFoundingHex(
  state: GameState,
  heroId: HeroId,
  map: GameMap,
  obstacles?: ReadonlySet<string>,
): Axial | null {
  const hero = state.heroes[heroId];
  if (!hero) return null;
  const qMin = Math.max(0, hero.q - FOUNDING_SEARCH_RADIUS);
  const qMax = Math.min(map.width - 1, hero.q + FOUNDING_SEARCH_RADIUS);
  const rMin = Math.max(0, hero.r - FOUNDING_SEARCH_RADIUS);
  const rMax = Math.min(map.height - 1, hero.r + FOUNDING_SEARCH_RADIUS);
  const legal: Axial[] = [];
  for (let r = rMin; r <= rMax; r++) {
    for (let q = qMin; q <= qMax; q++) {
      if (hexDistance(hero, { q, r }) > FOUNDING_SEARCH_RADIUS) continue;
      if (!canFoundAt(state, heroId, hero, q, r, map)) continue;
      legal.push({ q, r });
    }
  }
  if (legal.length === 0) return null;
  legal.sort((a, b) => hexDistance(hero, a) - hexDistance(hero, b) || a.q - b.q || a.r - b.r);
  const occupied = new Set<string>(obstacles ?? []);
  if (!obstacles) {
    for (const [otherId, other] of Object.entries(state.heroes)) {
      if (otherId !== heroId) occupied.add(`${other.q},${other.r}`);
    }
  }
  for (const candidate of legal.slice(0, FOUNDING_PATH_ATTEMPTS)) {
    if (findPath(map, hero, candidate, occupied).length > 0) return candidate;
  }
  return null;
}

/**
 * The whole decision set of a settlers seat's wagon, taken from the engine's
 * own rules: found where it stands when the engine admits it (no rng draw, so
 * a founding never moves a stream), else one move step toward the hex it would
 * found on -- and, when no hex it may found on is reachable from here, the same
 * deterministic wander step every other hero's empty target list falls back to
 * (pickAiMove's own last resort, never a military target).
 *
 * Null for anything that is not a wagon (isCoveredWagonId), a wagon that is
 * gone, a wagon with no movement left, and -- through canFoundSettlement's own
 * mode gate -- a wagon in a classic game.
 */
export function pickSettlersWagonAction(
  state: GameState,
  heroId: HeroId,
  map: GameMap,
  rng: () => number,
): SettlersWagonAction | null {
  if (!isCoveredWagonId(heroId)) return null;
  const hero = state.heroes[heroId];
  if (!hero) return null;
  if (canFoundSettlement({ state, founderId: heroId, q: hero.q, r: hero.r, map }).ok) {
    return { kind: "found", heroId, q: hero.q, r: hero.r };
  }
  const move = pickAiMove(state, heroId, map, rng);
  return move ? { kind: "move", heroId, toTile: move.toTile, cost: move.cost } : null;
}

export function pickAiMove(
  state: GameState,
  heroId: string,
  map: GameMap,
  rng: () => number,
  unitTypes: Record<string, UnitType> = {},
  excludedSettlementIds: ReadonlySet<string> = new Set<string>(),
): AiMove | null {
  const hero = state.heroes[heroId];
  if (!hero) return null;
  if (hero.movementRemaining < 1) return null;

  const blocked = new Set<string>();
  const attackerPower = platoonPower(hero.stacks, unitTypes);
  for (const [id, other] of Object.entries(state.heroes)) {
    if (id === heroId) continue;
    blocked.add(`${other.q},${other.r}`);
  }
  for (const [sid, s] of Object.entries(state.settlements)) {
    if (s.ownerId === hero.ownerId) continue;
    // I1 re-attack backoff: an excluded settlement is removed from every
    // target class AND forced back into the path obstacle set — the AI
    // routes around it for the whole backoff window, even a garrison it
    // would otherwise judge beatable.
    if (excludedSettlementIds.has(sid)) {
      blocked.add(`${s.q},${s.r}`);
      continue;
    }
    // Only an unfavourable garrison is a path obstacle: a garrison the AI
    // judges it can beat must stay pathable so the approach can END on the
    // settlement tile (the walk-in gates there turn it into a battle or a
    // capture). Empty garrisons were never blocked.
    if (!attackerBeatsGarrison(attackerPower, s, unitTypes)) {
      blocked.add(`${s.q},${s.r}`);
    }
  }

  // A covered wagon has no army (see the settlers section above): it is never
  // given an army-only target -- no enemy hero, no garrison assault, no walk-in
  // capture -- because every one of those bands ends in a command a wagon
  // cannot legally issue. This is the belt to pickSettlersWagonAction's braces:
  // ANY caller of pickAiMove in a SETTLERS game (the browser tick of an
  // unflagged game included) gets a founding-bound step from a wagon, never an
  // army's errand. Every settlement hex is a path obstacle for a wagon as well,
  // so its route never crosses a town it could not legally do anything about.
  // Both halves of the gate are read here -- the id AND the mode -- exactly as
  // the server's own driver branch does (server/app/aiDriver.ts): an id alone
  // must never divert a mover, so a classic game whose entity happens to be
  // named `p<i>-wagon` takes the ordinary army path (W7 review, M7).
  if (resolveGameMode(state.gameMode) === "settlers" && isCoveredWagonId(heroId)) {
    for (const s of Object.values(state.settlements)) blocked.add(`${s.q},${s.r}`);
    const founding = pickFoundingHex(state, heroId, map, blocked);
    if (founding) {
      const step = stepToward(hero, founding, map, blocked);
      if (step) return step;
    }
    return pickWanderStep(hero, map, rng, blocked);
  }

  const targets: Target[] = [];
  const enemyReach = aiTargetReachForMap(ENEMY_REACH, map);
  const settlementReach = aiSettlementReachForMap(map);

  for (const [otherId, otherHero] of Object.entries(state.heroes)) {
    if (otherId === heroId) continue;
    if (otherHero.ownerId === hero.ownerId) continue;
    if (platoonTroopTotal(otherHero.stacks) === 0) continue;
    const dist = hexDistance(hero, otherHero);
    if (dist > enemyReach) continue;
    targets.push({
      kind: "enemy",
      tile: { q: otherHero.q, r: otherHero.r },
      priority: Math.max(710, 1000 - dist * 10),
    });
  }

  for (const [sid, s] of Object.entries(state.settlements)) {
    if (s.ownerId === hero.ownerId) continue;
    if (excludedSettlementIds.has(sid)) continue;
    const dist = hexDistance(hero, s);
    if (dist > settlementReach) continue;
    const tile = { q: s.q, r: s.r };
    if (platoonTroopTotal(settlementStacks(s)) > 0) {
      if (!attackerBeatsGarrison(attackerPower, s, unitTypes)) continue;
      targets.push({
        kind: "garrisoned_settlement",
        tile,
        priority: Math.max(360, GARRISONED_SETTLEMENT_PRIORITY - dist * SETTLEMENT_PRIORITY_DECAY),
      });
    } else if (s.ownerId !== null) {
      targets.push({
        kind: "enemy_settlement",
        tile,
        priority: Math.max(340, ENEMY_SETTLEMENT_PRIORITY - dist * SETTLEMENT_PRIORITY_DECAY),
      });
    } else {
      targets.push({
        kind: "neutral_settlement",
        tile,
        priority: Math.max(320, NEUTRAL_SETTLEMENT_PRIORITY - dist * SETTLEMENT_PRIORITY_DECAY),
      });
    }
  }

  const settlements = Object.values(state.settlements);
  const rMin = Math.max(0, hero.r - RESOURCE_REACH);
  const rMax = Math.min(map.height - 1, hero.r + RESOURCE_REACH);
  const qMin = Math.max(0, hero.q - RESOURCE_REACH);
  const qMax = Math.min(map.width - 1, hero.q + RESOURCE_REACH);
  for (let r = rMin; r <= rMax; r++) {
    for (let q = qMin; q <= qMax; q++) {
      if (!map.resourceTileAt(q, r)) continue;
      const dist = hexDistance(hero, { q, r });
      if (dist > RESOURCE_REACH) continue;
      let nearOwnedSettlement = false;
      for (const s of settlements) {
        if (s.ownerId === null) continue;
        if (hexDistance(s, { q, r }) <= SETTLEMENT_RESOURCE_BUFFER) {
          nearOwnedSettlement = true;
          break;
        }
      }
      if (nearOwnedSettlement) continue;
      targets.push({ kind: "resource", tile: { q, r }, priority: 300 - dist * 3 });
    }
  }

  targets.sort((a, b) => b.priority - a.priority);

  for (const target of targets) {
    const step =
      target.kind === "enemy"
        ? stepTowardEnemy(hero, target.tile, map, blocked)
        : stepToward(hero, target.tile, map, blocked);
    if (step) return step;
  }

  return pickWanderStep(hero, map, rng, blocked);
}

function firstStepCost(hero: HeroState, map: GameMap, firstStep: Axial): AiMove | null {
  const cost = map.cost(firstStep.q, firstStep.r);
  if (!Number.isFinite(cost) || cost <= 0) return null;
  if (cost > hero.movementRemaining) return null;
  return { toTile: firstStep, cost };
}

function stepToward(hero: HeroState, dest: Axial, map: GameMap, blocked?: Set<string>): AiMove | null {
  // findPath() omits the start node: path[0] is the FIRST hex step, the
  // destination is last.
  const path = findPath(map, hero, dest, blocked);
  if (path.length === 0) return null;
  return firstStepCost(hero, map, path[0]);
}

// The engine forbids moving onto any hero, and a battle only ever starts
// from the post-move detectAdjacentEnemy() check (same as the human attack
// flow). So an enemy target must resolve to a step that ends BESIDE the
// enemy: while approaching, that is the natural first path step; from an
// already-adjacent hex the hero repositions to another free tile beside the
// enemy so the move succeeds and the adjacency check fires, instead of the
// move being rejected as "occupied". The enemy's own tile must stay a legal
// A* goal, so it is un-blocked for the approach path only.
function stepTowardEnemy(hero: HeroState, dest: Axial, map: GameMap, blocked: Set<string>): AiMove | null {
  const approachBlocked = new Set(blocked);
  approachBlocked.delete(`${dest.q},${dest.r}`);
  const path = findPath(map, hero, dest, approachBlocked);
  if (path.length === 0) return null;
  const firstStep = path[0];
  if (firstStep.q === dest.q && firstStep.r === dest.r) {
    for (const dir of NEIGHBOR_DIRS) {
      const nq = dest.q + dir.q;
      const nr = dest.r + dir.r;
      if (nq === hero.q && nr === hero.r) continue;
      if (blocked.has(`${nq},${nr}`)) continue;
      const step = stepToward(hero, { q: nq, r: nr }, map, blocked);
      if (step) return step;
    }
    return null;
  }
  return firstStepCost(hero, map, firstStep);
}

const WANDER_RADIUS = 12;

function pickWanderStep(
  hero: HeroState,
  map: GameMap,
  rng: () => number,
  blocked: Set<string>,
): AiMove | null {
  const qMin = Math.max(0, hero.q - WANDER_RADIUS);
  const qMax = Math.min(map.width - 1, hero.q + WANDER_RADIUS);
  const rMin = Math.max(0, hero.r - WANDER_RADIUS);
  const rMax = Math.min(map.height - 1, hero.r + WANDER_RADIUS);
  const spanQ = qMax - qMin + 1;
  const spanR = rMax - rMin + 1;
  for (let tries = 0; tries < 20; tries++) {
    const q = qMin + Math.floor(rng() * spanQ);
    const r = rMin + Math.floor(rng() * spanR);
    if (!map.isPassable(q, r)) continue;
    if (q === hero.q && r === hero.r) continue;
    const step = stepToward(hero, { q, r }, map, blocked);
    if (step) return step;
  }
  return null;
}
