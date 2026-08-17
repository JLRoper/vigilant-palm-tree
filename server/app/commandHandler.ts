import { hydrateGameState, startMove, transferGold } from "@heroes/engine";
import type { EngineCtx, HydratableGameRow } from "@heroes/engine";
import type {
  Command,
  EngineEvent,
  HeroId,
  HeroState,
  SettlementId,
  SettlementState,
} from "@heroes/contracts";

// Pre-agreed shape from plan/2026-08-16-phase-3-parallel-dev-plan.md's
// "Pre-agreed repo interface" section. Track 3.B
// (server/persistence/repositories/) owns the real Postgres-backed
// implementation; declaring the interface here lets commandHandler.ts
// (Track 3.A) be built and tested against test/helpers/mockRepos.ts without
// blocking on that landing. Move/re-export from Track 3.B's files once they
// exist, if this duplication becomes annoying.
export interface GameRepo {
  load(name: string): Promise<HydratableGameRow>;
  saveHeroesAndSettlements(
    name: string,
    heroes: Record<HeroId, HeroState>,
    settlements: Record<SettlementId, SettlementState>,
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
  }

  // Exhaustiveness check: every Command variant returns inside its own case
  // above. If Command grows a new kind without a matching case, `command`
  // is no longer narrowed to `never` here and this line fails to compile.
  const _exhaustive: never = command;
  throw new Error(`unhandled command: ${JSON.stringify(_exhaustive)}`);
}
