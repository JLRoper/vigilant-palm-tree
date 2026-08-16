import type {
  CharterState,
  GamePhase,
  GameState,
  HeroId,
  HeroState,
  Player,
  PlayerId,
  SettlementId,
  SettlementState,
  Warehouse,
} from "@heroes/contracts";
import { MOVEMENT_PER_TURN } from "@heroes/contracts";

export function emptyWarehouse(overrides: Partial<Warehouse> = {}): Warehouse {
  return { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0, ...overrides };
}

export function makePlayer(
  id: PlayerId,
  faction: Player["faction"],
  heroIds: HeroId[],
  settlementIds: SettlementId[],
): Player {
  return { id, faction, name: faction === "player" ? "Human" : "AI", color: "#000000", heroIds, settlementIds };
}

export function makeHero(
  id: HeroId,
  ownerId: PlayerId,
  q: number,
  r: number,
  opts: Partial<
    Pick<HeroState, "movementRemaining" | "gold" | "troops" | "isChartering" | "charterId" | "stacks" | "horseVariant">
  > = {},
): HeroState {
  return {
    id,
    name: id,
    ownerId,
    q,
    r,
    movementRemaining: opts.movementRemaining ?? MOVEMENT_PER_TURN,
    previousQ: null,
    previousR: null,
    previousMovementRemaining: null,
    trail: [{ q, r }],
    gold: opts.gold ?? 0,
    troops: opts.troops ?? 1,
    stacks: opts.stacks ?? [],
    isChartering: opts.isChartering ?? false,
    charterId: opts.charterId ?? null,
    horseVariant: opts.horseVariant ?? "bubbly",
  };
}

export function makeSettlement(
  id: SettlementId,
  ownerId: PlayerId | null,
  q: number,
  r: number,
  opts: Partial<
    Pick<SettlementState, "population" | "goldTax" | "gold" | "resourceRates" | "morale" | "autoTrade" | "warehouse" | "level" | "buildings" | "citySpots">
  > = {},
): SettlementState {
  return {
    id,
    name: id,
    ownerId,
    q,
    r,
    level: opts.level ?? 1,
    population: opts.population ?? 0,
    goldTax: opts.goldTax ?? 0,
    resourceRates: opts.resourceRates ?? {},
    foundedOnResource: null,
    gold: opts.gold ?? 0,
    warehouse: opts.warehouse ?? emptyWarehouse(),
    citySpots: opts.citySpots ?? [],
    cityMines: [],
    morale: opts.morale ?? 100,
    autoTrade: opts.autoTrade ?? true,
    castleVariant: 0,
    buildings: opts.buildings ?? [],
  };
}

export function makeCharter(overrides: Partial<CharterState> & Pick<CharterState, "id" | "heroId" | "ownerId">): CharterState {
  return {
    targetQ: 10,
    targetR: 10,
    settlementName: "New Town",
    phase: "traveling",
    daysRemaining: 10,
    settlementId: `${overrides.id}-settlement`,
    resourceRates: {},
    foundedOnResource: null,
    citySpots: [],
    ...overrides,
  };
}

export interface StateOverrides {
  players?: Player[];
  heroes?: HeroState[];
  settlements?: SettlementState[];
  activeCharters?: CharterState[];
  round?: number;
  day?: number;
  activePlayerId?: PlayerId;
  phase?: GamePhase;
  selectedHeroId?: HeroId | null;
  nextCharterId?: number;
  nextSettlementId?: number;
}

export function makeState(overrides: StateOverrides = {}): GameState {
  const players = overrides.players ?? [
    makePlayer(0, "player", ["h0"], ["s0"]),
    makePlayer(1, "ai", ["h1"], ["s1"]),
  ];
  const heroList = overrides.heroes ?? [makeHero("h0", 0, 2, 2), makeHero("h1", 1, 18, 4)];
  const heroes: Record<HeroId, HeroState> = {};
  for (const h of heroList) heroes[h.id] = h;
  const settlementList = overrides.settlements ?? [makeSettlement("s0", 0, 2, 2), makeSettlement("s1", 1, 18, 4)];
  const settlements: Record<SettlementId, SettlementState> = {};
  for (const s of settlementList) settlements[s.id] = s;
  const activePlayerId = overrides.activePlayerId ?? 0;
  return {
    round: overrides.round ?? 1,
    day: overrides.day ?? 1,
    activePlayerId,
    players,
    heroes,
    settlements,
    phase: overrides.phase ?? { kind: "PLAYER_TURN", playerId: activePlayerId },
    selectedHeroId: overrides.selectedHeroId ?? null,
    selectedSettlementId: null,
    dirty: false,
    castleSeed: 0,
    castleCount: 3,
    activeCharters: overrides.activeCharters ?? [],
    nextCharterId: overrides.nextCharterId ?? 0,
    nextSettlementId: overrides.nextSettlementId ?? 100,
  };
}
