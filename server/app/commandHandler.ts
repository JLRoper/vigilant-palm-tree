import type { Command, EngineEvent, GameState, HeroState, SettlementState } from "@heroes/contracts";
import { startMove, transferGold, type EngineCtx } from "@heroes/engine";
import { makeEventRepo, makeGameRepo, type EventRepo, type GameRepo, type GameRow } from "../persistence/repositories/gameRepo";

export interface CommandHandlerDeps {
  gameRepo: GameRepo;
  eventRepo: EventRepo;
  ctx: EngineCtx;
}

// Only commandHandler.ts may import repositories directly (see
// dependency-cruiser.cjs's no-repo-import-outside-commandHandler rule) --
// this is the one place server/http/ is allowed to get real, DB-backed
// deps from. rng/catalog are unused by MoveHero/TransferGold today (see
// packages/engine/src/ctx.ts); this is filler to satisfy EngineCtx's shape,
// not a meaningful seed.
export function makeDefaultCommandHandlerDeps(): CommandHandlerDeps {
  return {
    gameRepo: makeGameRepo(),
    eventRepo: makeEventRepo(),
    ctx: { rng: () => 0, catalog: {} },
  };
}

export type CommandResult =
  | { ok: true; hero?: HeroState; settlement?: SettlementState }
  | { ok: false; status: 404 | 403 | 409; reason: string };

// Reconstructs the subset of GameState the ported commands actually read
// (heroes, settlements, activePlayerId, phase). Several GameState fields
// (activeCharters, castleCount, ...) aren't persisted columns today -- see
// GameRow and the Phase-4 note in
// plan/2026-08-16-phase-3-parallel-dev-plan.md for why. selectedHeroId is
// synthesized to the command's own heroId: "selection" is a client-UI-only
// concept with no server analog, and issuing MoveHero for hero X is exactly
// what "hero X is selected" means for a server-authoritative check.
function hydrateGameState(row: GameRow, selectedHeroId: string | null): GameState {
  return {
    round: row.round,
    day: row.day,
    activePlayerId: row.active_player_id,
    players: row.players,
    heroes: row.heroes,
    settlements: row.settlements,
    phase: { kind: "PLAYER_TURN", playerId: row.active_player_id },
    selectedHeroId,
    selectedSettlementId: null,
    dirty: false,
    castleSeed: row.seed,
    castleCount: 0,
    activeCharters: [],
    nextCharterId: 0,
    nextSettlementId: 0,
  };
}

// Central command loop: load -> engine validate/apply -> persist -> append
// event. ctx isn't consumed by MoveHero/TransferGold today (neither
// startMove nor transferGold takes an EngineCtx param) -- it's threaded
// through CommandHandlerDeps for future commands that do need it
// (ResolveBattle, RecruitHero).
export async function handleCommand(
  deps: CommandHandlerDeps,
  gameName: string,
  command: Command,
): Promise<CommandResult> {
  let row: GameRow;
  try {
    row = await deps.gameRepo.load(gameName);
  } catch {
    return { ok: false, status: 404, reason: "not_found" };
  }

  // Generic turn-ownership guard, enforced once here for every command
  // rather than duplicated per engine function. This matters for
  // TransferGold specifically: transferGold() has no actor/turn check of
  // its own (only startMove does, internally) -- the old /transfer route
  // got its forbidden_not_your_turn 403 from a hand-written check in
  // routes.ts, not from the engine. This guard preserves that behavior for
  // every command uniformly instead of re-deriving it per engine function.
  if (command.actor !== row.active_player_id) {
    return { ok: false, status: 403, reason: "forbidden_not_your_turn" };
  }

  switch (command.kind) {
    case "MoveHero": {
      const preHero = row.heroes[command.heroId];
      if (preHero && (preHero.q !== command.fromTile.q || preHero.r !== command.fromTile.r)) {
        return { ok: false, status: 409, reason: "hero_not_at_fromTile" };
      }
      const state = hydrateGameState(row, command.heroId);
      const result = startMove(state, command.heroId, command.toTile, command.cost, command.trailExtension);
      if (!result.ok) {
        return { ok: false, status: 409, reason: result.reason };
      }
      const fromTile = { q: row.heroes[command.heroId].q, r: row.heroes[command.heroId].r };
      await deps.gameRepo.saveHeroesAndSettlements(gameName, result.state.heroes, result.state.settlements);
      const event: EngineEvent = {
        kind: "move_completed",
        heroId: command.heroId,
        fromTile,
        toTile: command.toTile,
        cost: command.cost,
      };
      await deps.eventRepo.append(row.id, event.kind, event);
      return { ok: true, hero: result.state.heroes[command.heroId] };
    }
    case "TransferGold": {
      const state = hydrateGameState(row, null);
      const preHero = row.heroes[command.heroId];
      const preSettlement = row.settlements[command.settlementId];
      const result = transferGold(state, command.heroId, command.settlementId, command.direction);
      if (!result.ok) {
        return { ok: false, status: 409, reason: result.reason };
      }
      const amount = command.direction === "deposit" ? preHero.gold : preSettlement.gold;
      await deps.gameRepo.saveHeroesAndSettlements(gameName, result.state.heroes, result.state.settlements);
      const event: EngineEvent = {
        kind: "transfer_gold",
        heroId: command.heroId,
        settlementId: command.settlementId,
        direction: command.direction,
        amount,
      };
      await deps.eventRepo.append(row.id, event.kind, event);
      return {
        ok: true,
        hero: result.state.heroes[command.heroId],
        settlement: result.state.settlements[command.settlementId],
      };
    }
  }
}
