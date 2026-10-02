import type {
  CaravanState,
  GameState,
  HeroId,
  HeroState,
  Player,
  SettlementState,
  TradeRouteEndpoint,
  TradeRoutePayload,
  TradeRouteState,
  WarehouseResource,
} from "@heroes/contracts";
import { WAREHOUSE_RESOURCES } from "@heroes/contracts";
import { defaultPopulation, SETTLEMENT_GOLD_TAX } from "./economy/settlementRates";
import { VALID_HORSE_VARIANTS } from "./horseVariants";
import { normalizePlatoons } from "./units";
import { withDefaultSpellStats } from "./combat/spells";

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
  /**
   * games.trade_routes JSONB (docs/wagons-stockpiles-trade-routes-plan.md
   * §5.2). Deliberately untyped: rows written before the endpoint/payload
   * model carry the legacy flat shape (`fromSettlementId`/`toSettlementId`/
   * `resource`), so normalizeTradeRoute below decides each record's
   * generation at read time.
   */
  trade_routes?: readonly unknown[] | null;
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
  return withDefaultSpellStats({
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
    arcane: h.arcane,
    intelligence: h.intelligence,
    heroMana: h.heroMana,
    heroMaxMana: h.heroMaxMana,
    heroSpell: h.heroSpell,
    // Upkeep shortfall (weekly upkeep pass): absent on every pre-migration
    // row, so each field is defaulted defensively rather than warned about --
    // they're brand new, not a legacy save losing real state.
    morale: h.morale ?? 100,
    upkeepUnpaidSinceDay: h.upkeepUnpaidSinceDay ?? null,
    upkeepUnpaidTroops: h.upkeepUnpaidTroops ?? 0,
    upkeepUnpaidGold: h.upkeepUnpaidGold ?? 0,
    // Wagons & cargo (Phase 1 treasury-wagons split): backfillHero used to
    // rebuild from an explicit field list that OMITTED wagons/resources, so
    // a persisted `wagons: 3` silently re-defaulted to 5 and real cargo read
    // as all-zero on BOTH read paths (legacy JSONB directly, and granular
    // via server/persistence/hydrate.ts passing heroRepo-loaded heroes back
    // through here) -- the data-loss bug the Phase 1a fixture pass found.
    // Conditional spread keeps an absent optional field absent (the
    // settlementRepo discipline): absence is meaningful (heroWagons/
    // heroTreasuryWagons soft-default it, and heroRepo round-trips it as a
    // NULL treasury_wagons), so it must not be materialized here.
    ...(h.wagons !== undefined ? { wagons: h.wagons } : {}),
    ...(h.treasuryWagons !== undefined ? { treasuryWagons: h.treasuryWagons } : {}),
    ...(h.resources !== undefined ? { resources: h.resources } : {}),
    id: h.id,
    name: h.name ?? h.id,
    ownerId: h.ownerId,
    q: h.q,
    r: h.r,
    horseVariant: h.horseVariant ?? variantIds[0],
  });
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
    // Garrison upkeep shortfall, same defaulting rationale as the hero
    // fields above.
    garrisonUnpaidSinceDay: s.garrisonUnpaidSinceDay ?? null,
    garrisonUnpaidTroops: s.garrisonUnpaidTroops ?? 0,
    garrisonUnpaidGold: s.garrisonUnpaidGold ?? 0,
    autoTrade: s.autoTrade ?? true,
    q: s.q,
    r: s.r,
    level: s.level,
    id: s.id,
    castleVariant: s.castleVariant ?? 0,
    buildings: s.buildings ?? [],
    upgrade: s.upgrade ?? undefined,
    // Garrison passthrough (unit-recruitment/garrison plan task 7): rows
    // written after garrisons existed carry stacks directly in the JSONB;
    // normalize them so the fallback path matches settlementRepo's granular
    // assembly. Absent stays absent -- readers go through settlementStacks(),
    // which treats undefined as 8 empty platoons.
    ...(s.stacks !== undefined ? { stacks: normalizePlatoons(s.stacks) } : {}),
  };
}

// ---- Trade routes: two persisted generations, one normalizer ---------------

/** Runtime endpoint-shape guard for the current (endpoint/payload) generation. Exported for applyEvent's event-row normalization, which validates the same discriminated shapes. */
export function isTradeRouteEndpoint(v: unknown): v is TradeRouteEndpoint {
  if (!v || typeof v !== "object") return false;
  const e = v as { kind?: unknown; id?: unknown };
  return (e.kind === "settlement" || e.kind === "hero") && typeof e.id === "string" && e.id.length > 0;
}

/** Runtime payload-shape guard (see isTradeRouteEndpoint). */
export function isTradeRoutePayload(v: unknown): v is TradeRoutePayload {
  if (!v || typeof v !== "object") return false;
  const p = v as { kind?: unknown; resource?: unknown };
  if (p.kind === "gold") return true;
  return (
    p.kind === "resource" &&
    typeof p.resource === "string" &&
    WAREHOUSE_RESOURCES.includes(p.resource as (typeof WAREHOUSE_RESOURCES)[number])
  );
}

/**
 * The legacy (pre-endpoint) trade-route shape, as persisted in BOTH the
 * games.trade_routes JSONB and TradeRouteCreated event rows: flat
 * fromSettlementId/toSettlementId/resource fields. Returns the
 * endpoint/payload mapping shared by both legacy generations, or null when
 * the value carries none of the legacy fields.
 */
