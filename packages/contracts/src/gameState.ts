import type { BuildingKind } from "./buildings";
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
  | { kind: "BATTLE"; attackerId: HeroId; defenderId: HeroId }
  // Client-only (like BATTLE): a manual settlement-garrison battle in
  // flight; the server never persists this phase.
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
   * Day of the first unpaid weekly maintenance charge (caravanUpkeep);
   * null/absent = paid up. Optional so legacy JSONB rows stay valid.
   */
  unpaidSinceDay?: number | null;
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
}
