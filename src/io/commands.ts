import type { Axial } from "../core/hex";
import type {
  BuildingUpgradeRequest,
  HeroState,
  HorseVariantId,
  Player,
  SettlementState,
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
  return result;
}

export type EndTurnResult = {
  round: number;
  day: number;
  activePlayerId: number;
  players: Player[];
  heroes: Record<string, HeroState>;
  settlements: Record<string, SettlementState>;
};

export type ResolveBattleResult = {
  attackerHero: HeroState;
  defenderHero: HeroState;
  battle: import("@heroes/engine").BattleResult;
};

export type TransferGoldResult = {
  hero: HeroState;
  settlement: SettlementState;
};

export type TradeResourcesResult = {
  fromSettlement: SettlementState;
  toSettlement: SettlementState;
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

// Phase 3 Track A Week 3+: ported from the old dedicated /trade route to
// the /commands bus.
export async function tradeResources(
  name: string,
  payload: {
    actor: number;
    fromSettlementId: string;
    toSettlementId: string;
    resource: Exclude<WarehouseResource, "food">;
    amount: number;
  }
): Promise<TradeResourcesResult> {
  return postCommand<TradeResourcesResult>(name, { kind: "TradeResources", ...payload });
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

export async function upgradeSettlement(
  name: string,
  payload: { actor: number; settlementId: string; upgradePopulationGate: number }
): Promise<void> {
  await postCommand(name, { kind: "UpgradeSettlement", ...payload });
}
