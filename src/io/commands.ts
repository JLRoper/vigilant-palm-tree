import type { Axial } from "../core/hex";
import type {
  BuildingDef,
  BuildingKind,
  BuildingUpgradeRequest,
  HeroBattleVerdict,
  HeroState,
  HorseVariantId,
  Platoon,
  Player,
  SettlementState,
  TradeRouteEndpoint,
  TradeRoutePayload,
  TradeRouteState,
  WarehouseResource,
} from "@heroes/contracts";
import { apiFetch } from "./api";
import { getMultiplayerSync } from "./multiplayerSync";

// See plan/2026-08-17-consolidated-phase-1-5-track-map.md §7.1 for context.

const BASE = "/api";

// Thrown by json() below on a non-2xx commands response (#100). `.reason` is
// the server's own `error` field (e.g. "hero_not_at_fromTile",
// "forbidden_not_your_turn" -- see server/app/commandHandler.ts's various
// `{ ok: false, reason }` returns, surfaced as JSON by
// server/http/routes/commands.ts) when the body matches that shape, instead
// of the raw "<status> <statusText> <body>" blob a plain Error(...) here
// used to carry. Callers (src/game/turnHooks.ts) show `.reason` to the
// player via a toast instead of staying silent on rejection.
export class CommandError extends Error {
  readonly status: number;
  readonly reason: string;

  constructor(status: number, reason: string) {
    super(reason);
    this.name = "CommandError";
    this.status = status;
    this.reason = reason;
  }

  static fromResponse(status: number, statusText: string, bodyText: string): CommandError {
    const trimmed = bodyText.trim();
    if (trimmed) {
      try {
        const parsed = JSON.parse(trimmed) as { error?: unknown; message?: unknown };
        if (typeof parsed.error === "string" && parsed.error) {
          const reason =
            typeof parsed.message === "string" && parsed.message
              ? `${parsed.error}: ${parsed.message}`
              : parsed.error;
          return new CommandError(status, reason);
        }
      } catch {
        // Not JSON (or didn't match the { error, message? } shape) -- fall
        // through to the raw text below rather than swallowing it.
      }
    }
    return new CommandError(status, trimmed || `${status} ${statusText}`);
  }
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw CommandError.fromResponse(res.status, res.statusText, text);
  }
  return res.json() as Promise<T>;
}

let lastPersistedAt: string | null = null;

/** Timestamp of the most recent server-confirmed write: a command ack, or a
 * freshly loaded/created game's own `updated_at`. The durability signal
 * SessionManager.manualSave reports as "Last saved" (#147). */
export function getLastPersistedAt(): string | null {
  return lastPersistedAt;
}

export function notePersisted(timestamp: string): void {
  lastPersistedAt = timestamp;
}

// Every command POST goes through here so the `lastEventId` the server
// returns (server/http/routes/commands.ts) reaches the event-cursor poller
// (#146). Those events are this client's own writes, already applied by the
// local reducer that ran before the POST, so the poller skips them instead
// of double-applying them on the next tick.
async function postCommand<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const res = await apiFetch(`${BASE}/games/${encodeURIComponent(name)}/commands`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await json<T & { lastEventId?: unknown }>(res);
  if (typeof result.lastEventId === "number") {
    getMultiplayerSync().noteSelfEventId(result.lastEventId);
  }
  notePersisted(new Date().toISOString());
  return result;
}

export type EndTurnResult = {
  round: number;
  day: number;
  activePlayerId: number;
  players: Player[];
  heroes: Record<string, HeroState>;
  settlements: Record<string, SettlementState>;
  tradeRoutes?: import("@heroes/contracts").TradeRouteState[];
};

// The four logistics command responses (logistics interface fixes §5.7):
// each carries the post-mutation players array -- the wagon-pool delta the
// acting client reconciles from the response instead of waiting for a
// resync -- plus the touched entity slice: the full post-change routes
// array for create/update, the settlement for buy, the hero for assign.
// Mirrors the CommandResult fields commandHandler.ts's four cases return;
// the /commands route forwards all of them verbatim.
export type CreateTradeRouteResult = {
  tradeRoutes: TradeRouteState[];
  players: Player[];
};

export type UpdateTradeRouteResult = {
  tradeRoutes: TradeRouteState[];
  players: Player[];
};

export type BuyWagonsResult = {
  settlement: SettlementState;
  players: Player[];
};

export type AssignWagonsResult = {
  hero: HeroState;
  players: Player[];
};

