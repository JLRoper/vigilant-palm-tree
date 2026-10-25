import { Axial, isCoveredWagonId, resolveGameMode } from "@heroes/contracts";
import { findPath, NEIGHBOR_DIRS, hexDistance } from "../map/pathfinding";
import { GameMap } from "../map/gameMap";
import type { BuildingDef, BuildingKind, FactionId, GameState, HeroId, HeroState, SettlementState } from "@heroes/contracts";
import {
  platoonPower,
  platoonTroopTotal,
  settlementStacks,
  unitPower,
  type UnitType,
} from "../units";
import {
  depositIntoGarrison,
  eligibleRecruitSources,
  type RecruitSource,
} from "../settlement/recruitUnits";
import { buildingDraftMax } from "../buildingRegistry";
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
const SETTLEMENT_REACH = 8;
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
  const settlementReach = aiTargetReachForMap(SETTLEMENT_REACH, map);

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
