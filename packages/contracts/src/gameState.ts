import type { BuildingKind } from "./buildings";
import type { FactionId } from "./factions";
import type { CharterId, Faction, HeroId, HorseVariantId, PlayerId, SettlementId } from "./ids";
import type { ResourceType, Warehouse, WarehouseResource } from "./resources";
import type { CharterState, SettlementState } from "./settlement";
import type { Platoon } from "./units";

export const MOVEMENT_PER_TURN = 7;

// A hero's known spell (v1: exactly one per hero — see
// docs/spellcasting-plan.md and the battle-updates roadmap §"Spellcasting
// v1"). The spell definitions themselves (cost, magnitude, targeting) live
// in @heroes/engine's combat/spells.ts; this union is just the id
// vocabulary the persisted HeroState carries across the wire.
export type SpellId = "magic_arrow" | "bless";

export interface Player {
  id: PlayerId;
  faction: Faction;
  name: string;
  color: string;
  heroIds: HeroId[];
  settlementIds: SettlementId[];
  // ── Roster faction (faction-registry foundation) ──
  // The seat's playable faction — deliberately NOT the `faction` above,
  // which is the player|ai turn machinery. Optional so legacy JSONB rows
  // stay valid; absent reads as "human" (engine playerFactionId).
  factionId?: FactionId;
  // Persistent per-player reveal ("uncharted mode"): the sorted union of every
  // tile this seat has ever seen (hero ring radius 4 + owned settlement
  // controlRange). Optional so legacy saves stay valid; absent = empty = the
  // normal all-revealed (fog-only) mode.
  revealedTiles?: readonly string[];
  // ── Wagon pool (docs/wagons-stockpiles-trade-routes-plan.md §5.1) ──
  // Optional + helper-accessed so legacy saves and old JSONB rows stay
  // valid; new wagons default via DEFAULT_HERO_WAGONS/player helpers.
  wagonsOwned?: number;
  wagonsUnassigned?: number;
  // Treasury-cart pool (Phase 1 treasury-wagons split): the gold-carrying
  // slot's own pool, mirroring the cargo pool above field-for-field.
  // Optional + helper-accessed (playerTreasuryWagonsOwned/Unassigned) so
  // legacy saves stay valid; starting players carry 5/0.
  treasuryWagonsOwned?: number;
  treasuryWagonsUnassigned?: number;
}

export interface HeroState {
  id: HeroId;
  name: string;
  ownerId: PlayerId;
  q: number;
  r: number;
  movementRemaining: number;
  previousQ: number | null;
  previousR: number | null;
  previousMovementRemaining: number | null;
  // Retreat stun (plan/2026-10-21-battle-retreat-rules.md): the hero gets no
  // movement on any day up to and including this one. Absent = no stun. Set
  // by a battle retreat to the retreat day + 1; resetHeroMovement grants 0
  // while it holds and drops the field once the day has passed.
  movementLockedThroughDay?: number;
  trail: { q: number; r: number }[];
  gold: number;
  troops: number;
  stacks: Platoon[];
  isChartering: boolean;
  charterId: CharterId | null;
  horseVariant: HorseVariantId;
  // ── Spellcasting v1 (docs/spellcasting-plan.md) ──
  // Spell power and mana-pool stats. v1 ships fixed starting values
  // (DEFAULT_HERO_ARCANE / DEFAULT_HERO_INTELLIGENCE in engine
  // combatConfig.ts); leveling/progression is explicitly later.
  arcane: number;
  intelligence: number;
  // Persistent hero-level mana pool. heroMaxMana = intelligence *
  // MANA_PER_INTELLIGENCE; refills fully on the overworld day tick
  // (engine turn/round.ts's advanceRound). Casting spends mana; mana is
  // the only cast limiter.
  heroMana: number;
  heroMaxMana: number;
  // The one spell this hero knows (null = spellcaster-less hero; v1 seeds
  // every hero with "magic_arrow").
  heroSpell: SpellId | null;
  // ── Upkeep shortfall (weekly upkeep pass) ──
  /** 0..100, the hero-side morale analogue of SettlementState.morale. 100 = content. */
  morale: number;
  /**
   * Calendar day of the FIRST weekly upkeep charge this hero could not pay.
   * null means paid up; it is never reset downward while a shortfall runs, so
   * a long-unfed hero accumulates a visible streak.
   */
  upkeepUnpaidSinceDay: number | null;
  /** How many troops are currently unfed (unpaid gold, or no food). */
  upkeepUnpaidTroops: number;
  /** The weekly gold cost attributable to those unfed troops (the deficit magnitude). */
  upkeepUnpaidGold: number;
  // ── Wagons & cargo (docs/wagons-stockpiles-trade-routes-plan.md §4.2/§5.1) ──
  // Optional + helper-accessed (heroWagons/heroCargo) so legacy saves stay
  // valid; DEFAULT_HERO_WAGONS applies when absent. `wagons` governs the
  // RESOURCE cargo cap only (heroResourceCap).
  wagons?: number;
  // Treasury carts (Phase 1 treasury-wagons split): the gold-purse slot,
  // deliberately NOT shared with army wagons ("the hero can carry more gold
  // if they have treasury carts on their person (they get their own slot,
  // not shared with army slots)"). Optional + helper-accessed
  // (heroTreasuryWagons) so legacy saves stay valid; DEFAULT_TREASURY_WAGONS
  // (5) applies when absent, preserving the 5-cart <-> 2,500g-charter
  // pairing for every pre-split hero.
  treasuryWagons?: number;
  resources?: Warehouse;
}