// Mirrors the contracts ResolveBattleResult (hero-outcomes plan W1) plus the
// client-only `battle` payload the result card renders from. Both heroes are
// OPTIONAL: a defeated side's hero row is deleted server-side and omitted
// here; verdicts ride along so the client can message "slain" / "retreated to
// <name>" / "surrendered" without re-deriving them.
export type ResolveBattleResult = {
  attackerHero?: HeroState;
  defenderHero?: HeroState;
  attackerVerdict?: HeroBattleVerdict;
  defenderVerdict?: HeroBattleVerdict;
  battle: import("@heroes/engine").BattleResult;
};

export type SubmitBattleResultPayload = {
  actor: number;
  attackerId: string;
  defenderId: string;
  outcome: "attackerWon" | "defenderWon" | "retreat" | "surrender" | "draw";
  attackerStacks: Platoon[];
  defenderStacks: Platoon[];
  surrenderedGold?: number;
  rounds: number;
  obstacleSeed: number;
};

// Mirrors the contracts SubmitBattleResultResult: both heroes optional
// (defeated heroes are omitted — no respawn/teleport), verdicts carry the
// retreat/surrender discrimination the arena knows from `outcome`.
export type SubmitBattleResultResult = {
  attackerHero?: HeroState;
  defenderHero?: HeroState;
  attackerVerdict?: HeroBattleVerdict;
  defenderVerdict?: HeroBattleVerdict;
};

export type TransferGoldResult = {
  hero: HeroState;
  settlement: SettlementState;
};

// The authoritative settlement row after a BankGold move: its treasury gold AND
// the bank pot (`building.bank`) the mutation landed in. Mirrors the shape
// commandHandler.ts's `case "BankGold"` returns.
export type BankGoldResult = {
  settlement: SettlementState;
};

// Server is now fully authoritative for end-turn (Phase 3 Track A Week 2):
// this no longer sends the client's GameState at all. The old route
// trusted incomingState.heroes/players wholesale and only re-ran the
// per-day production/auto-trade/consumption pipeline against them; the
// server now loads its own row and runs the full pipeline itself
// (see server/app/turnService.ts), so all this needs to carry is who's
// ending their turn and the client's population-growth preference.
export async function endTurn(
  name: string,
  actor: number,
  growthRate?: number
): Promise<EndTurnResult> {
  return postCommand<EndTurnResult>(name, { kind: "EndTurn", actor, growthRate });
}

export async function spendMovement(
  name: string,
  payload: {
    actor: number;
    heroId: string;
    fromTile: Axial;
    toTile: Axial;
    cost: number;
  }
): Promise<HeroState> {
  const result = await postCommand<{ hero: HeroState }>(name, { kind: "MoveHero", ...payload });
  return result.hero;
}

// Phase 3 Track A Week 3+: ported from the old dedicated /resolve-battle
// route to the /commands bus. No longer carries the client's GameState at
// all -- the server loads its own row, its own unit_types catalog, and
// re-derives adjacency itself (see server/app/commandHandler.ts's
// ResolveBattle case) instead of trusting attackerId/defenderId wholesale.
export async function resolveBattle(
  name: string,
  payload: { actor: number; attackerId: string; defenderId: string }
): Promise<ResolveBattleResult> {
  return postCommand<ResolveBattleResult>(name, { kind: "ResolveBattle", ...payload });
}

// Manual-arena result submission (plan/2026-09-27-manual-battle-wiring.md,
// work item 4): the 15th command kind. Unlike ResolveBattle -- where the
// server runs the resolver -- this carries the arena's played-out outcome
// and the server applies it through the same shared post-battle rules
// (server/app/commandHandler.ts's buildPostBattleHeroes/persistBattleOutcome).
// Awaited by GameActions.startBattleFlow's Fight path: the returned hero pair
// is what the client merges before ending the BATTLE phase.
export async function submitBattleResult(
  name: string,
  payload: SubmitBattleResultPayload,
): Promise<SubmitBattleResultResult> {
  return postCommand<SubmitBattleResultResult>(name, { kind: "SubmitBattleResult", ...payload });
}

// Settlement-garrison battle result submission
// (plan/1790560842471-unit-recruitment-garrison-plan.md §8): mirrors
// submitBattleResult command-for-command -- carries the arena's played-out
// outcome against a settlement garrison; on attackerWon the server applies
// the capture, on every other outcome it bounces the attacker's move with
// garrison survivors persisting. The returned hero + settlement pair is
// what the client merges before leaving the SETTLEMENT_BATTLE phase.
export type SubmitSettlementBattleResultPayload = {
  actor: number;
  attackerId: string;
  settlementId: string;
  outcome: "attackerWon" | "defenderWon" | "retreat" | "surrender" | "draw";
  attackerStacks: Platoon[];
  defenderStacks: Platoon[];
  surrenderedGold?: number;
  rounds: number;
  obstacleSeed: number;
};

