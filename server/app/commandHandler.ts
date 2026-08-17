import {
  hydrateGameState,
  startMove,
  transferGold,
  mulberry32,
  tradeResources,
  resolveBattle as resolveBattleEngine,
  normalizePlatoons,
  detectAdjacentEnemy,
  recruitHero,
  startTownHallUpgrade,
  setAutoTrade,
  reorderStack,
  captureSettlement,
} from "@heroes/engine";
import type { EngineCtx, HydratableGameRow, UnitType, BattleResult } from "@heroes/engine";
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
  // TradeResources: the two settlements it actually touches (mirrors
  // TransferGold's hero/settlement pair above -- named fields for the
  // specific affected entities, not the full map EndTurn returns).
  fromSettlement?: SettlementState;
  toSettlement?: SettlementState;
  // ResolveBattle: both combatants plus the full engine BattleResult the
  // client's battle UI needs (log, grid, per-round detail) -- none of
  // that is reconstructable from the summary fields on the persisted
  // BattleResolved event alone.
  attackerHero?: HeroState;
  defenderHero?: HeroState;
  battle?: BattleResult;
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
      // MoveHero/TransferGold above both persist their own returned
      // EngineEvent verbatim (kind === event.type, payload === the whole
      // event) -- do the same here so game_events.kind always has a
      // "TurnEnded" row matching what this command actually returns to
      // its caller. Without this, EndTurn was the only command whose
      // result.events entry never made it into the DB event stream at
      // all under its own name, which is exactly the kind of
      // per-command inconsistency a future kind-based consumer of
      // game_events would trip over.
      await deps.eventRepo.append(command.gameName, event.type, event);
      // In addition to that, preserve the old /end-turn route's exact
      // game_events `kind` strings (turn_ended/round_ended/round_started/
      // ai_turn_started) as their own rows -- nothing in this codebase
      // currently reads game_events by kind (confirmed: GET
      // /games/:name/events has no client caller yet), but keeping the
      // same audit-trail shape is free and avoids silently changing it
      // for whatever eventually does.
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
    case "TradeResources": {
      const from = row.settlements[command.fromSettlementId];
      const to = row.settlements[command.toSettlementId];
      if (!from || !to) {
        return { ok: false, reason: "settlement_not_found", events: [] };
      }
      // tradeResources() itself only requires from.ownerId === to.ownerId
      // -- it never compares either to command.actor. Without this
      // explicit check, command.actor (already confirmed above to be the
      // active player) could trade between two OTHER players'
      // settlements as long as those two happen to share an owner.
      if (from.ownerId !== command.actor || to.ownerId !== command.actor) {
        return { ok: false, reason: "forbidden_not_your_settlement", events: [] };
      }
      const result = tradeResources(
        state,
        command.fromSettlementId,
        command.toSettlementId,
        command.resource,
        command.amount,
      );
      if (!result.ok) {
        return { ok: false, reason: result.reason, events: [] };
      }
      const legacyGold = sumPlayerGold(state.players, state.heroes, result.state.settlements);
      await deps.gameRepo.saveHeroesAndSettlements(
        command.gameName,
        result.state.heroes,
        result.state.settlements,
        { gold: legacyGold },
      );
      const event: EngineEvent = {
        type: "ResourcesTraded",
        actor: command.actor,
        fromSettlementId: command.fromSettlementId,
        toSettlementId: command.toSettlementId,
        resource: command.resource,
        amount: command.amount,
      };
      await deps.eventRepo.append(command.gameName, event.type, event);
      return {
        ok: true,
        events: [event],
        fromSettlement: result.state.settlements[command.fromSettlementId],
        toSettlement: result.state.settlements[command.toSettlementId],
      };
    }
    case "ResolveBattle": {
      const attackerHero = row.heroes[command.attackerId];
      const defenderHero = row.heroes[command.defenderId];
      if (!attackerHero || !defenderHero) {
        return { ok: false, reason: "hero_not_found", events: [] };
      }
      // command.actor === row.active_player_id is already enforced above;
      // this additionally confirms the ATTACKER's hero belongs to that
      // same actor (the old /resolve-battle route's exact check), since
      // the two aren't otherwise tied together anywhere.
      if (attackerHero.ownerId !== command.actor) {
        return { ok: false, reason: "forbidden_not_your_hero", events: [] };
      }
      // Neither the old route nor @heroes/engine's resolveBattle() itself
      // ever checked that defenderId is actually adjacent to attackerId --
      // that guarantee existed purely because the client's own
      // detectAdjacentEnemy() call chose the pairing before ever asking
      // the server to resolve it. Re-derive and verify it server-side
      // instead of trusting the pairing the command names.
      if (detectAdjacentEnemy(state, command.attackerId) !== command.defenderId) {
        return { ok: false, reason: "not_adjacent", events: [] };
      }
      const unitTypes: Record<string, UnitType> = Object.fromEntries(
        deps.ctx.catalog.unitTypes.map((u) => [u.id, u]),
      );
      const attackerPlatoons = normalizePlatoons(attackerHero.stacks);
      const defenderPlatoons = normalizePlatoons(defenderHero.stacks);
      // ctx.rng is the properly-injected randomness source for exactly
      // this -- Date.now() (the old route's obstacleSeed source) is a
      // wall-clock read commandHandler.ts shouldn't be making directly.
      // See packages/contracts/src/events/engineEvent.ts's BattleResolved
      // variant for why this now gets persisted instead of only existing
      // transiently on the HTTP response.
      const obstacleSeed = Math.floor(deps.ctx.rng() * 0x1_0000_0000) >>> 0;
      const battle: BattleResult = resolveBattleEngine(attackerPlatoons, defenderPlatoons, {
        obstacleSeed,
        unitTypes,
      });
      // Hero entities are never deleted here -- a no-retreat loss just
      // empties their platoons, matching the old route's own comment
      // (what happens to a fully-defeated hero is a later phase's
      // concern, per feature-plans/CombatResolutionEngine.md).
      const lootedGold = battle.defenderOutcome === "lost_all_troops" ? Number(defenderHero.gold) || 0 : 0;
      const newHeroes: Record<HeroId, HeroState> = {
        ...state.heroes,
        [command.attackerId]: {
          ...attackerHero,
          gold: (Number(attackerHero.gold) || 0) + lootedGold,
          stacks: battle.attackerPlatoons,
        },
        [command.defenderId]: {
          ...defenderHero,
          gold: lootedGold > 0 ? 0 : defenderHero.gold,
          stacks: battle.defenderPlatoons,
        },
      };
      const legacyGold = sumPlayerGold(state.players, newHeroes, state.settlements);
      await deps.gameRepo.saveHeroesAndSettlements(
        command.gameName,
        newHeroes,
        state.settlements,
        { gold: legacyGold },
      );
      const event: EngineEvent = {
        type: "BattleResolved",
        actor: command.actor,
        attackerId: command.attackerId,
        defenderId: command.defenderId,
        winner: battle.winner,
        attackerOutcome: battle.attackerOutcome,
        defenderOutcome: battle.defenderOutcome,
        rewardGold: lootedGold,
        rounds: battle.rounds,
        obstacleSeed,
      };
      await deps.eventRepo.append(command.gameName, event.type, event);
      return {
        ok: true,
        events: [event],
        attackerHero: newHeroes[command.attackerId],
        defenderHero: newHeroes[command.defenderId],
        battle,
      };
    }
    case "RecruitHero": {
      // recruitHero() itself checks settlement.ownerId !== playerId, and
      // command.actor === row.active_player_id is already enforced above
      // -- between the two, there's no separate ownership hole to close
      // here the way TradeResources/UpgradeTownHall/etc. need.
      const result = recruitHero(state, command.actor, command.heroName, command.settlementId, command.horseVariant);
      if (!result.hero) {
        return { ok: false, reason: result.error ?? "recruit_failed", events: [] };
      }
      await deps.gameRepo.saveHeroesAndSettlements(
        command.gameName,
        result.state.heroes,
        result.state.settlements,
        { players: result.state.players },
      );
      const event: EngineEvent = {
        type: "HeroRecruited",
        actor: command.actor,
        heroId: result.hero.id,
        name: result.hero.name,
        settlementId: command.settlementId,
        horseVariant: command.horseVariant,
      };
      await deps.eventRepo.append(command.gameName, event.type, event);
      return { ok: true, events: [event], hero: result.hero, players: result.state.players };
    }
    case "UpgradeTownHall": {
      const settlement = row.settlements[command.settlementId];
      if (!settlement) {
        return { ok: false, reason: "no_settlement", events: [] };
      }
      // startTownHallUpgrade() never checks ownership itself.
      if (settlement.ownerId !== command.actor) {
        return { ok: false, reason: "forbidden_not_your_settlement", events: [] };
      }
      const result = startTownHallUpgrade(state, command.settlementId, command.targetLevel);
      if (!result.ok) {
        return { ok: false, reason: result.reason, events: [] };
      }
      await deps.gameRepo.saveHeroesAndSettlements(
        command.gameName,
        result.state.heroes,
        result.state.settlements,
      );
      const event: EngineEvent = {
        type: "TownHallUpgradeStarted",
        actor: command.actor,
        settlementId: command.settlementId,
        targetLevel: command.targetLevel,
      };
      await deps.eventRepo.append(command.gameName, event.type, event);
      return { ok: true, events: [event], settlement: result.state.settlements[command.settlementId] };
    }
    case "SetAutoTrade": {
      const settlement = row.settlements[command.settlementId];
      if (!settlement) {
        return { ok: false, reason: "no_settlement", events: [] };
      }
      // setAutoTrade() never checks ownership itself -- today that only
      // lives in src/state/turnController.ts's client-side caller.
      if (settlement.ownerId !== command.actor) {
        return { ok: false, reason: "forbidden_not_your_settlement", events: [] };
      }
      const nextState = setAutoTrade(state, command.settlementId, command.autoTrade);
      // setAutoTrade() returns the *same* state reference, unchanged,
      // when the flag already matches -- src/state/turnController.ts's
      // own setAutoTrade() wrapper treats that identically as a failure
      // (`if (next === this.state) return false;`), so mirror that here
      // instead of treating a no-op as success.
      if (nextState === state) {
        return { ok: false, reason: "no_change", events: [] };
      }
      await deps.gameRepo.saveHeroesAndSettlements(
        command.gameName,
        nextState.heroes,
        nextState.settlements,
      );
      const event: EngineEvent = {
        type: "AutoTradeToggled",
        actor: command.actor,
        settlementId: command.settlementId,
        autoTrade: command.autoTrade,
      };
      await deps.eventRepo.append(command.gameName, event.type, event);
      return { ok: true, events: [event], settlement: nextState.settlements[command.settlementId] };
    }
    case "ReorderStack": {
      const hero = row.heroes[command.heroId];
      if (!hero) {
        return { ok: false, reason: "no_hero", events: [] };
      }
      // reorderStack() has no ownership check at all -- nor does its only
      // existing client-side caller. Added here from scratch.
      if (hero.ownerId !== command.actor) {
        return { ok: false, reason: "forbidden_not_your_hero", events: [] };
      }
      const result = reorderStack(state, command.heroId, command.fromIdx, command.toIdx);
      if (!result.ok) {
        return { ok: false, reason: result.reason, events: [] };
      }
      await deps.gameRepo.saveHeroesAndSettlements(
        command.gameName,
        result.state.heroes,
        result.state.settlements,
      );
      const event: EngineEvent = {
        type: "StackReordered",
        actor: command.actor,
        heroId: command.heroId,
        fromIdx: command.fromIdx,
        toIdx: command.toIdx,
      };
      await deps.eventRepo.append(command.gameName, event.type, event);
      return { ok: true, events: [event], hero: result.state.heroes[command.heroId] };
    }
    case "CaptureSettlement": {
      const hero = row.heroes[command.heroId];
      const settlement = row.settlements[command.settlementId];
      if (!hero || !settlement) {
        return { ok: false, reason: "not_found", events: [] };
      }
      if (hero.ownerId !== command.actor) {
        return { ok: false, reason: "forbidden_not_your_hero", events: [] };
      }
      // captureSettlement() itself never checks hero position at all --
      // see packages/contracts/src/commands/captureSettlement.ts's own
      // header comment for why this can't be left to the engine function.
      if (hero.q !== settlement.q || hero.r !== settlement.r) {
        return { ok: false, reason: "hero_not_at_settlement", events: [] };
      }
      const result = captureSettlement(state, command.heroId, command.settlementId);
      if (!result.captured) {
        return { ok: false, reason: "already_owned", events: [] };
      }
      await deps.gameRepo.saveHeroesAndSettlements(
        command.gameName,
        result.state.heroes,
        result.state.settlements,
        { players: result.state.players },
      );
      const event: EngineEvent = {
        type: "SettlementCaptured",
        actor: command.actor,
        heroId: command.heroId,
        settlementId: command.settlementId,
        previousOwnerId: result.previousOwnerId,
      };
      await deps.eventRepo.append(command.gameName, event.type, event);
      return {
        ok: true,
        events: [event],
        hero: result.state.heroes[command.heroId],
        settlement: result.state.settlements[command.settlementId],
        players: result.state.players,
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
//
// Async now (Week 1/2 shipped this synchronous): ResolveBattle is this
// phase's first real consumer of ctx.catalog.unitTypes, which -- unlike
// ctx.rng -- can't be seeded from a pure function call, only from a DB
// read (the same `unit_types` table/columns server/routes.ts's own
// GET /units already queries). server/http/routes/commands.ts calls and
// memoizes this once, lazily, on first request rather than at module load
// time, so route registration itself still doesn't block on a DB round-trip.
export async function createLiveCommandDeps(): Promise<CommandDeps> {
  const unitTypesResult = await pool.query<UnitTypeRow>(
    `SELECT id, name, attack, defence, health, speed, description, advantage_type, specialty, specialty_priority
       FROM unit_types`,
  );
  const unitTypes: UnitType[] = unitTypesResult.rows.map((r) => ({
    id: r.id,
    name: r.name,
    attack: r.attack,
    defence: r.defence,
    health: r.health,
    speed: r.speed,
    description: r.description,
    advantageType: r.advantage_type,
    specialty: r.specialty,
    specialtyPriority: r.specialty_priority,
  }));
  return {
    gameRepo: createGameRepo(pool),
    eventRepo: createEventRepo(pool),
    ctx: { rng: mulberry32(Date.now() >>> 0), catalog: { unitTypes } },
  };
}

// Mirrors server/routes.ts's own identically-shaped, identically-named
// local type for the same `unit_types` SELECT -- not imported from there
// (routes.ts doesn't export it, and commandHandler.ts shouldn't depend on
// routes.ts either way).
type UnitTypeRow = {
  id: string;
  name: string;
  attack: number;
  defence: number;
  health: number;
  speed: number;
  description: string;
  advantage_type: UnitType["advantageType"];
  specialty: string;
  specialty_priority: number;
};
