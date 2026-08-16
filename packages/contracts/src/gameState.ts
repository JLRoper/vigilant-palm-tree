import type { BuildingKind } from "./buildings";
import type { CharterId, Faction, HeroId, HorseVariantId, PlayerId, SettlementId } from "./ids";
import type { ResourceType, WarehouseResource } from "./resources";
import type { CharterState, SettlementState } from "./settlement";
import type { Platoon } from "./units";

export interface Player {
  id: PlayerId;
  faction: Faction;
  name: string;
  color: string;
  heroIds: HeroId[];
  settlementIds: SettlementId[];
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
}

export type GamePhase =
  | { kind: "PLAYER_TURN"; playerId: PlayerId }
  | { kind: "AI_TURN"; playerId: PlayerId }
  | { kind: "BATTLE"; attackerId: HeroId; defenderId: HeroId }
  | { kind: "ROUND_END"; nextRound: number };

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

export interface TradeResult {
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