// Mirrors the contracts SubmitSettlementBattleResultResult (hero-outcomes
// parity): the settlement always rides back, the attacker hero is OPTIONAL —
// absence is the deletion signal for a defeated attacker — and the verdict
// carries the retreat/surrender/defeat discrimination for the result card.
export type SubmitSettlementBattleResultResult = {
  attackerHero?: HeroState;
  settlement: SettlementState;
  attackerVerdict?: HeroBattleVerdict;
};

export async function submitSettlementBattleResult(
  name: string,
  payload: SubmitSettlementBattleResultPayload,
): Promise<SubmitSettlementBattleResultResult> {
  return postCommand<SubmitSettlementBattleResultResult>(name, { kind: "SubmitSettlementBattleResult", ...payload });
}

export async function transferGold(
  name: string,
  payload: {
    actor: number;
    heroId: string;
    settlementId: string;
    direction: "deposit" | "withdraw";
  }
): Promise<TransferGoldResult> {
  return postCommand<TransferGoldResult>(name, { kind: "TransferGold", ...payload });
}

// One command for both pot directions, matching the contracts
// BankGoldCommand: "deposit" moves settlement treasury -> the bank's pot,
// "withdraw" starts the 7-day countdown out of it (the gold leaves the pot at
// once and matures into the treasury on state.day + BANK_WITHDRAWAL_DAYS).
export async function bankGold(
  name: string,
  payload: {
    actor: number;
    settlementId: string;
    gx: number;
    gy: number;
    amount: number;
    direction: "deposit" | "withdraw";
  }
): Promise<BankGoldResult> {
  return postCommand<BankGoldResult>(name, { kind: "BankGold", ...payload });
}

// The five functions below are new in Phase 3 Track A Week 3+ -- none of
// RecruitHero/UpgradeTownHall/SetAutoTrade/ReorderStack/CaptureSettlement
// had any server round-trip at all before this (see this port's PR
// description's cross-cutting finding). Each is called fire-and-forget
// from src/game/turnHooks.ts, mirroring onAiMove's existing pattern for
// MoveHero -- the response bodies are intentionally unused by the callers
// (client trusts its own already-applied local reducer result; these
// calls exist purely so the mutation also persists server-side).

export async function recruitHero(
  name: string,
  payload: { actor: number; heroName: string; settlementId: string; horseVariant: HorseVariantId }
): Promise<void> {
  await postCommand(name, { kind: "RecruitHero", ...payload });
}

export async function upgradeTownHall(
  name: string,
  payload: { actor: number; settlementId: string; targetLevel: 2 | 3 }
): Promise<void> {
  await postCommand(name, { kind: "UpgradeTownHall", ...payload });
}

export async function setAutoTrade(
  name: string,
  payload: { actor: number; settlementId: string; autoTrade: boolean }
): Promise<void> {
  await postCommand(name, { kind: "SetAutoTrade", ...payload });
}

export async function reorderStack(
  name: string,
  payload: { actor: number; heroId: string; fromIdx: number; toIdx: number }
): Promise<void> {
  await postCommand(name, { kind: "ReorderStack", ...payload });
}

export async function captureSettlement(
  name: string,
  payload: { actor: number; heroId: string; settlementId: string }
): Promise<void> {
  await postCommand(name, { kind: "CaptureSettlement", ...payload });
}

// StartCharter (plan/2026-08-17-consolidated-phase-1-5-track-map.md §7.1):
// same fire-and-forget shape as the five functions above -- called from
// src/game/turnHooks.ts's onStartCharter right after the local
// startCharterReducer() call already applied and returned ok, so this
// response body is unused here too.
export async function startCharter(
  name: string,
  payload: { actor: number; heroId: string; targetQ: number; targetR: number; settlementName: string }
): Promise<void> {
  await postCommand(name, { kind: "StartCharter", ...payload });
}

// UpgradeBuilding / UpgradeSettlement
// (plan/2026-08-17-issue-88-remaining-command-ports.md): same fire-and-forget
// shape as the functions above, closing the last two gaps issue #88's
// re-scoped review found -- these two mutations previously had no server
// round-trip at all.
export async function upgradeBuilding(
  name: string,
  payload: { actor: number; settlementId: string; requests: BuildingUpgradeRequest[] }
): Promise<void> {
  await postCommand(name, { kind: "UpgradeBuilding", ...payload });
}

// F4 closer: commits the city view's working building cart (placements +
// destroy-mode removals) server-side. The server re-derives the net cost
// against its own row and revalidates affordability; the caller has already
// applied the same change optimistically via applyPlaceBuildings().
export async function placeBuildings(
  name: string,
  payload: { actor: number; settlementId: string; buildings: BuildingDef[]; initialLayout?: boolean }
): Promise<void> {
  await postCommand(name, { kind: "PlaceBuildings", ...payload });
}

