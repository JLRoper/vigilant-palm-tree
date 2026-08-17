import type {
  GameState,
  HeroId,
  HeroState,
  Player,
  SettlementState,
} from "@heroes/contracts";
import { WAREHOUSE_RESOURCES } from "@heroes/contracts";
import { defaultPopulation, SETTLEMENT_GOLD_TAX } from "./economy/settlementRates";
import { VALID_HORSE_VARIANTS } from "./horseVariants";
import { normalizePlatoons } from "./units";

export const CASTLE_COUNT_MIN = 4;
export const CASTLE_COUNT_MAX = 15;
export const CASTLE_COUNT_DEFAULT = 6;

export function defaultCastleSeedFromMapSeed(mapSeed: number): number {
  return ((mapSeed ^ 0x63617374) >>> 0) || 1;
}

export interface HydrateOptions {
  castleSeed?: number;
  castleCount?: number;
}

// Structural subset of a loaded game row that hydrateGameState needs. Kept
// deliberately narrower than src/io/api.ts's `Game` type (which this engine
// package cannot import -- engine-depends-on-contracts-only) so any caller
// with a `Game`-shaped value can pass it straight through.
export interface HydratableGameRow {
  name?: string;
  seed: number;
  round: number;
  day?: number;
  active_player_id: number;
  players: Player[];
  heroes: Record<string, HeroState>;
  settlements: Record<string, SettlementState>;
  // Additive, same as day above -- needed for server/app/commandHandler.ts's
  // StartCharter case to reconstruct an identical GameMap (map_size) and to
  // allocate collision-free charterId/settlementId values
  // (next_charter_id/next_settlement_id; see
  // server/migrations/009_granular_entities.sql). Optional so callers that
  // predate this (mocks, older rows) still satisfy the type.
  map_size?: string;
  next_charter_id?: number;
  next_settlement_id?: number;
}

function warnMissing(path: string, field: string): void {
  console.warn(`[hydrateGameState] ${path} missing "${field}"; using default`);
}

function backfillHero(h: Partial<HeroState> & { id: HeroId; ownerId: number; q: number; r: number }): HeroState {
  const variantIds = VALID_HORSE_VARIANTS;
  const path = `heroes.${h.id}`;
  if (h.movementRemaining === undefined) warnMissing(path, "movementRemaining");
  if (h.gold === undefined) warnMissing(path, "gold");
  if (h.troops === undefined) warnMissing(path, "troops");
  if (h.stacks === undefined) warnMissing(path, "stacks");
  if (h.horseVariant === undefined) warnMissing(path, "horseVariant");
  return {
    movementRemaining: h.movementRemaining ?? 7,
    previousQ: h.previousQ ?? null,
    previousR: h.previousR ?? null,
    previousMovementRemaining: h.previousMovementRemaining ?? null,
    trail: h.trail ?? [{ q: h.q, r: h.r }],
    gold: h.gold ?? 0,
    troops: h.troops ?? 1,
    stacks: normalizePlatoons(h.stacks),
    isChartering: h.isChartering ?? false,
    charterId: h.charterId ?? null,
    id: h.id,
    name: h.name ?? h.id,
    ownerId: h.ownerId,
    q: h.q,
    r: h.r,
    horseVariant: h.horseVariant ?? variantIds[0],
  };
}

function emptyWarehouse(): SettlementState["warehouse"] {
  return { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 };
}