export type GamePhase =
  | { kind: "PLAYER_TURN"; playerId: PlayerId }
  | { kind: "AI_TURN"; playerId: PlayerId }
  // Never persisted as a phase, but re-derived at hydrate from
  // games.lobby.pendingBattle when a server-offered battle awaits its
  // defender (BattleOffered).
  | { kind: "BATTLE"; attackerId: HeroId; defenderId: HeroId }
  // Client-only (never persisted as a phase, like BATTLE): a manual
  // settlement-garrison battle in flight; the server never persists this
  // phase.
  | { kind: "SETTLEMENT_BATTLE"; attackerId: HeroId; settlementId: SettlementId }
  | { kind: "ROUND_END"; nextRound: number };

/** docs/wagons-stockpiles-trade-routes-plan.md §5.2 — physical caravan cycle state. */
export interface CaravanState {
  phase: "toDestination" | "toHome";
  cargo: number;
  /** Remaining path, next tile first. */
  path: { q: number; r: number }[];
  /** Tiles of `path` already consumed this leg; the caravan occupies path[pathIndex - 1] (or the origin settlement at 0). */
  pathIndex: number;
  /**
   * True when path[0] is an ANCHOR tile (the caravan's own tile at repath
   * time) rather than the first unconsumed step, so progress math can skip it.
   * Absent (legacy/initial outbound paths) means path[0] is the first step.
   */
  anchored?: boolean;
}

export type TradeRouteId = string;

/**
 * One end of a trade route: a settlement or a hero. Settlement ids and hero
 * ids are disjoint namespaces (`s{n}` / `h{n}`), so `kind` is the only
 * discriminator a route ever needs. Heroes move and can die; the endpoint is
 * an id, never a position -- resolvers (engine `endpointTile`/`endpointOwner`)
 * read the live position/owner per use.
 */
export type TradeRouteEndpoint =
  | { kind: "settlement"; id: SettlementId }
  | { kind: "hero"; id: HeroId };

/**
 * What a route's caravan carries. "resource" is a cargo caravan hauling one
 * non-gold warehouse resource; "gold" is a treasure caravan hauling gold.
 * `CaravanState.cargo` holds units-of-resource for the former and gold for
 * the latter -- one number field, two units, discriminated here.
 */
export type TradeRoutePayload =
  | { kind: "resource"; resource: WarehouseResource }
  | { kind: "gold" };

/**
 * One trade route: a same-owner endpoint pair (settlement or hero, any
 * direction), one payload (a warehouse resource for a cargo caravan, gold
 * for a treasure caravan), a wagon count drawn from the player's unassigned
 * pool, and its physical caravan.
 */
export interface TradeRouteState {
  id: TradeRouteId;
  from: TradeRouteEndpoint;
  to: TradeRouteEndpoint;
  payload: TradeRoutePayload;
  wagons: number;
  /** null while the caravan is at the origin, loading. */
  caravan: CaravanState | null;
  /**
   * The seat that created and owns the route (stamped at creation, replayed
   * from TradeRouteCreated's actor, backfilled at hydration from the raw row
   * then the FROM then the TO endpoint's owner). Optional so legacy JSONB
   * rows stay valid; absent reads as the FROM endpoint's live owner. Removal
   * and the daily advance gate on this field first so a route stays its true
   * owner's property — and removable by them — even when the origin endpoint
   * dies or is captured.
   */
  ownerId?: PlayerId | null;
  /**
   * Day of the first unpaid weekly maintenance charge (caravanUpkeep);
   * null/absent = paid up. Optional so legacy JSONB rows stay valid.
   */
  unpaidSinceDay?: number | null;
}

export type WorkerTransitId = string;

