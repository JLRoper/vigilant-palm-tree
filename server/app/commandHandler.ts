import { hydrateGameState, startMove, transferGold, mulberry32 } from "@heroes/engine";
import type { EngineCtx, HydratableGameRow } from "@heroes/engine";
import type {
  Command,
  EngineEvent,
  HeroId,
  HeroState,
  Player,
  SettlementId,
  SettlementState,
} from "@heroes/contracts";
import { runEndTurn, clampGrowthRate } from "./turnService";
import { pool } from "../persistence/db";
import { createGameRepo } from "../persistence/repositories/gameRepo";
import { createEventRepo } from "../persistence/repositories/eventRepo";

// Pre-agreed shape from plan/2026-08-16-phase-3-parallel-dev-plan.md's
// "Pre-agreed repo interface" section. server/persistence/repositories/
// (Track 3.B) owns the real Postgres-backed implementation
// (createGameRepo/createEventRepo, wired below in createLiveCommandDeps);
// declaring the interface here keeps commandHandler.ts's own logic
// decoupled from that implementation and lets it be tested against
// test/helpers/mockRepos.ts.
export interface GameRepo {
  load(name: string): Promise<HydratableGameRow>;
  saveHeroesAndSettlements(
    name: string,
    heroes: Record<HeroId, HeroState>,
    settlements: Record<SettlementId, SettlementState>,
    extra?: {
      players?: Player[];
      gold?: number;
      round?: number;
      day?: number;
      active_player_id?: number;
    },
  ): Promise<void>;
}

export interface EventRepo {
  append(gameName: string, kind: string, payload: unknown): Promise<void>;
}

export interface CommandDeps {
  gameRepo: GameRepo;
  eventRepo: EventRepo;
  ctx: EngineCtx;
}

export interface CommandResult {
  ok: boolean;
  reason?: string;
  events: EngineEvent[];
  // The old spend_movement/transfer endpoints returned the updated
  // hero/settlement directly; preserved here so their client call sites
  // (src/io/api.ts) keep that even though the command's own authoritative
  // record of "what changed" is the events array.
  hero?: HeroState;
  settlement?: SettlementState;
  // EndTurn touches every hero/settlement (movement reset, production,
  // upgrades, upkeep), not just one -- these carry the full post-turn
  // slice back to the client instead of a single hero/settlement.
  heroes?: Record<HeroId, HeroState>;
  settlements?: Record<SettlementId, SettlementState>;
  round?: number;
  day?: number;
  activePlayerId?: number;
  players?: Player[];
}

// Legacy `gold` column is the sum of all players' purses (backward compat
// with reads that predate the heroes/settlements JSONB columns -- see
// server/routes.ts's own sumPlayerGold, which every other route that
// mutates heroes/settlements/players also calls). Duplicated rather than
// imported: routes.ts's copy is a private, unexported helper, and pulling
// it out into a shared module for one ~10-line accounting function isn't
// worth the churn across every one of its call sites today.
function sumPlayerGold(
  players: Player[],
  heroes: Record<string, HeroState>,
  settlements: Record<string, SettlementState>,
): number {
  let total = 0;
  const playerIds = new Set(players.map((p) => p.id));
  for (const h of Object.values(heroes)) {
    if (playerIds.has(h.ownerId) && Number.isFinite(h.gold)) total += h.gold;
  }
  for (const s of Object.values(settlements)) {
    if (s.ownerId !== null && playerIds.has(s.ownerId) && Number.isFinite(s.gold)) total += s.gold;
  }
  return total;
}