// Hero cargo load/unload at a same-hex owned settlement (plan §6).
export async function transferResources(
  name: string,
  payload: {
    actor: number;
    heroId: string;
    settlementId: string;
    direction: "load" | "unload";
    amounts: Partial<Record<WarehouseResource, number>>;
  }
): Promise<void> {
  await postCommand(name, { kind: "TransferResources", ...payload });
}

// Moves wagons between the player's unassigned pool and a hero (plan §6).
// `slot` picks the pool ("cargo" army wagons, or "treasury" carts); absent
// means cargo (the pre-split behavior). The response carries the updated
// hero plus the post-mutation players array (§5.7) -- today's caller stays
// fire-and-forget, but the client merge wave consumes it.
export async function assignWagons(
  name: string,
  payload: { actor: number; heroId: string; delta: number; slot?: "cargo" | "treasury" }
): Promise<AssignWagonsResult> {
  return postCommand<AssignWagonsResult>(name, { kind: "AssignWagons", ...payload });
}

// Buys wagons into the player's unassigned pool, paid from a settlement (plan §6).
// `slot` picks the pool the wagons land in; absent means cargo. Response
// carries the updated settlement plus the post-mutation players array (§5.7).
export async function buyWagons(
  name: string,
  payload: { actor: number; settlementId: string; count: number; slot?: "cargo" | "treasury" }
): Promise<BuyWagonsResult> {
  return postCommand<BuyWagonsResult>(name, { kind: "BuyWagons", ...payload });
}

// Creates a trade route, committing wagons from the unassigned pool (plan §6).
// Endpoints are settlement-or-hero (`kind` discriminates); the payload picks
// the caravan type (a warehouse resource = cargo, "gold" = treasure). Response
// carries the full post-change routes array plus the post-mutation players
// array (§5.7).
export async function createTradeRoute(
  name: string,
  payload: {
    actor: number;
    from: TradeRouteEndpoint;
    to: TradeRouteEndpoint;
    payload: TradeRoutePayload;
    wagons: number;
  }
): Promise<CreateTradeRouteResult> {
  return postCommand<CreateTradeRouteResult>(name, { kind: "CreateTradeRoute", ...payload });
}

// Updates (or removes) an existing trade route (plan §6). Response carries
// the full post-change routes array plus the post-mutation players array (§5.7).
export async function updateTradeRoute(
  name: string,
  payload: {
    actor: number;
    routeId: string;
    resource?: WarehouseResource;
    wagonsDelta?: number;
    remove?: boolean;
  }
): Promise<UpdateTradeRouteResult> {
  return postCommand<UpdateTradeRouteResult>(name, { kind: "UpdateTradeRoute", ...payload });
}

export async function upgradeSettlement(
  name: string,
  payload: { actor: number; settlementId: string }
): Promise<void> {
  await postCommand(name, { kind: "UpgradeSettlement", ...payload });
}

// AdvanceCharterTravel (#152, R5 remainder): one hex-step of a chartering
// hero's auto-travel. Fire-and-forget, same shape as spendMovement's
// MoveHero call -- src/state/turnController.ts's advanceAutoTravel() calls
// this right after its own local stepTravelCharterReducer() call already
// applied and returned ok, so this response body is unused here too.
export async function advanceCharterTravel(
  name: string,
  payload: {
    actor: number;
    heroId: string;
    fromTile: Axial;
    toTile: Axial;
    cost: number;
  }
): Promise<void> {
  await postCommand(name, { kind: "AdvanceCharterTravel", ...payload });
}

// Unit recruitment into a settlement garrison + garrison<->hero platoon
// transfers (plan/1790560842471-unit-recruitment-garrison-plan.md §8): same
// fire-and-forget shape as recruitHero/captureSettlement above -- called
// from src/game/turnHooks.ts right after the local engine reducer already
// applied, so these response bodies are unused by the callers too.
export async function recruitUnits(
  name: string,
  payload: {
    actor: number;
    settlementId: string;
    buildingKind: BuildingKind;
    gx: number;
    gy: number;
    unitTypeId: string;
    count: number;
  }
): Promise<void> {
  await postCommand(name, { kind: "RecruitUnits", ...payload });
}

export async function transferUnits(
  name: string,
  payload: {
    actor: number;
    heroId: string;
    settlementId: string;
    direction: "toHero" | "toGarrison";
    unitTypeId: string;
    count: number;
    toSlot?: number;
  }
): Promise<void> {
  await postCommand(name, { kind: "TransferUnits", ...payload });
}