/**
 * A Construction Worker walking ALONE (not merged into a hero's stack)
 * between two settlements (faction-construction plan, section 6). Mirrors
 * CaravanState's shape deliberately (`path`/`pathIndex`) -- see that type's
 * own comment above -- rather than reusing it directly: a lone worker has
 * no cargo, carries exactly one unit, and optionally halves its own speed
 * to pave the road behind it (section 7), none of which fit CaravanState's
 * fields cleanly. The pure movement/ambush-eligibility logic lives in
 * @heroes/engine's settlement/workerTransit.ts, which imports this shape
 * rather than redeclaring it (contracts is the zero-dependency leaf).
 */
export interface WorkerTransitState {
  id: WorkerTransitId;
  ownerId: PlayerId;
  factionId: FactionId;
  unitTypeId: string;
  originSettlementId: SettlementId;
  destinationSettlementId: SettlementId;
  /** Remaining path, next tile first (findPath's own convention). */
  path: { q: number; r: number }[];
  /** Tiles of `path` already consumed. The worker occupies path[pathIndex - 1] (or the origin settlement at 0). */
  pathIndex: number;
  /** "Build roads along the way" toggle for this trip: costs ROAD_BUILD_GOLD_COST_PER_TILE gold per tile and halves movement speed while active. */
  buildRoads: boolean;
}

export interface GameState {
  round: number;
  day: number;
  activePlayerId: PlayerId;
  players: Player[];
  heroes: Record<HeroId, HeroState>;
  settlements: Record<SettlementId, SettlementState>;
  phase: GamePhase;
  selectedHeroId: HeroId | null;
  selectedSettlementId: SettlementId | null;
  dirty: boolean;
  castleSeed: number;
  castleCount: number;
  activeCharters: CharterState[];
  nextCharterId: number;
  nextSettlementId: number;
  /** Optional + defaulted ([]) so legacy saves and old JSONB rows stay valid. */
  tradeRoutes?: TradeRouteState[];
  nextTradeRouteId?: number;
  /** Optional + defaulted ([]) so legacy saves and old JSONB rows stay valid (section 6). */
  workerTransits?: WorkerTransitState[];
  nextWorkerTransitId?: number;
  /**
   * Road-building side action (faction-construction plan, section 7):
   * sorted "q,r" keys of every tile a Construction Worker has paved.
   * Read by map/pathfinding.ts's findPath/computePathCost (ROAD_COST_MULTIPLIER)
   * as an optional ReadonlySet -- absent/empty is "no roads", backward
   * compatible with every existing caller. This field and
   * settlement/workerTransit.ts's WorkerTransitState are the engine-only
   * data model this PR ships for sections 6/7; neither is wired into a
   * command, event, or server persistence path yet (see that module's
   * header comment for the scoping rationale).
   */
  roadedTiles?: readonly string[];
}

export interface CalendarParts {
  week: number;
  dayOfWeek: number;
  month: number;
  dayOfMonth: number;
}

export interface InitialStateOptions {
  seedPlayers?: Player[];
  seedHeroes?: HeroState[];
  seedSettlements?: SettlementState[];
  seedRound?: number;
  seedActivePlayerId?: PlayerId;
  seedCastleSeed?: number;
  seedCastleCount?: number;
}

export type StartMoveResult =
  | { state: GameState; ok: true }
  | { state: GameState; ok: false; reason: string };

export interface ReorderResult {
  state: GameState;
  ok: boolean;
  reason: string;
}

export interface CaptureResult {
  state: GameState;
  captured: boolean;
  previousOwnerId: PlayerId | null;
}

export interface AutoTradeTransfer {
  fromSettlementId: SettlementId;
  toSettlementId: SettlementId;
  resource: WarehouseResource;
  amount: number;
  goldPaid: number;
}

export interface ApplyEndOfTurnResult {
  state: GameState;
  transfers: AutoTradeTransfer[];
}

export type TransferDirection = "deposit" | "withdraw";

export interface TransferResult {
  state: GameState;
  ok: boolean;
  reason: string;
}

export interface RecruitHeroResult {
  state: GameState;
  hero?: HeroState;
  error?: string;
}

export interface StartCharterPayload {
  heroId: HeroId;
  targetQ: number;
  targetR: number;
  settlementName: string;
  settlementId: SettlementId;
  charterId: CharterId;
  resourceRates: Partial<Record<ResourceType, number>>;
  foundedOnResource: ResourceType | null;
  citySpots: Array<{ cell: { x: number; y: number }; resource: ResourceType; vein: string }>;
}

export type StartCharterResult =
  | { state: GameState; ok: true }
  | { state: GameState; ok: false; reason: string };

export type StepTravelResult =
  | { state: GameState; ok: true }
  | { state: GameState; ok: false; reason: string };

export type StartUpgradeResult =
  | { state: GameState; ok: true }
  | { state: GameState; ok: false; reason: string };

export interface BuildingUpgradeRequest {
  gx: number;
  gy: number;
  kind: BuildingKind;
  district?: { q: number; r: number };
}