// The central transaction loop: load state via repos -> call the matching
// @heroes/engine reducer -> persist the delta -> append the resulting
// event(s). @heroes/engine's reducers (startMove, transferGold, ...) are
// single functions that validate and apply together, returning
// { state, ok, reason } rather than a separate validate()/apply() pair --
// this loop adapts that shape instead of asking Phase 2's already-shipped,
// already-tested reducers to change shape for Phase 3's convenience.
export async function handleCommand(command: Command, deps: CommandDeps): Promise<CommandResult> {
  const row = await deps.gameRepo.load(command.gameName);

  // Generic turn-ownership guard, enforced once here for every command
  // rather than duplicated per engine function. This matters for
  // TransferGold specifically: transferGold() has no actor/turn check of
  // its own (only startMove does, internally, via
  // hero.ownerId !== state.activePlayerId) -- the old /transfer route got
  // its forbidden_not_your_turn 403 from a hand-written check in
  // routes.ts, not from the engine. This guard preserves that behavior for
  // every command uniformly instead of re-deriving it per engine function.
  // It also doubles as EndTurn's ownership check for free: only the
  // current active player can end their own turn.
  if (command.actor !== row.active_player_id) {
    return { ok: false, reason: "forbidden_not_your_turn", events: [] };
  }

  const state = hydrateGameState(row);

  switch (command.kind) {
    case "MoveHero": {
      // Staleness guard: startMove doesn't check this itself (it just
      // moves the hero from wherever the server thinks it is). The old
      // spend_movement route rejected a move whose fromTile didn't match
      // server state, protecting against a client computing cost/path from
      // a position that's since changed underneath it.
      const currentHero = row.heroes[command.heroId];
      if (
        currentHero &&
        (currentHero.q !== command.fromTile.q || currentHero.r !== command.fromTile.r)
      ) {
        return { ok: false, reason: "hero_not_at_fromTile", events: [] };
      }
      // startMove's `state.selectedHeroId !== heroId` check ("not_selected")
      // guards a client-side UI concept: "is this the hero the player has
      // clicked on." A command already names its target hero explicitly --
      // there's no ambiguity for that check to guard against server-side --
      // and hydrateGameState always hydrates selectedHeroId as null (the
      // server doesn't track UI selection). Without this override every
      // MoveHero command would fail with not_selected, unconditionally.
      const stateForMove = { ...state, selectedHeroId: command.heroId };
      const result = startMove(stateForMove, command.heroId, command.toTile, command.cost, command.trail);
      if (!result.ok) {
        return { ok: false, reason: result.reason, events: [] };
      }
      await deps.gameRepo.saveHeroesAndSettlements(
        command.gameName,
        result.state.heroes,
        result.state.settlements,
      );
      const event: EngineEvent = {
        type: "HeroMoved",
        actor: command.actor,
        heroId: command.heroId,
        to: command.toTile,
      };
      await deps.eventRepo.append(command.gameName, event.type, event);
      return { ok: true, events: [event], hero: result.state.heroes[command.heroId] };
    }
    case "TransferGold": {
      const result = transferGold(state, command.heroId, command.settlementId, command.direction);
      if (!result.ok) {
        return { ok: false, reason: result.reason, events: [] };
      }
      await deps.gameRepo.saveHeroesAndSettlements(
        command.gameName,
        result.state.heroes,
        result.state.settlements,
      );
      const event: EngineEvent = {
        type: "GoldTransferred",
        actor: command.actor,
        heroId: command.heroId,
        settlementId: command.settlementId,
        direction: command.direction,
      };
      await deps.eventRepo.append(command.gameName, event.type, event);
      return {
        ok: true,
        events: [event],
        hero: result.state.heroes[command.heroId],
        settlement: result.state.settlements[command.settlementId],
      };
    }
    case "EndTurn": {
      // See server/app/turnService.ts for the pipeline itself and its
      // documented charter-advancement limitation (no DB column for
      // activeCharters yet).
      const { state: finalState, wrapped } = runEndTurn(state, clampGrowthRate(command.growthRate));
      const legacyGold = sumPlayerGold(finalState.players, finalState.heroes, finalState.settlements);
      await deps.gameRepo.saveHeroesAndSettlements(
        command.gameName,
        finalState.heroes,
        finalState.settlements,
        {
          players: finalState.players,
          round: finalState.round,
          day: finalState.day,
          active_player_id: finalState.activePlayerId,
          gold: legacyGold,
        },
      );
      const event: EngineEvent = {
        type: "TurnEnded",
        actor: command.actor,
        round: finalState.round,
        day: finalState.day,
        activePlayerId: finalState.activePlayerId,
        wrapped,
      };
      // Preserves the old /end-turn route's exact game_events `kind`
      // strings (turn_ended/round_ended/round_started/ai_turn_started) --
      // nothing in this codebase currently reads game_events by kind
      // (confirmed: GET /games/:name/events has no client caller yet), but
      // keeping the same audit-trail shape is free and avoids silently
      // changing it for whatever eventually does.
      await deps.eventRepo.append(command.gameName, "turn_ended", {
        playerId: command.actor,
        round: row.round,
      });
      if (wrapped) {
        await deps.eventRepo.append(command.gameName, "round_ended", { round: row.round });
        await deps.eventRepo.append(command.gameName, "round_started", { round: finalState.round });
      }
      const nextPlayer = finalState.players.find((p) => p.id === finalState.activePlayerId);
      if (nextPlayer?.faction === "ai") {
        await deps.eventRepo.append(command.gameName, "ai_turn_started", {
          playerId: finalState.activePlayerId,
          round: finalState.round,
        });
      }
      return {
        ok: true,
        events: [event],
        heroes: finalState.heroes,
        settlements: finalState.settlements,
        round: finalState.round,
        day: finalState.day,
        activePlayerId: finalState.activePlayerId,
        players: finalState.players,
      };
    }
  }

  // Exhaustiveness check: every Command variant returns inside its own case
  // above. If Command grows a new kind without a matching case, `command`
  // is no longer narrowed to `never` here and this line fails to compile.
  const _exhaustive: never = command;
  throw new Error(`unhandled command: ${JSON.stringify(_exhaustive)}`);
}

// Real, Postgres-backed CommandDeps for server/http/routes/commands.ts.
// Lives here (not in the route file) because dependency-cruiser.cjs's
// Track 3.A/3.B boundary rule only exempts commandHandler.ts itself from
// importing server/persistence/repositories/* directly -- server/http/ and
// the rest of server/app/ cannot. Replaces server/app/liveRepos.ts, which
// was an explicitly temporary stand-in for exactly these real repos.
export function createLiveCommandDeps(): CommandDeps {
  return {
    gameRepo: createGameRepo(pool),
    eventRepo: createEventRepo(pool),
    // Week 1/2's commands (MoveHero, TransferGold, EndTurn) don't read
    // ctx.rng or ctx.catalog -- none of startMove/transferGold/runEndTurn
    // take an EngineCtx parameter. Inert placeholder until a real consumer
    // (e.g. Week 3+'s ResolveBattle) needs one; seeding it from Date.now()
    // here is fine precisely because nothing reads it yet.
    ctx: { rng: mulberry32(Date.now() >>> 0), catalog: { unitTypes: [] } },
  };
}