function backfillSettlement(s: Partial<SettlementState> & { id: string; q: number; r: number; level: 1 | 2 | 3 }): SettlementState {
  const path = `settlements.${s.id}`;
  if (s.warehouse === undefined) {
    warnMissing(path, "warehouse");
  } else {
    for (const res of WAREHOUSE_RESOURCES) {
      if (s.warehouse[res] === undefined) warnMissing(`${path}.warehouse`, res);
    }
  }
  if (s.population === undefined) warnMissing(path, "population");
  if (s.goldTax === undefined) warnMissing(path, "goldTax");
  if (s.morale === undefined) warnMissing(path, "morale");
  if (s.autoTrade === undefined) warnMissing(path, "autoTrade");
  if (s.castleVariant === undefined) warnMissing(path, "castleVariant");
  if (s.buildings === undefined) warnMissing(path, "buildings");
  const warehouse = s.warehouse ?? emptyWarehouse();
  const filledWarehouse: SettlementState["warehouse"] = {
    wood: warehouse.wood ?? 0,
    stone: warehouse.stone ?? 0,
    iron: warehouse.iron ?? 0,
    arcane: warehouse.arcane ?? 0,
    food: warehouse.food ?? 0,
  };
  return {
    name: s.name ?? s.id,
    ownerId: s.ownerId ?? null,
    population: s.population ?? defaultPopulation(s.level),
    goldTax: s.goldTax ?? SETTLEMENT_GOLD_TAX[s.level],
    resourceRates: s.resourceRates ?? {},
    foundedOnResource: s.foundedOnResource ?? null,
    gold: s.gold ?? 0,
    warehouse: filledWarehouse,
    citySpots: s.citySpots ?? [],
    cityMines: s.cityMines ?? [],
    morale: s.morale ?? 100,
    autoTrade: s.autoTrade ?? true,
    q: s.q,
    r: s.r,
    level: s.level,
    id: s.id,
    castleVariant: s.castleVariant ?? 0,
    buildings: s.buildings ?? [],
    upgrade: s.upgrade ?? undefined,
  };
}

export function hydrateGameState(
  row: HydratableGameRow,
  opts?: HydrateOptions,
): GameState {
  if (row.day === undefined) warnMissing(row.name ? `games.${row.name}` : "game", "day");
  const settlementsRecord: Record<string, SettlementState> = {};
  for (const [id, raw] of Object.entries(row.settlements)) {
    settlementsRecord[id] = backfillSettlement({ ...raw, id });
  }
  const heroesRecord: Record<HeroId, HeroState> = {};
  for (const [id, raw] of Object.entries(row.heroes)) {
    heroesRecord[id] = backfillHero({
      ...raw,
      id,
      ownerId: raw.ownerId,
      q: raw.q,
      r: raw.r,
    });
  }
  const settlementCount = Object.keys(settlementsRecord).length;
  return {
    round: row.round,
    day: row.day ?? row.round,
    activePlayerId: row.active_player_id,
    players: row.players,
    heroes: heroesRecord,
    settlements: settlementsRecord,
    phase:
      row.players.find((p) => p.id === row.active_player_id)?.faction === "ai"
        ? { kind: "AI_TURN", playerId: row.active_player_id }
        : { kind: "PLAYER_TURN", playerId: row.active_player_id },
    selectedHeroId: null,
    selectedSettlementId: null,
    dirty: false,
    castleSeed: opts?.castleSeed ?? defaultCastleSeedFromMapSeed(row.seed),
    castleCount: opts?.castleCount ?? CASTLE_COUNT_DEFAULT,
    activeCharters: (row as unknown as { activeCharters?: GameState["activeCharters"] }).activeCharters ?? [],
    nextCharterId: row.next_charter_id ?? 0,
    // Math.max, not a plain `??`: a row created before this counter was
    // wired (every row's next_settlement_id defaults to 0 via that
    // migration's ADD COLUMN) must not re-collide with settlements that
    // already existed at game creation -- settlementCount is the same
    // safe floor this field relied on entirely before this counter was
    // persisted anywhere. Once next_settlement_id is genuinely being
    // incremented by StartCharter, it's always >= settlementCount anyway
    // (a completed charter's settlement is already counted in both), so
    // this never diverges from a plain read in the steady state.
    nextSettlementId: Math.max(row.next_settlement_id ?? 0, settlementCount),
  };
}
