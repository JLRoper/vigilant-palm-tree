import {
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
  effectiveIncome,
  clampMorale,
  GameMap,
  computeSettlementRates,
  cityViewSizeFor,
  generateCitySpots,
  startCharter,
  cleanupDefeatedHeroCharters,
  startBuildingUpgrade,
  startSettlementUpgrade,
} from "@heroes/engine";
import type { EngineCtx, HydratableGameRow, UnitType, BattleResult, MapSize } from "@heroes/engine";
import { hexDistance } from "@heroes/contracts";
import type {
  CharterState,
  Command,
  EngineEvent,
  HeroId,
  HeroState,
  Player,
  SettlementId,
  SettlementState,
  StartCharterPayload,
} from "@heroes/contracts";
import { runEndTurn, clampGrowthRate } from "./turnService";
import { pool } from "../persistence/db";
import { createGameRepo, GameNotFoundError, type SettlementSnapshotInput, type ResourceTransactionInput } from "../persistence/repositories/gameRepo";
import { createEventRepo } from "../persistence/repositories/eventRepo";
import { createHeroRepo } from "../persistence/repositories/heroRepo";
import { createSettlementRepo } from "../persistence/repositories/settlementRepo";
import { createCharterRepo } from "../persistence/repositories/charterRepo";
import { hydrateFromRepos } from "../persistence/hydrate";

// Pre-agreed shape from plan/2026-08-16-phase-3-parallel-dev-plan.md's
// "Pre-agreed repo interface" section. server/persistence/repositories/
// (Track 3.B) owns the real Postgres-backed implementation
// (createGameRepo/createEventRepo, wired below in createLiveCommandDeps);
// declaring the interface here keeps commandHandler.ts's own logic
// decoupled from that implementation and lets it be tested against
// test/helpers/mockRepos.ts.
//
// insertSettlementSnapshots/insertResourceTransactions close #89 (this
// EndTurn case is the only call site for either): the old /end-turn
// route wrote a settlement_snapshots row per settlement and a
// resource_transactions row per auto-trade transfer on every turn end;
// the EndTurn command that replaced it never picked that logic up, so
// both tables silently stopped being written from PR #87 onward. Track
// 3.B's real implementations (server/persistence/repositories/gameRepo.ts)
// land the persistence-layer half; this file's EndTurn case (below) is
// the wiring half.
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
      next_charter_id?: number;
      next_settlement_id?: number;
    },
  ): Promise<void>;
  insertSettlementSnapshots(gameName: string, snapshots: SettlementSnapshotInput[]): Promise<void>;
  insertResourceTransactions(gameName: string, transactions: ResourceTransactionInput[]): Promise<void>;
}

export interface EventRepo {
  append(gameName: string, kind: string, payload: unknown, actorSeat: number | null): Promise<number>;
}

// Phase 4 Track A (plan/2026-08-17-phase-4-db-deblobbing-dev-plan.md,
// "Dual-write & read-path design"). Same decoupling rationale as GameRepo/
// EventRepo above: structural copies of server/persistence/repositories/
// {hero,settlement,charter}Repo.ts's real interfaces, kept separate so this
// file (and test/helpers/mockRepos.ts's in-memory doubles) don't depend on
// those modules' types directly. server/persistence/hydrate.ts's own
// HydrateRepos is narrower still (read-only) -- these three add the write
// side hydrate.ts never needs but the dual-write step below does.
export interface HeroRepo {
  loadAllForGame(gameName: string): Promise<HeroState[]>;
  upsertMany(gameName: string, heroes: Record<HeroId, HeroState>): Promise<void>;
}
export interface SettlementRepo {
  loadAllForGame(gameName: string): Promise<SettlementState[]>;
  upsertMany(gameName: string, settlements: Record<SettlementId, SettlementState>): Promise<void>;
}
export interface CharterRepo {
  loadAllForGame(gameName: string): Promise<CharterState[]>;
  upsertMany(gameName: string, charters: CharterState[]): Promise<void>;
}

export interface CommandDeps {
  gameRepo: GameRepo;
  eventRepo: EventRepo;
  heroRepo: HeroRepo;
  settlementRepo: SettlementRepo;
  charterRepo: CharterRepo;
  ctx: EngineCtx;
}