export function legacyTradeRouteShape(raw: unknown): { from: TradeRouteEndpoint; to: TradeRouteEndpoint; payload: TradeRoutePayload } | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { fromSettlementId?: unknown; toSettlementId?: unknown; resource?: unknown };
  if (typeof r.fromSettlementId !== "string" || typeof r.toSettlementId !== "string") return null;
  const resource = r.resource;
  if (typeof resource !== "string" || !WAREHOUSE_RESOURCES.includes(resource as (typeof WAREHOUSE_RESOURCES)[number])) {
    return null;
  }
  return {
    from: { kind: "settlement", id: r.fromSettlementId },
    to: { kind: "settlement", id: r.toSettlementId },
    payload: { kind: "resource", resource: resource as WarehouseResource },
  };
}

function isCaravanState(v: unknown): v is CaravanState {
  if (!v || typeof v !== "object") return false;
  const c = v as { phase?: unknown; cargo?: unknown; path?: unknown; pathIndex?: unknown };
  if (c.phase !== "toDestination" && c.phase !== "toHome") return false;
  if (typeof c.cargo !== "number" || !Number.isFinite(c.cargo)) return false;
  if (!Array.isArray(c.path) || !c.path.every((t) => {
    if (!t || typeof t !== "object") return false;
    const axial = t as { q?: unknown; r?: unknown };
    return typeof axial.q === "number" && typeof axial.r === "number";
  })) return false;
  return typeof c.pathIndex === "number" && Number.isInteger(c.pathIndex) && c.pathIndex >= 0;
}

/**
 * Normalizes one persisted trade-route record of either generation into the
 * current endpoint/payload shape. The legacy mapping is shape-only --
 * advancing, loading and delivering behave identically post-normalization.
 * A record recognizable as neither generation (or carrying a malformed
 * caravan/wagon count) is dropped with a warning: it could not advance
 * safely, and keeping it would crash the daily tick instead.
 */
export function normalizeTradeRoute(raw: unknown): TradeRouteState | null {
  if (!raw || typeof raw !== "object") {
    console.warn("[hydrateGameState] dropping unparseable trade route");
    return null;
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || r.id.length === 0) {
    console.warn("[hydrateGameState] dropping trade route without an id");
    return null;
  }
  const parts = isTradeRouteEndpoint(r.from) && isTradeRouteEndpoint(r.to) && isTradeRoutePayload(r.payload)
    ? { from: r.from, to: r.to, payload: r.payload }
    : legacyTradeRouteShape(r);
  if (!parts) {
    console.warn(`[hydrateGameState] dropping trade route ${r.id}: neither endpoint nor legacy shape`);
    return null;
  }
  if (typeof r.wagons !== "number" || !Number.isInteger(r.wagons) || r.wagons < 0) {
    console.warn(`[hydrateGameState] dropping trade route ${r.id}: malformed wagon count`);
    return null;
  }
  if (r.caravan !== null && r.caravan !== undefined && !isCaravanState(r.caravan)) {
    console.warn(`[hydrateGameState] dropping trade route ${r.id}: malformed caravan`);
    return null;
  }
  // The maintenance streak rides the same JSONB as the rest of the route:
  // absent stays absent (pre-maintenance rows), null is paid-up, a finite
  // number passes through, anything else is treated as absent rather than
  // dropping an otherwise-valid route over one bookkeeping field.
  const unpaidSinceDay =
    typeof r.unpaidSinceDay === "number" && Number.isFinite(r.unpaidSinceDay)
      ? r.unpaidSinceDay
      : r.unpaidSinceDay === null
        ? null
        : undefined;
  return {
    id: r.id,
    from: parts.from,
    to: parts.to,
    payload: parts.payload,
    wagons: r.wagons,
    caravan: r.caravan ? r.caravan : null,
    ...(unpaidSinceDay !== undefined ? { unpaidSinceDay } : {}),
  };
}

// nextTradeRouteId is not a persisted column; it is derived here from the
// hydrated route ids (the same suffix-parse applyTradeRouteCreated uses) so
// a re-hydrated createTradeRoute command cannot re-derive an id that
// collides with an existing route -- the latent collision bug
// docs/event-system.md documented. Non-"route<n>" ids do not contribute
// (NaN suffixes are skipped), matching the applier's own counter bump.
function deriveNextTradeRouteId(routes: readonly TradeRouteState[]): number {
  return routes.reduce((max, route) => {
    const suffix = Number.parseInt(route.id.replace(/^route/, ""), 10);
    return Number.isNaN(suffix) ? max : Math.max(max, suffix + 1);
  }, 0);
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
  // Trade routes normalize per record (either persisted generation), and
  // the id counter derives from the normalized ids -- see
  // normalizeTradeRoute/deriveNextTradeRouteId above.
  const tradeRoutes = (row.trade_routes ?? []).flatMap((raw) => {
    const normalized = normalizeTradeRoute(raw);
    return normalized ? [normalized] : [];
  });
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
    tradeRoutes,
    activeCharters: (row as unknown as { activeCharters?: GameState["activeCharters"] }).activeCharters ?? [],
    nextCharterId: row.next_charter_id ?? 0,
    // Derived, not persisted (see deriveNextTradeRouteId): hydrated past
    // the highest existing "route<n>" id so a freshly created route can
    // never collide with one already on the board.
    nextTradeRouteId: deriveNextTradeRouteId(tradeRoutes),
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