// Live (Postgres) deps additionally carry the pool that the repos above
// were built from. handleCommandTransactional needs it to acquire a
// PoolClient per request for the SELECT ... FOR UPDATE + atomic
// save+event-append flow; the in-memory mockRepos tests don't (and
// can't) exercise the transactional wrapper, so this field is optional
// in the broader CommandDeps type.
export interface LiveCommandDeps extends CommandDeps {
  pool: import("pg").Pool;
}

export interface CommandResult {
  ok: boolean;
  reason?: string;
  events: EngineEvent[];
  // game_events.id of the last event this command's own writes caused
  // (undefined on a failed command, which appends nothing). Lets the caller
  // advance its poll cursor past its own writes instead of re-fetching and
  // re-applying them on the next GET .../events?after= poll.
  lastEventId?: number;
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

// Phase 4 Track A dual-write (plan/2026-08-17-phase-4-db-deblobbing-dev-plan.md):
// upsertMany is a full sync (deletes rows missing from the given record),
// so we use reference-equality against pre-command state to decide which
// repo(s) actually need syncing, rather than risk a filtered subset that
// would silently delete untouched rows.
async function dualWriteEntities(
  deps: CommandDeps,
  gameName: string,
  before: { heroes: Record<HeroId, HeroState>; settlements: Record<SettlementId, SettlementState> },
  after: { heroes: Record<HeroId, HeroState>; settlements: Record<SettlementId, SettlementState> },
): Promise<void> {
  const writes: Promise<void>[] = [];
  if (after.heroes !== before.heroes) {
    writes.push(deps.heroRepo.upsertMany(gameName, after.heroes));
  }
  if (after.settlements !== before.settlements) {
    writes.push(deps.settlementRepo.upsertMany(gameName, after.settlements));
  }
  await Promise.all(writes);
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

  // Phase 4 Track A read-path cutover (plan/2026-08-17-phase-4-db-deblobbing-dev-plan.md):
  // granular-first, with a per-game fallback to the legacy JSONB row
  // (hydrateGameState(row), unchanged) when a game's heroes/settlements
  // granular tables are both still empty. See server/persistence/hydrate.ts
  // for the full rationale; `source` isn't consumed here today (nothing
  // branches on it) but is available for callers that want it later
  // (e.g. an eventual metrics counter) without changing this call site again.
  //
  // Note for whoever touches this next: several cases below still read
  // command.actor's target hero/settlement off `row` directly (the raw
  // JSONB row) for their own existence/ownership/position pre-checks --
  // MoveHero's staleness guard, TradeResources/ResolveBattle/UpgradeTownHall/
  // SetAutoTrade/ReorderStack/CaptureSettlement's "does this exist"/
  // ownership checks -- rather than reading the same thing off `state`
  // (which may now be granular-sourced). That's intentional, not an
  // oversight introduced by this cutover: `row` and the granular tables are
  // value-identical for any game dualWriteEntities has ever touched (both
  // are written together, same transaction), so those checks see the same
  // answer either way in real operation. It only matters for a
  // hypothetically inconsistent game, which shouldn't be reachable (see
  // hydrate.ts's own comment on why). Left as `row` rather than switched to
  // `state` to keep this cutover's diff to hydration + dual-write only,
  // not a rewrite of Phase 3's pre-existing per-command validation.
  const { state, source } = await hydrateFromRepos(row, deps, command.gameName);

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
      await dualWriteEntities(deps, command.gameName, state, result.state);
      const event: EngineEvent = {
        type: "HeroMoved",
        actor: command.actor,
        heroId: command.heroId,
        to: command.toTile,
      };
      const lastEventId = await deps.eventRepo.append(command.gameName, event.type, event, command.actor);
      return { ok: true, events: [event], lastEventId, hero: result.state.heroes[command.heroId] };
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
      await dualWriteEntities(deps, command.gameName, state, result.state);
      const event: EngineEvent = {
        type: "GoldTransferred",
        actor: command.actor,
        heroId: command.heroId,
        settlementId: command.settlementId,
        direction: command.direction,
      };
      const lastEventId = await deps.eventRepo.append(command.gameName, event.type, event, command.actor);
      return {
        ok: true,
        events: [event],
        lastEventId,
        hero: result.state.heroes[command.heroId],
        settlement: result.state.settlements[command.settlementId],
      };
    }
    case "EndTurn": {
      // See server/app/turnService.ts for the pipeline itself and its
      // documented charter-advancement limitation (no DB column for
      // activeCharters yet).
      const { state: finalState, wrapped, transfers } = runEndTurn(state, clampGrowthRate(command.growthRate));
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
      // advanceRound() internally runs advanceCharters() (days-remaining
      // countdown + settlement founding) whenever this EndTurn wraps the
      // round -- persist whatever it did to finalState.activeCharters the
      // same way dualWriteEntities just did for heroes/settlements.
      // Gated on the granular hydration source: if hydrate fell back to
      // JSONB (heroes/settlements granular tables empty, partial/inconsistent
      // state), state.activeCharters is [] regardless of what's in the
      // charters table, and a full-sync upsertMany([]) would silently
      // delete those real rows. Falls back to JSONB? Don't touch charters.
      if (source === "granular") {
        await deps.charterRepo.upsertMany(command.gameName, finalState.activeCharters);
      }
      await dualWriteEntities(deps, command.gameName, state, finalState);
      // #89: the old /end-turn route wrote one settlement_snapshots row
      // per settlement owned by the ending player (day/gold/warehouse/
      // morale/effective_income), and one resource_transactions row per
      // auto-trade transfer -- on every single turn end, not just on a
      // round wrap. That stopped happening the moment this command
      // replaced the old route (PR #86/#87); this restores it, computed
      // from the same finalState/transfers this case already has instead
      // of re-deriving anything. day is finalState.day on a round wrap
      // (the new day just started) or row.day otherwise (day doesn't
      // change on a simple next-player advance) -- there's no
      // client-submitted incomingState.day to fall back to anymore the
      // way the old route had.
      const snapshotDay = wrapped ? finalState.day : (row.day ?? finalState.day);
      const snapshots: SettlementSnapshotInput[] = Object.entries(finalState.settlements)
        .filter(([, s]) => s.ownerId === command.actor)
        .map(([settlementId, s]) => ({
          settlementId,
          day: snapshotDay,
          gold: Number(s.gold) || 0,
          warehouse: s.warehouse,
          // effectiveIncome() is the same @heroes/engine function
          // applyEndOfTurnDetailed() itself already used to update
          // s.gold this turn (economy/consumption.ts) -- reusing it here
          // instead of re-deriving the population*goldTax*morale formula
          // inline the way the old route did.
          morale: Math.round(clampMorale(s.morale ?? 100)),
          effectiveIncome: effectiveIncome(s),
        }));
      await deps.gameRepo.insertSettlementSnapshots(command.gameName, snapshots);
      // AutoTradeTransfer (packages/contracts/src/gameState.ts) is a
      // structural match for ResourceTransactionInput (fromSettlementId/
      // toSettlementId/resource/amount/goldPaid) -- transfers passes
      // straight through, `reason` defaults to "auto_trade" in the repo
      // method itself, same as the old route's hardcoded literal.
      await deps.gameRepo.insertResourceTransactions(command.gameName, transfers);
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
      let lastEventId = await deps.eventRepo.append(command.gameName, event.type, event, command.actor);
      // In addition to that, preserve the old /end-turn route's exact
      // game_events `kind` strings (turn_ended/round_ended/round_started/
      // ai_turn_started) as their own rows -- nothing in this codebase
      // currently reads game_events by kind (confirmed: GET
      // /games/:name/events has no client caller yet), but keeping the
      // same audit-trail shape is free and avoids silently changing it
      // for whatever eventually does. lastEventId is reassigned through
      // each of these so it ends up holding the highest id this command
      // caused, whichever of these ends up being the last one appended.
      lastEventId = await deps.eventRepo.append(command.gameName, "turn_ended", {
        playerId: command.actor,
        round: row.round,
      }, command.actor);
      if (wrapped) {
        lastEventId = await deps.eventRepo.append(command.gameName, "round_ended", { round: row.round }, command.actor);
        // Not attributable to a single seat -- see
        // server/migrations/010_event_seq.sql's header comment.
        lastEventId = await deps.eventRepo.append(command.gameName, "round_started", { round: finalState.round }, null);
      }
      const nextPlayer = finalState.players.find((p) => p.id === finalState.activePlayerId);
      if (nextPlayer?.faction === "ai") {
        lastEventId = await deps.eventRepo.append(command.gameName, "ai_turn_started", {
          playerId: finalState.activePlayerId,
          round: finalState.round,
        }, null);
      }
      return {
        ok: true,
        events: [event],
        lastEventId,
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
      await dualWriteEntities(deps, command.gameName, state, result.state);
      const event: EngineEvent = {
        type: "ResourcesTraded",
        actor: command.actor,
        fromSettlementId: command.fromSettlementId,
        toSettlementId: command.toSettlementId,
        resource: command.resource,
        amount: command.amount,
      };
      const lastEventId = await deps.eventRepo.append(command.gameName, event.type, event, command.actor);
      return {
        ok: true,
        events: [event],
        lastEventId,
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
      // A chartering hero can end up as either combatant (traveling heroes
      // can walk adjacent to an enemy mid-route; constructing heroes can be
      // attacked at their target) -- mirrors src/state/turnController.ts's
      // own resolveCurrentBattle(), which likewise only checks the
      // DEFENDER's defeat this way (an attacker losing while chartering
      // isn't handled there either; matched as-is rather than expanding
      // scope beyond that existing client behavior).
      let finalActiveCharters = state.activeCharters;
      if (battle.defenderOutcome === "lost_all_troops") {
        finalActiveCharters = cleanupDefeatedHeroCharters(
          { ...state, heroes: newHeroes },
          command.defenderId,
        ).activeCharters;
      }
      await deps.gameRepo.saveHeroesAndSettlements(
        command.gameName,
        newHeroes,
        state.settlements,
        { gold: legacyGold },
      );
      // settlements is passed through unchanged (state.settlements, same
      // reference) -- ResolveBattle never touches settlement state, only
      // the two combatants' hero rows, so this only ever calls heroRepo.
      await dualWriteEntities(deps, command.gameName, state, { heroes: newHeroes, settlements: state.settlements });
      if (finalActiveCharters !== state.activeCharters && source === "granular") {
        // Source gate matches the EndTurn case above: on JSONB fallback,
        // state.activeCharters is always [] regardless of the charters
        // table's real contents, so an upsertMany([]) here would silently
        // delete them. (finalActiveCharters !== state.activeCharters gates
        // out the common case where the defender either survived or wasn't
        // chartering; the source gate is what catches the fallback path.)
        await deps.charterRepo.upsertMany(command.gameName, finalActiveCharters);
      }
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
      const lastEventId = await deps.eventRepo.append(command.gameName, event.type, event, command.actor);
      return {
        ok: true,
        events: [event],
        lastEventId,
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
      await dualWriteEntities(deps, command.gameName, state, result.state);
      const event: EngineEvent = {
        type: "HeroRecruited",
        actor: command.actor,
        heroId: result.hero.id,
        name: result.hero.name,
        settlementId: command.settlementId,
        horseVariant: command.horseVariant,
      };
      const lastEventId = await deps.eventRepo.append(command.gameName, event.type, event, command.actor);
      return { ok: true, events: [event], lastEventId, hero: result.hero, players: result.state.players };
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
      await dualWriteEntities(deps, command.gameName, state, result.state);
      const event: EngineEvent = {
        type: "TownHallUpgradeStarted",
        actor: command.actor,
        settlementId: command.settlementId,
        targetLevel: command.targetLevel,
      };
      const lastEventId = await deps.eventRepo.append(command.gameName, event.type, event, command.actor);
      return { ok: true, events: [event], lastEventId, settlement: result.state.settlements[command.settlementId] };
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
      await dualWriteEntities(deps, command.gameName, state, nextState);
      const event: EngineEvent = {
        type: "AutoTradeToggled",
        actor: command.actor,
        settlementId: command.settlementId,
        autoTrade: command.autoTrade,
      };
      const lastEventId = await deps.eventRepo.append(command.gameName, event.type, event, command.actor);
      return { ok: true, events: [event], lastEventId, settlement: nextState.settlements[command.settlementId] };
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
      await dualWriteEntities(deps, command.gameName, state, result.state);
      const event: EngineEvent = {
        type: "StackReordered",
        actor: command.actor,
        heroId: command.heroId,
        fromIdx: command.fromIdx,
        toIdx: command.toIdx,
      };
      const lastEventId = await deps.eventRepo.append(command.gameName, event.type, event, command.actor);
      return { ok: true, events: [event], lastEventId, hero: result.state.heroes[command.heroId] };
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
      await dualWriteEntities(deps, command.gameName, state, result.state);
      const event: EngineEvent = {
        type: "SettlementCaptured",
        actor: command.actor,
        heroId: command.heroId,
        settlementId: command.settlementId,
        previousOwnerId: result.previousOwnerId,
      };
      const lastEventId = await deps.eventRepo.append(command.gameName, event.type, event, command.actor);
      return {
        ok: true,
        events: [event],
        lastEventId,
        hero: result.state.heroes[command.heroId],
        settlement: result.state.settlements[command.settlementId],
        players: result.state.players,
      };
    }
    case "StartCharter": {
      // Source gate FIRST: on JSONB fallback hydrateFromRepos() can't see
      // real charters in the charters table, so persisting one would race
      // against rows hydrate can't know about. Reject before any side
      // effects (hero gold/warehouse deduction, settlement warehouse
      // update, counter increments) so a rejected StartCharter leaves the
      // DB exactly as it was -- EndTurn/ResolveBattle's same gate runs
      // AFTER their engine pipeline because those pipelines only touch
      // heroes/settlements (which have the JSONB column as
      // source-of-truth), but StartCharter's writes touch a table
      // (charters) that hydrate-on-fallback literally cannot see.
      if (source !== "granular") {
        return { ok: false, reason: "charters_persist_unavailable", events: [] };
      }
      // No command reconstructs a GameMap server-side before this one --
      // row.seed/row.map_size (both already selected by GAME_COLUMNS) are
      // exactly what server/routes.ts's generateAndInsertTiles() used to
      // produce this same game's persisted `tiles` rows at creation time
      // (new GameMap(seed, mapSize) there too), so this reconstructs a
      // byte-identical map deterministically -- pinned down by
      // test/server/gameMapReconstruction.test.ts.
      const map = new GameMap(row.seed, row.map_size as MapSize | undefined);
      if (!map.isPassable(command.targetQ, command.targetR)) {
        return { ok: false, reason: "impassable_terrain", events: [] };
      }
      // Mirrors src/state/turnController.ts's own startCharter() pre-checks:
      // @heroes/engine's startCharter() (packages/engine/src/charter/
      // start.ts) has no notion of terrain or map distance at all -- only
      // the client's caller ever enforced either of these two.
      for (const s of Object.values(state.settlements)) {
        if (hexDistance({ q: command.targetQ, r: command.targetR }, { q: s.q, r: s.r }) < 4) {
          return { ok: false, reason: "too_close_to_settlement", events: [] };
        }
      }
      const computed = computeSettlementRates(map, command.targetQ, command.targetR, 1);
      const { spots } = generateCitySpots(cityViewSizeFor(1), deps.ctx.rng);
      // Unlike recruitHero() (self-allocating), startCharter() does not
      // allocate settlementId/charterId itself -- see
      // packages/contracts/src/commands/startCharter.ts's header comment.
      // This is the caller, building both from server-authoritative
      // counters (state.nextCharterId/nextSettlementId) instead of
      // trusting anything the client computed for its own local preview.
      const payload: StartCharterPayload = {
        heroId: command.heroId,
        targetQ: command.targetQ,
        targetR: command.targetR,
        settlementName: command.settlementName,
        settlementId: `s${state.nextSettlementId}`,
        charterId: `ch${state.nextCharterId}`,
        resourceRates: computed.rates,
        foundedOnResource: computed.foundedOn,
        citySpots: spots,
      };
      const result = startCharter(state, payload);
      if (!result.ok) {
        return { ok: false, reason: result.reason, events: [] };
      }
      await deps.gameRepo.saveHeroesAndSettlements(
        command.gameName,
        result.state.heroes,
        result.state.settlements,
        {
          next_charter_id: result.state.nextCharterId,
          next_settlement_id: result.state.nextSettlementId,
        },
      );
      await dualWriteEntities(deps, command.gameName, state, result.state);
      // The one call this whole port exists to add: activeCharters gained
      // a new entry, and (unlike heroes/settlements) it has no legacy
      // JSONB column to fall back on -- charterRepo is its only home.
      await deps.charterRepo.upsertMany(command.gameName, result.state.activeCharters);
      const event: EngineEvent = {
        type: "CharterStarted",
        actor: command.actor,
        heroId: command.heroId,
        charterId: payload.charterId,
        settlementId: payload.settlementId,
        targetQ: command.targetQ,
        targetR: command.targetR,
      };
      const lastEventId = await deps.eventRepo.append(command.gameName, event.type, event, command.actor);
      return { ok: true, events: [event], lastEventId, hero: result.state.heroes[command.heroId] };
    }
    case "UpgradeBuilding": {
      const settlement = row.settlements[command.settlementId];
      if (!settlement) {
        return { ok: false, reason: "no_settlement", events: [] };
      }
      // startBuildingUpgrade() never checks ownership itself, same gap as
      // UpgradeTownHall.
      if (settlement.ownerId !== command.actor) {
        return { ok: false, reason: "forbidden_not_your_settlement", events: [] };
      }
      const result = startBuildingUpgrade(state, command.settlementId, command.requests);
      if (!result.ok) {
        return { ok: false, reason: result.reason, events: [] };
      }
      await deps.gameRepo.saveHeroesAndSettlements(
        command.gameName,
        result.state.heroes,
        result.state.settlements,
      );
      await dualWriteEntities(deps, command.gameName, state, result.state);
      const event: EngineEvent = {
        type: "BuildingUpgradeStarted",
        actor: command.actor,
        settlementId: command.settlementId,
      };
      const lastEventId = await deps.eventRepo.append(command.gameName, event.type, event, command.actor);
      return { ok: true, events: [event], lastEventId, settlement: result.state.settlements[command.settlementId] };
    }
    case "UpgradeSettlement": {
      const settlement = row.settlements[command.settlementId];
      if (!settlement) {
        return { ok: false, reason: "no_settlement", events: [] };
      }
      // startSettlementUpgrade() never checks ownership itself, same gap as
      // UpgradeTownHall/UpgradeBuilding.
      if (settlement.ownerId !== command.actor) {
        return { ok: false, reason: "forbidden_not_your_settlement", events: [] };
      }
      // targetLevel is derived server-side, not client-supplied -- same
      // reasoning StartCharter uses for settlementId/charterId above.
      const targetLevel = ((state.settlements[command.settlementId]?.level ?? settlement.level) + 1) as 2 | 3;
      // Same GameMap reconstruction StartCharter uses above (row.seed/
      // row.map_size reproduce the persisted map byte-identically; pinned
      // by test/server/gameMapReconstruction.test.ts).
      const map = new GameMap(row.seed, row.map_size as MapSize | undefined);
      const computed = computeSettlementRates(map, settlement.q, settlement.r, targetLevel);
      const { spots } = generateCitySpots(cityViewSizeFor(targetLevel), deps.ctx.rng);
      const newCitySpots = spots.filter(
        (spot) =>
          !settlement.citySpots.some((cs) => cs.cell.x === spot.cell.x && cs.cell.y === spot.cell.y),
      );
      const result = startSettlementUpgrade(
        state,
        command.settlementId,
        targetLevel,
        computed.rates,
        newCitySpots,
        // upgradePopulationGate is trusted from the client -- see
        // packages/contracts/src/commands/upgradeSettlement.ts's header
        // comment for why this is a deliberate, temporary exception.
        command.upgradePopulationGate,
      );
      if (!result.ok) {
        return { ok: false, reason: result.reason, events: [] };
      }
      await deps.gameRepo.saveHeroesAndSettlements(
        command.gameName,
        result.state.heroes,
        result.state.settlements,
      );
      await dualWriteEntities(deps, command.gameName, state, result.state);
      const event: EngineEvent = {
        type: "SettlementUpgradeStarted",
        actor: command.actor,
        settlementId: command.settlementId,
        targetLevel,
      };
      const lastEventId = await deps.eventRepo.append(command.gameName, event.type, event, command.actor);
      return { ok: true, events: [event], lastEventId, settlement: result.state.settlements[command.settlementId] };
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
export async function createLiveCommandDeps(): Promise<LiveCommandDeps> {
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
    heroRepo: createHeroRepo(pool),
    settlementRepo: createSettlementRepo(pool),
    charterRepo: createCharterRepo(pool),
    pool,
    ctx: { rng: mulberry32(Date.now() >>> 0), catalog: { unitTypes } },
  };
}

// Transactional wrapper around handleCommand for the live (Postgres)
// path. Closes the gap the retired /trade and /resolve-battle routes used
// to close with their own withTransaction block: state mutation, event
// append, and any concurrent-command serialization now happen as one
// atomic unit instead of as three independent pool queries (where a
// failure between them could persist state without its event, and where
// two concurrent commands against the same game could each load the
// pre-state, mutate, and last-write-win over each other).
//
// Phase 3 scope (plan/2026-08-16-phase-3-parallel-dev-plan.md § "What's
// actually broken today" /trade row: "just needs the transaction/
// persistence step generalized"; parallel-dev-phases-3-5.md §4 Phase 3
// names commandHandler.ts "the central transaction loop"). A version
// column for optimistic concurrency on the games row is intentionally
// NOT added here -- that's a schema change and belongs to Phase 4
// (parallel-dev-phases-3-5.md §4 Phase 4: Database De-blobbing). The
// pessimistic SELECT ... FOR UPDATE below is the right primitive for
// Phase 3's needs and matches what server/routes.ts's now-retired
// /trade and /resolve-battle already did.
export async function handleCommandTransactional(
  command: Command,
  deps: LiveCommandDeps,
): Promise<CommandResult> {
  // Implemented inline (rather than via ../persistence/db's withTransaction
  // helper) because that helper closes over the *global* pool imported at
  // module load, while this wrapper is intentionally pool-agnostic --
  // LiveCommandDeps carries the pool so tests can drive it against a
  // fake PoolClient without spinning up Postgres. Same BEGIN/COMMIT/
  // ROLLBACK semantics as withTransaction, same console.error on rollback.
  const client = await deps.pool.connect();
  try {
    await client.query("BEGIN");
    // Pessimistic row lock on games.name = command.gameName. SELECT FOR
    // UPDATE locks the matching row (if any) for the duration of this
    // transaction; a second concurrent command against the same game
    // blocks here until COMMIT/ROLLBACK, so it then sees the post-state
    // and re-runs validation against it. Without this, two
    // MoveHero/TradeResources/whatever commands issued in the same
    // millisecond each load the pre-state, each compute their own delta,
    // and each issue saveHeroesAndSettlements; the second write silently
    // clobbers the first.
    //
    // rowCount === 0 is NOT an error here: FOR UPDATE on a non-existent
    // row is a no-op (nothing to lock). handleCommand -> gameRepo.load
    // throws GameNotFoundError below if the row truly doesn't exist,
    // which rolls the transaction back naturally.
    await client.query("SELECT id FROM games WHERE name = $1 FOR UPDATE", [
      command.gameName,
    ]);
    const requestDeps: CommandDeps = {
      gameRepo: createGameRepo(client),
      eventRepo: createEventRepo(client),
      heroRepo: createHeroRepo(client),
      settlementRepo: createSettlementRepo(client),
      charterRepo: createCharterRepo(client),
      ctx: deps.ctx,
    };
    const result = await handleCommand(command, requestDeps);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    console.error("[api] handleCommandTransactional rolling back:", err);
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Re-export so callers (server/http/routes/commands.ts) can match the
// retired /trade + /resolve-battle routes' own "game not found" 404
// detection without needing to import the persistence layer directly.
export { GameNotFoundError };

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
