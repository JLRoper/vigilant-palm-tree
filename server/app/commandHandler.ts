import {
  startMove,
transferGold,
  depositIntoBank,
  requestBankWithdrawal,
  mulberry32,
  resolveBattle as resolveBattleEngine,
  normalizePlatoons,
  detectAdjacentEnemy,
  cancelMove,
  recruitHero,
  startTownHallUpgrade,
  setAutoTrade,
  reorderStack,
  captureSettlement,
  recruitUnits,
  transferUnits,
  applySettlementBattleResult,
  settlementStacks,
  platoonsHaveTroops,
  effectiveIncome,
  clampMorale,
  GameMap,
  computeSettlementRates,
  cityViewSizeFor,
  foodBiasForTerrain,
  generateCitySpots,
  startCharter,
  stepTravelCharter,
  cleanupDefeatedHeroCharters,
  startBuildingUpgrade,
  startSettlementUpgrade,
  applyPlaceBuildings,
  transferResources,
  assignWagons,
  transferCargoLoot,
  buyWagons,
  createTradeRoute as createTradeRouteReducer,
  updateTradeRoute as updateTradeRouteReducer,
  endpointOwner,
  deriveHeroVerdict,
  nearestOwnedSettlement,
  relocateHeroToSettlement,
} from "@heroes/engine";
import type { EngineCtx, HydratableGameRow, UnitType, BattleResult, MapSize } from "@heroes/engine";
import { hexDistance } from "@heroes/contracts";
import type {
  CharterState,
  Command,
  EngineEvent,
  GameState,
  HeroBattleVerdict,
  HeroId,
  HeroState,
  Player,
  Platoon,
  TradeRouteState,
  SettlementId,
  SettlementState,
  StartCharterPayload,
} from "@heroes/contracts";
import { runEndTurn, clampGrowthRate, removedTradeRouteIds } from "./turnService";
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
//
// The row this interface returns carries the slice of the lobby jsonb the
// command cases read. `legacyAutoTrade` is the instant auto-trade gate
// (2026-10-02): ABSENT means true, so every pre-flag save keeps firing
// auto-trade; POST /games writes false on new games.
export interface GameLobbyFlags {
  legacyAutoTrade?: boolean;
}

export interface GameRepo {
  load(name: string): Promise<HydratableGameRow & { lobby?: GameLobbyFlags }>;
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
        trade_routes?: TradeRouteState[];
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
  // EndTurn + PlaceBuildings/CreateTradeRoute/UpdateTradeRoute: the full
  // post-change routes array (caravans move on EndTurn's round wrap).
  tradeRoutes?: TradeRouteState[];
  // ResolveBattle/SubmitBattleResult: both combatants plus the full engine
  // BattleResult the client's battle UI needs (log, grid, per-round detail) --
  // none of that is reconstructable from the summary fields on the persisted
  // BattleResolved event alone. Both hero fields are OPTIONAL as of
  // hero-outcomes plan W1: a defeated side's hero row is deleted, so only
  // survivors come back; the verdicts carry the retreat/surrender
  // discrimination the client can't re-derive from the event outcomes (D5).
  attackerHero?: HeroState;
  defenderHero?: HeroState;
  attackerVerdict?: HeroBattleVerdict;
  defenderVerdict?: HeroBattleVerdict;
  battle?: BattleResult;
}

// Legacy `gold` column is the sum of all players' purses (backward compat
// with reads that predate the heroes/settlements JSONB columns).
//
// Single definition since the legacy `POST /games/:name/end-turn` route was
// retired -- server/routes.ts's own private copy of this function went with it
// (docs/event-system.md, "2026-09-30 organization pass"), so there is nothing
// left to import it from or drift against.
//
// The returned total is deliberately NOT rounded here. Gold values are
// legitimately 2-decimal floats in the engine (produceResources' round2, and
// auto-trade paying a fractional food amount out of a treasury), and this
// function is the exact accounting sum of them. The rounding to the column's
// INTEGER type happens once, at the write boundary, in
// server/persistence/integerColumns.ts -- see that file's header for why an
// unrounded write aborted the whole command (the every-EndTurn-500 bug).
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

// ---------------------------------------------------------------------------
// Shared post-battle application (plan/2026-09-27-manual-battle-wiring.md,
// work item 4): the two battle-outcome commands -- ResolveBattle (server-run
// auto-resolver) and SubmitBattleResult (client-played manual arena) -- must
// apply IDENTICAL world rules once a result exists. Both used to inline this
// logic in the ResolveBattle case only; it's factored out here so the manual
// path can't drift from the auto path the way the two painter sets did
// (see src/render/docs/technical-spec.md §7.3 for that lesson).
//
// buildPostBattleHeroes is the pure half: survivor stacks onto the hero pair
// plus the one asymmetric gold rule (a defender who lost every troop is
// looted down to 0 and the attacker pockets the purse). applyHeroBattleOutcomes
// is the hero-outcomes half (plan/2026-09-29-hero-outcomes.md, W2a): defeat
// deletes the hero from the record and prunes their owner's heroIds; retreat
// empties stacks and relocates to the nearest owned settlement; surrender
// relocates keeping stacks. persistBattleOutcome is the I/O half: charter
// cleanup for every removed hero, legacy-gold accounting, the row save (always
// carrying players, so the heroIds prune persists), and the granular
// dual-write -- including the same JSONB-fallback charter gate
// EndTurn/ResolveBattle/StartCharter use.
// ---------------------------------------------------------------------------

  function buildPostBattleHeroes(
    allHeroes: Record<HeroId, HeroState>,
    attackerHero: HeroState,
    defenderHero: HeroState,
    attackerStacks: Platoon[],
    defenderStacks: Platoon[],
    defenderLostAllTroops: boolean,
  ): { heroes: Record<HeroId, HeroState>; lootedGold: number } {
    // This helper still only sets survivor stacks and the wipe-loot gold:
    // actual hero removal/relocation is applyHeroBattleOutcomes' job, which
    // runs on its output so loot (gold + cargo) is transferred to the winner
    // BEFORE the loser is deleted from the record (plan/2026-09-29-hero-
    // outcomes.md -- winner-takes-loot survives the defeat removal).
    if (defenderLostAllTroops) {
      // Winner-takes-loot, now wagon-capped (docs/wagons-stockpiles-trade-
      // routes-plan.md §4.2): the attacker pockets as much of the purse as
      // fits their gold cap and loots the defender's cargo up to their own
      // cargo caps. A winner already at cap leaves the loser's gold intact
      // -- soft caps never destroy.
      const normalized = {
        ...allHeroes,
        [attackerHero.id]: { ...attackerHero, gold: Number(attackerHero.gold) || 0 },
        [defenderHero.id]: { ...defenderHero, gold: Number(defenderHero.gold) || 0 },
      };
      const loot = transferCargoLoot(normalized, attackerHero.id, defenderHero.id);
      const heroes: Record<HeroId, HeroState> = { ...loot.heroes };
      heroes[attackerHero.id] = { ...heroes[attackerHero.id], stacks: attackerStacks };
      heroes[defenderHero.id] = { ...heroes[defenderHero.id], stacks: defenderStacks };
      return { heroes, lootedGold: loot.gold };
    }
    const heroes: Record<HeroId, HeroState> = { ...allHeroes };
    heroes[attackerHero.id] = {
      ...attackerHero,
      stacks: attackerStacks,
    };
    heroes[defenderHero.id] = {
      ...defenderHero,
      stacks: defenderStacks,
    };
    return { heroes, lootedGold: 0 };
  }

// Hero-outcomes application (plan/2026-09-29-hero-outcomes.md, W2a): maps the
// two per-side verdicts onto the heroes record AFTER buildPostBattleHeroes has
// run (winner-takes-loot fires there, BEFORE the loser is removed below).
//   "defeated"    -> hero deleted from the record + pruned from their owner's
//                    player.heroIds. The granular heroes upsert is a full sync,
//                    so the row (and, with heroRepo's platoon NOT-IN sweep, its
//                    hero_platoons rows) falls out of the DB for free.
//   "retreated"   -> stacks emptied server-side regardless of what the arena
//                    submitted (retreat loses ALL troops; the arena's
//                    pre-submitted 15%-loss stacks are subsumed), then the
//                    hero relocated to the nearest settlement their owner
//                    holds -- or left at the post-battle position (post-
//                    cancelMove for the manual path) when the owner holds
//                    none (plan D1).
//   "surrendered" -> same relocation, keeping the submitted stacks (the
//                    surrender gold deduction is the caller's, applied before
//                    this helper so the relocated copy carries it).
//   "stood"       -> untouched.
// The returned players array carries the heroIds prune so persistBattleOutcome
// can always save players.
function applyHeroBattleOutcomes(
  battleHeroes: Record<HeroId, HeroState>,
  players: Player[],
  settlements: Record<SettlementId, SettlementState>,
  verdicts: {
    attackerId: HeroId;
    defenderId: HeroId;
    attackerVerdict: HeroBattleVerdict;
    defenderVerdict: HeroBattleVerdict;
  },
): {
  heroes: Record<HeroId, HeroState>;
  players: Player[];
  removedHeroIds: HeroId[];
} {
  let heroes = { ...battleHeroes };
  let nextPlayers = players;
  const removedHeroIds: HeroId[] = [];
  const apply = (heroId: HeroId, verdict: HeroBattleVerdict): void => {
    const hero = heroes[heroId];
    if (!hero) return;
    if (verdict === "defeated") {
      const remaining = { ...heroes };
      delete remaining[heroId];
      heroes = remaining;
      nextPlayers = nextPlayers.map((p) =>
        p.id === hero.ownerId && p.heroIds.includes(heroId)
          ? { ...p, heroIds: p.heroIds.filter((id) => id !== heroId) }
          : p,
      );
      removedHeroIds.push(heroId);
      return;
    }
    if (verdict === "retreated" || verdict === "surrendered") {
      // Zero the denormalized troops counter along with the stacks: a
      // retreat must not leave hero.troops reading its pre-battle total
      // while stacks are empty.
      const postBattleHero =
        verdict === "retreated" ? { ...hero, stacks: normalizePlatoons([]), troops: 0 } : hero;
      const nearest = nearestOwnedSettlement({ settlements }, postBattleHero);
      heroes = {
        ...heroes,
        [heroId]: nearest ? relocateHeroToSettlement(postBattleHero, nearest) : postBattleHero,
      };
    }
  };
  apply(verdicts.attackerId, verdicts.attackerVerdict);
  apply(verdicts.defenderId, verdicts.defenderVerdict);
  return { heroes, players: nextPlayers, removedHeroIds };
}

// Charter cleanup for EVERY removed hero (plan/2026-09-29-hero-outcomes.md
// extends the old defender-wipe-only call): a chartering hero removed by
// defeat must not leave an orphaned charter row, whether they were the
// attacker or the defender. cleanupDefeatedHeroCharters() reads the hero off
// state.heroes, so the fold runs against the PRE-removal battle record; a
// non-chartering hero is a reference-stable no-op, keeping
// persistBattleOutcome's !== + granular-source gate quiet on the common path.
function foldRemovedHeroCharters(
  state: GameState,
  battleHeroes: Record<HeroId, HeroState>,
  removedHeroIds: HeroId[],
): CharterState[] {
  let activeCharters = state.activeCharters;
  for (const heroId of removedHeroIds) {
    activeCharters = cleanupDefeatedHeroCharters(
      { ...state, heroes: battleHeroes, activeCharters },
      heroId,
    ).activeCharters;
  }
  return activeCharters;
}

// Post-battle capture (unit-recruitment/garrison plan task 7): after a
// hero-vs-hero battle, an attacker who kept the collision hex (never
// cancelMove'd -- retreat/surrender restored their pre-move position
// instead), still has troops, and stands on an enemy-owned settlement whose
// garrison is empty, captures it in the same persist -- owner flip +
// CAPTURE_GOLD_REWARD, identical to a walk-in CaptureSettlement. Returns
// null whenever no settlement hex qualifies (the overwhelmingly common
// case, and always for the existing battle tests' rows).
function applyPostBattleCapture(
  state: GameState,
  attackerId: HeroId,
  heroes: Record<HeroId, HeroState>,
): { heroes: Record<HeroId, HeroState>; settlements: Record<SettlementId, SettlementState>; players: Player[] } | null {
  const attacker = heroes[attackerId];
  if (!attacker) return null;
  if (!platoonsHaveTroops(normalizePlatoons(attacker.stacks))) return null;
  const settlement = Object.values(state.settlements).find(
    (s) =>
      s.q === attacker.q &&
      s.r === attacker.r &&
      s.ownerId !== null &&
      s.ownerId !== attacker.ownerId,
  );
  if (!settlement) return null;
  if (platoonsHaveTroops(settlementStacks(settlement))) return null;
  const capture = captureSettlement({ ...state, heroes }, attackerId, settlement.id);
  if (!capture.captured) return null;
  return {
    heroes: capture.state.heroes,
    settlements: capture.state.settlements,
    players: capture.state.players,
  };
}

async function persistBattleOutcome(
  deps: CommandDeps,
  gameName: string,
  state: GameState,
  source: "granular" | "jsonb",
  newHeroes: Record<HeroId, HeroState>,
  players: Player[],
  activeCharters: CharterState[],
  capture?: {
    heroes: Record<HeroId, HeroState>;
    settlements: Record<SettlementId, SettlementState>;
    players: Player[];
  } | null,
): Promise<void> {
  const finalHeroes = capture ? capture.heroes : newHeroes;
  const finalSettlements = capture ? capture.settlements : state.settlements;
  const finalPlayers = capture ? capture.players : players;
  const legacyGold = sumPlayerGold(
    finalPlayers,
    finalHeroes,
    finalSettlements,
  );
  await deps.gameRepo.saveHeroesAndSettlements(
    gameName,
    finalHeroes,
    finalSettlements,
    {
      gold: legacyGold,
      // players ride every battle persist now (hero-outcomes plan W2a): a
      // defeat prunes the removed hero from their owner's heroIds, and the
      // old capture-only conditional left that prune unpersisted whenever no
      // capture happened. capture.players already carry it (the capture is
      // fed the pruned array); this branch covers every other outcome.
      players: finalPlayers,
    },
  );
  // settlements is state.settlements unless a post-battle capture flipped
  // an owner -- in which case the capture's settlements record (and the
  // players array above) ride the same persist, so the granular dual-write
  // below syncs both halves of the capture in one transaction.
  await dualWriteEntities(deps, gameName, state, { heroes: finalHeroes, settlements: finalSettlements });
  if (activeCharters !== state.activeCharters && source === "granular") {
    // Source gate matches the EndTurn case above: on JSONB fallback,
    // state.activeCharters is always [] regardless of the charters
    // table's real contents, so an upsertMany([]) here would silently
    // delete them. (activeCharters comes in already folded by
    // foldRemovedHeroCharters; the !== reference gate passes it through
    // untouched when no removed hero was chartering.)
    await deps.charterRepo.upsertMany(gameName, activeCharters);
  }
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
  // MoveHero's staleness guard, ResolveBattle/UpgradeTownHall/
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
    case "BankGold": {
      // Same five-step shape as TransferGold above: reducer -> save ->
      // dualWrite -> event -> append.
      const settlement = row.settlements[command.settlementId];
      if (!settlement) {
        return { ok: false, reason: "no_settlement", events: [] };
      }
      // The pot is per-settlement state, so the same gap UpgradeBuilding
      // closes applies: neither depositIntoBank nor requestBankWithdrawal
      // checks ownership themselves.
      if (settlement.ownerId !== command.actor) {
        return { ok: false, reason: "forbidden_not_your_settlement", events: [] };
      }
      const result =
        command.direction === "deposit"
          ? depositIntoBank(state, command.settlementId, command.gx, command.gy, command.amount)
          : requestBankWithdrawal(state, command.settlementId, command.gx, command.gy, command.amount);
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
        type: "BankGoldMoved",
        actor: command.actor,
        settlementId: command.settlementId,
        gx: command.gx,
        gy: command.gy,
        amount: command.amount,
        direction: command.direction,
      };
      const lastEventId = await deps.eventRepo.append(command.gameName, event.type, event, command.actor);
      return { ok: true, events: [event], lastEventId, settlement: result.state.settlements[command.settlementId] };
    }
    case "EndTurn": {
      // See server/app/turnService.ts for the pipeline itself and its
      // documented charter-advancement limitation (no DB column for
      // activeCharters yet).
      // Caravans path with A* on the deterministic rebuilt map -- only pay
      // the generation cost when routes actually exist (plan §5.2).
      const map = (state.tradeRoutes?.length ?? 0) > 0
        ? new GameMap(Number(row.seed) || 1, row.map_size as MapSize)
        : null;
      // The catalog is already loaded on deps.ctx (createLiveCommandDeps), and
      // the weekly upkeep charge inside advanceRound needs it for per-unit
      // upkeepGold/upkeepFood plus its deterministic desertion draw.
      const upkeepUnitTypes: Record<string, UnitType> = Object.fromEntries(
        deps.ctx.catalog.unitTypes.map((u) => [u.id, u]),
      );
      // Legacy instant auto-trade gate (2026-10-02): the games row's lobby
      // jsonb carries it, ABSENT -> true. Every pre-flag save keeps firing
      // runAutoTrade exactly as it always did; POST /games writes an explicit
      // false on new games, whose end turns then move nothing -- food logistics
      // ride the caravan routes instead.
      const legacyAutoTrade = row.lobby?.legacyAutoTrade ?? true;
      const { state: finalState, wrapped, transfers } = runEndTurn(
        state,
        clampGrowthRate(command.growthRate),
        map,
        upkeepUnitTypes,
        legacyAutoTrade,
      );
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
          trade_routes: finalState.tradeRoutes,
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
      // Weekly caravan-maintenance desertion auto-removed these routes
      // inside advanceRound (applyCaravanUpkeep); append a TradeRouteRemoved
      // row per removal BEFORE the TurnEnded row so the stream reads
      // chronologically. The route's origin owner is the actor -- it always
      // resolves (dead-origin routes are skipped by maintenance) -- with the
      // ending seat as a defensive fallback.
      const beforeRoutes = state.tradeRoutes ?? [];
      let lastEventId = 0;
      for (const removedId of removedTradeRouteIds(state, finalState)) {
        const removed = beforeRoutes.find((r) => r.id === removedId);
        const owner = removed ? endpointOwner(removed.from, state) : null;
        const actor: number = owner ?? command.actor;
        const removedEvent: EngineEvent = {
          type: "TradeRouteRemoved",
          actor,
          routeId: removedId,
        };
        lastEventId = await deps.eventRepo.append(command.gameName, removedEvent.type, removedEvent, actor);
      }
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
      // game_events would trip over. lastEventId was declared above for
      // the removal rows and is reassigned through each append below so it
      // ends up holding the highest id this command caused.
      lastEventId = await deps.eventRepo.append(command.gameName, event.type, event, command.actor);
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
        tradeRoutes: finalState.tradeRoutes,
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
      // Post-battle application is the shared helper both battle commands
      // run (see its header above) -- the auto path and the manual arena's
      // SubmitBattleResult path must stay rule-identical.
      const defenderLostAllTroops = battle.defenderOutcome === "lost_all_troops";
      const { heroes: newHeroes, lootedGold } = buildPostBattleHeroes(
        state.heroes,
        attackerHero,
        defenderHero,
        battle.attackerPlatoons,
        battle.defenderPlatoons,
        defenderLostAllTroops,
      );
      // The auto-resolver never passes retreat policies (D4 in
      // plan/2026-09-29-hero-outcomes.md), so a concession verdict can't
      // occur here -- only defeated (hero removed) or stood. A retreated_self
      // outcome (self-retreat policy, not wired server-side today) would
      // still relocate via applyHeroBattleOutcomes' general retreat rule.
      const attackerVerdict = deriveHeroVerdict(battle.attackerOutcome);
      const defenderVerdict = deriveHeroVerdict(battle.defenderOutcome);
      const outcome = applyHeroBattleOutcomes(newHeroes, state.players, state.settlements, {
        attackerId: command.attackerId,
        defenderId: command.defenderId,
        attackerVerdict,
        defenderVerdict,
      });
      // Post-verdict: a removed attacker can't capture (they're gone), and a
      // relocated one no longer stands on the collision hex. The capture is
      // fed the pruned players so its SettlementCaptured players output
      // carries the heroIds prune too.
      const capture = applyPostBattleCapture(
        { ...state, players: outcome.players },
        command.attackerId,
        outcome.heroes,
      );
      await persistBattleOutcome(
        deps,
        command.gameName,
        state,
        source,
        outcome.heroes,
        outcome.players,
        foldRemovedHeroCharters(state, newHeroes, outcome.removedHeroIds),
        capture,
      );
      const event: EngineEvent = {
        type: "BattleResolved",
        actor: command.actor,
        attackerId: command.attackerId,
        defenderId: command.defenderId,
        winner: battle.winner,
        attackerOutcome: battle.attackerOutcome,
        defenderOutcome: battle.defenderOutcome,
        attackerVerdict,
        defenderVerdict,
        rewardGold: lootedGold,
        rounds: battle.rounds,
        obstacleSeed,
      };
      const lastEventId = await deps.eventRepo.append(command.gameName, event.type, event, command.actor);
      return {
        ok: true,
        events: [event],
        lastEventId,
        attackerHero: (capture?.heroes ?? outcome.heroes)[command.attackerId],
        defenderHero: outcome.heroes[command.defenderId],
        attackerVerdict,
        defenderVerdict,
        battle,
      };
    }
    case "RecruitHero": {
      // recruitHero() itself checks settlement.ownerId !== playerId, and
      // command.actor === row.active_player_id is already enforced above
      // -- between the two, there's no separate ownership hole to close
      // here the way UpgradeTownHall/etc. need.
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
      // Garrison gate (unit-recruitment/garrison plan task 7): a settlement
      // with troops in its garrison must be defeated in the arena first --
      // a walk-in capture only applies to an emptied (or never-garrisoned)
      // settlement. The client should have fought a SETTLEMENT_BATTLE and
      // submitted SubmitSettlementBattleResult instead.
      if (platoonsHaveTroops(settlementStacks(settlement))) {
        return { ok: false, reason: "garrison_not_defeated", events: [] };
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
      // Terrain biases the chartered city's food-spot roll (StartCharter).
      const { spots } = generateCitySpots(cityViewSizeFor(1), deps.ctx.rng, {
        foodBias: foodBiasForTerrain(map.get(command.targetQ, command.targetR) ?? ""),
      });
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
    case "AdvanceCharterTravel": {
      // Issue #152: the last piece of R5's charter lifecycle to go
      // server-authoritative. Same source gate StartCharter uses and for
      // the same reason -- charter phase has no JSONB fallback column, so
      // on a fallback hydration state.activeCharters is [] regardless of
      // what the charters table really holds, and stepTravelCharter()'s own
      // not_traveling/no_charter checks would misfire against that empty
      // view instead of the real one.
      if (source !== "granular") {
        return { ok: false, reason: "charters_persist_unavailable", events: [] };
      }
      const currentHero = row.heroes[command.heroId];
      if (!currentHero) {
        return { ok: false, reason: "no_hero", events: [] };
      }
      if (currentHero.ownerId !== command.actor) {
        return { ok: false, reason: "forbidden_not_your_hero", events: [] };
      }
      // Staleness guard, identical in shape and purpose to MoveHero's own
      // (server/app/commandHandler.ts's MoveHero case, above): protects
      // against a step computed from a hero position that's since changed
      // underneath it (e.g. a concurrent ResolveBattle-triggered
      // cleanupDefeatedHeroCharters, or a second in-flight step from a
      // duplicate advanceAutoTravel() tick).
      if (
        currentHero.q !== command.fromTile.q ||
        currentHero.r !== command.fromTile.r
      ) {
        return { ok: false, reason: "hero_not_at_fromTile", events: [] };
      }
      if (hexDistance(command.fromTile, command.toTile) !== 1) {
        return { ok: false, reason: "not_adjacent", events: [] };
      }
      // Cost/passability are server-recomputed from the reconstructed map,
      // not client-supplied -- same trust boundary StartCharter's
      // target-hex check uses above (and the same GameMap reconstruction,
      // pinned equivalent to the client's own by
      // test/server/gameMapReconstruction.test.ts).
      const map = new GameMap(row.seed, row.map_size as MapSize | undefined);
      if (!map.isPassable(command.toTile.q, command.toTile.r)) {
        return { ok: false, reason: "impassable", events: [] };
      }
      const cost = map.cost(command.toTile.q, command.toTile.r);
      const result = stepTravelCharter(state, command.heroId, command.toTile.q, command.toTile.r, cost);
      if (!result.ok) {
        return { ok: false, reason: result.reason, events: [] };
      }
      await deps.gameRepo.saveHeroesAndSettlements(
        command.gameName,
        result.state.heroes,
        result.state.settlements,
      );
      await dualWriteEntities(deps, command.gameName, state, result.state);
      // Only reached on the granular path (gated above), same as
      // StartCharter's own unconditional call -- safe here too since
      // result.state.activeCharters is always this game's real, complete
      // set (never a partial/JSONB-fallback view).
      await deps.charterRepo.upsertMany(command.gameName, result.state.activeCharters);
      const hero = state.heroes[command.heroId];
      const event: EngineEvent = {
        type: "CharterTravelAdvanced",
        actor: command.actor,
        heroId: command.heroId,
        // hero.charterId is guaranteed non-null here -- stepTravelCharter()
        // already rejected with not_chartering/no_charter otherwise.
        charterId: hero!.charterId as string,
        to: command.toTile,
      };
      const lastEventId = await deps.eventRepo.append(command.gameName, event.type, event, command.actor);
      return { ok: true, events: [event], lastEventId, hero: result.state.heroes[command.heroId] };
    }
    case "SubmitBattleResult": {
      // Manual-arena result submission (plan/2026-09-27-manual-battle-wiring.md,
      // work item 4). v1 trusts the client's played-out outcome (decision 4,
      // locked 2026-09-27 -- LAN trust, cheat-able by a modified client and
      // accepted); everything this case validates is cheap and structural,
      // and the full per-action stream lives in battle_actions (work item
      // 4b) for the future legality-check consumer.
      const attackerHero = row.heroes[command.attackerId];
      const defenderHero = row.heroes[command.defenderId];
      if (!attackerHero || !defenderHero) {
        return { ok: false, reason: "hero_not_found", events: [] };
      }
      // The submitting seat must own one of the two combatants -- its
      // client is the one that opened the arena for this pair. (It can't
      // own both: detectAdjacentEnemy below skips same-owner heroes, so a
      // same-owner pair could never have collided in the first place.)
      if (attackerHero.ownerId !== command.actor && defenderHero.ownerId !== command.actor) {
        return { ok: false, reason: "forbidden_not_your_hero", events: [] };
      }
      // "Phase is BATTLE for this hero pair" (plan's server-validation list),
      // expressed server-side: the server never persists a BATTLE phase --
      // hydrateGameState always derives PLAYER_TURN/AI_TURN from
      // active_player_id -- so the honest equivalent of that check is the
      // same adjacency re-derivation the ResolveBattle case runs. Adjacent
      // + one of them owned by the still-active submitting seat is exactly
      // the live-collision precondition the client's BATTLE phase encodes.
      if (detectAdjacentEnemy(state, command.attackerId) !== command.defenderId) {
        return { ok: false, reason: "not_adjacent", events: [] };
      }
      // Survivors shape was wire-validated in parseCommand; this is the
      // semantic half -- every unitTypeId must exist in the server's own
      // DB-backed catalog (the same catalog the auto-resolver resolves
      // against), so a modified client can't invent units.
      const catalogIds = new Set(deps.ctx.catalog.unitTypes.map((u) => u.id));
      const unknownUnit = [...command.attackerStacks, ...command.defenderStacks].some((p) =>
        p.entries.some((e) => !catalogIds.has(e.unitTypeId)),
      );
      if (unknownUnit) {
        return { ok: false, reason: "unknown_unit_type", events: [] };
      }
      // Who conceded on retreat/surrender is derivable, not carried: only
      // the arena's human side can retreat/surrender, and the human is the
      // combatant owned by the submitting seat (see the ownership check
      // above). Exactly one hero matches by construction.
      const concedingIsAttacker = attackerHero.ownerId === command.actor;
      const concedingHero = concedingIsAttacker ? attackerHero : defenderHero;
      // Surrender's priced gold: capped by the conceding hero's actual
      // purse (a Leave-Behind surrender submits 0 -- units were stripped
      // from the survivor stacks instead).
      let surrenderedGold = command.surrenderedGold ?? 0;
      if (command.outcome === "surrender" && surrenderedGold > (Number(concedingHero.gold) || 0)) {
        return { ok: false, reason: "surrender_gold_exceeds_purse", events: [] };
      }
      if (command.outcome !== "surrender") {
        surrenderedGold = 0;
      }
      // Retreat/surrender cancel the attacker's move (decision 3): the
      // server-side equivalent of the client's tc.cancelMove(attackerId) --
      // the engine's cancelMove() restores previousQ/R/movementRemaining,
      // all of which MoveHero persists, so this works against the row.
      // Wins/losses/draws leave the attacker standing where the collision
      // happened, exactly like the auto-resolver.
      const baseState =
        command.outcome === "retreat" || command.outcome === "surrender"
          ? cancelMove(state, command.attackerId)
          : state;
      const cancelledAttacker = baseState.heroes[command.attackerId];
      const cancelledDefender = baseState.heroes[command.defenderId];
      if (!cancelledAttacker || !cancelledDefender) {
        return { ok: false, reason: "hero_not_found", events: [] };
      }
      const attackerStacks = normalizePlatoons(command.attackerStacks);
      const defenderStacks = normalizePlatoons(command.defenderStacks);
      const defenderLostAllTroops =
        command.outcome === "attackerWon" ||
        (command.outcome === "draw" && defenderStacks.every((p) => p.entries.length === 0));
      // Per-side verdicts (hero-outcomes plan W2a). The conceding side's
      // verdict comes straight from the submitted outcome (only the arena's
      // human side retreats/surrenders -- the same ownership derivation as
      // concedingHero above); the OPPOSING side gets deriveHeroVerdict over
      // its side's outcome, with a wipe read off the submitted stacks beating
      // a mapped "survived" (mirrors the defenderLostAllTroops shape: an
      // explicit loss always wipes, a stalemate wipes only when that side
      // submitted zero survivors).
      const attackerWipedAllTroops =
        command.outcome === "defenderWon" ||
        (command.outcome === "draw" && attackerStacks.every((p) => p.entries.length === 0));
      const concedingOutcome =
        command.outcome === "retreat" || command.outcome === "surrender" ? command.outcome : undefined;
      const attackerConceded = concedingIsAttacker ? concedingOutcome : undefined;
      const defenderConceded = concedingIsAttacker ? undefined : concedingOutcome;
      const attackerVerdict: HeroBattleVerdict = attackerConceded
        ? deriveHeroVerdict("retreated_hero", attackerConceded)
        : deriveHeroVerdict(attackerWipedAllTroops ? "lost_all_troops" : "survived");
      const defenderVerdict: HeroBattleVerdict = defenderConceded
        ? deriveHeroVerdict("retreated_hero", defenderConceded)
        : deriveHeroVerdict(defenderLostAllTroops ? "lost_all_troops" : "survived");
      const { heroes: newHeroes, lootedGold } = buildPostBattleHeroes(
        baseState.heroes,
        cancelledAttacker,
        cancelledDefender,
        attackerStacks,
        defenderStacks,
        defenderLostAllTroops,
      );
      // Surrender deducts the paid gold from the conceding hero on top of
      // the shared survivor/loot application (a surrender never loots: the
      // defender did not lose all troops, so lootedGold is 0 here).
      if (surrenderedGold > 0) {
        newHeroes[concedingHero.id] = {
          ...newHeroes[concedingHero.id],
          gold: (Number(newHeroes[concedingHero.id].gold) || 0) - surrenderedGold,
        };
      }
      // Hero outcomes run AFTER the gold deduction so the relocated
      // surrendering copy carries the debited purse. Retreat/surrender
      // relocation overwrites the cancelMove-restored position when the
      // conceder's owner holds a settlement; with none they stay at the
      // cancelled position (plan D1). A wiped (defeated) side is deleted
      // from the record here, after buildPostBattleHeroes' loot transfer.
      const outcome = applyHeroBattleOutcomes(newHeroes, state.players, state.settlements, {
        attackerId: command.attackerId,
        defenderId: command.defenderId,
        attackerVerdict,
        defenderVerdict,
      });
      // Retreat/surrender restored the attacker's pre-move position
      // (baseState came from cancelMove), so they are no longer standing on
      // the collision hex -- post-battle capture only applies when the
      // attacker kept it (win/draw/loss-with-survivors). Fed the pruned
      // players so the capture's players output carries the heroIds prune.
      const capture =
        baseState === state
          ? applyPostBattleCapture({ ...state, players: outcome.players }, command.attackerId, outcome.heroes)
          : null;
      await persistBattleOutcome(
        deps,
        command.gameName,
        state,
        source,
        outcome.heroes,
        outcome.players,
        foldRemovedHeroCharters(state, newHeroes, outcome.removedHeroIds),
        capture,
      );
      // The existing BattleResolved event, derived from the submitted
      // outcome so battle:resolved UI/bus consumers keep working on every
      // path. The engine's outcome union already carries retreated_hero/
      // survived (verified: no event-shape extension needed -- see
      // packages/contracts/src/events/engineEvent.ts), so retreat and
      // surrender both map onto retreated_hero; the explicit per-side
      // verdicts are what discriminates them for the client (D5).
      type ResolvedWinner = Extract<EngineEvent, { type: "BattleResolved" }>["winner"];
      type ResolvedOutcome = Extract<EngineEvent, { type: "BattleResolved" }>["attackerOutcome"];
      const winner: ResolvedWinner =
        command.outcome === "attackerWon"
          ? "attacker"
          : command.outcome === "defenderWon"
            ? "defender"
            : command.outcome === "draw"
              ? "draw"
              : concedingIsAttacker
                ? "defender"
                : "attacker";
      const attackerOutcome: ResolvedOutcome =
        command.outcome === "attackerWon"
          ? "won"
          : command.outcome === "defenderWon"
            ? "lost_all_troops"
            : command.outcome === "draw"
              ? "survived"
              : concedingIsAttacker
                ? "retreated_hero"
                : "won";
      const defenderOutcome: ResolvedOutcome =
        command.outcome === "defenderWon"
          ? "won"
          : command.outcome === "attackerWon"
            ? "lost_all_troops"
            : command.outcome === "draw"
              ? "survived"
              : concedingIsAttacker
                ? "won"
                : "retreated_hero";
      const event: EngineEvent = {
        type: "BattleResolved",
        actor: command.actor,
        attackerId: command.attackerId,
        defenderId: command.defenderId,
        winner,
        attackerOutcome,
        defenderOutcome,
        attackerVerdict,
        defenderVerdict,
        rewardGold: lootedGold,
        rounds: command.rounds,
        obstacleSeed: command.obstacleSeed,
      };
      const lastEventId = await deps.eventRepo.append(command.gameName, event.type, event, command.actor);
      return {
        ok: true,
        events: [event],
        lastEventId,
        attackerHero: (capture?.heroes ?? outcome.heroes)[command.attackerId],
        defenderHero: outcome.heroes[command.defenderId],
        attackerVerdict,
        defenderVerdict,
      };
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
    case "PlaceBuildings": {
      // F4 closer: the city view's working cart commits server-side. The
      // reducer re-derives the net cost against the server's own row
      // (placement costs minus the 50% destroy refund), revalidates
      // affordability, and recomputes construction timers for brand-new
      // placements -- a modified client can't ship a free or 0-day build.
      const result = applyPlaceBuildings(state, command.settlementId, command.actor, command.buildings, command.initialLayout === true);
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
        type: "BuildingsPlaced",
        actor: command.actor,
        settlementId: command.settlementId,
      };
      const lastEventId = await deps.eventRepo.append(command.gameName, event.type, event, command.actor);
      return { ok: true, events: [event], lastEventId, settlement: result.state.settlements[command.settlementId] };
    }
    case "TransferResources": {
      const result = transferResources(state, command.actor, command.heroId, command.settlementId, command.direction, command.amounts);
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
        type: "ResourcesTransferred",
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
    case "AssignWagons": {
      const result = assignWagons(state, command.actor, command.heroId, command.delta, command.slot);
      if (!result.ok) {
        return { ok: false, reason: result.reason, events: [] };
      }
      await deps.gameRepo.saveHeroesAndSettlements(
        command.gameName,
        result.state.heroes,
        result.state.settlements,
        { players: result.state.players },
      );
      await dualWriteEntities(deps, command.gameName, state, result.state);
      const event: EngineEvent = {
        type: "WagonsAssigned",
        actor: command.actor,
        heroId: command.heroId,
        delta: command.delta,
        ...(command.slot !== undefined ? { slot: command.slot } : {}),
      };
      const lastEventId = await deps.eventRepo.append(command.gameName, event.type, event, command.actor);
      return { ok: true, events: [event], lastEventId, hero: result.state.heroes[command.heroId] };
    }
    case "BuyWagons": {
      const result = buyWagons(state, command.actor, command.settlementId, command.count, command.slot);
      if (!result.ok) {
        return { ok: false, reason: result.reason, events: [] };
      }
      await deps.gameRepo.saveHeroesAndSettlements(
        command.gameName,
        result.state.heroes,
        result.state.settlements,
        { players: result.state.players },
      );
      await dualWriteEntities(deps, command.gameName, state, result.state);
      const event: EngineEvent = {
        type: "WagonsBought",
        actor: command.actor,
        settlementId: command.settlementId,
        count: command.count,
        ...(command.slot !== undefined ? { slot: command.slot } : {}),
      };
      const lastEventId = await deps.eventRepo.append(command.gameName, event.type, event, command.actor);
      return { ok: true, events: [event], lastEventId, settlement: result.state.settlements[command.settlementId] };
    }
    case "CreateTradeRoute": {
      const result = createTradeRouteReducer(
        state,
        command.actor,
        command.from,
        command.to,
        command.payload,
        command.wagons,
      );
      if (!result.ok) {
        return { ok: false, reason: result.reason, events: [] };
      }
      await deps.gameRepo.saveHeroesAndSettlements(
        command.gameName,
        result.state.heroes,
        result.state.settlements,
        { players: result.state.players, trade_routes: result.state.tradeRoutes },
      );
      // The event carries the endpoint/payload shape verbatim (routes
      // between settlements, heroes, or either direction) so every replay
      // transport can rebuild the route; the persisted JSONB dual-write
      // above serializes the same shape.
      const event: EngineEvent = {
        type: "TradeRouteCreated",
        actor: command.actor,
        routeId: result.route!.id,
        from: command.from,
        to: command.to,
        payload: command.payload,
        wagons: command.wagons,
      };
      const lastEventId = await deps.eventRepo.append(command.gameName, event.type, event, command.actor);
      return { ok: true, events: [event], lastEventId, tradeRoutes: result.state.tradeRoutes };
    }
    case "UpdateTradeRoute": {
      const result = updateTradeRouteReducer(state, command.actor, command.routeId, {
        resource: command.resource,
        wagonsDelta: command.wagonsDelta,
        remove: command.remove,
      });
      if (!result.ok) {
        return { ok: false, reason: result.reason, events: [] };
      }
      await deps.gameRepo.saveHeroesAndSettlements(
        command.gameName,
        result.state.heroes,
        result.state.settlements,
        { players: result.state.players, trade_routes: result.state.tradeRoutes },
      );
      // A remove is a removal, not an update: the never-before-emitted
      // TradeRouteRemoved kind finally rides the stream here (manual disband)
      // and from the EndTurn case below (weekly maintenance desertion).
      // Remote seats treat the kind as "ignore" and converge at the resync
      // boundary -- same as every other minimal-payload trade kind.
      const event: EngineEvent = command.remove
        ? { type: "TradeRouteRemoved", actor: command.actor, routeId: command.routeId }
        : { type: "TradeRouteUpdated", actor: command.actor, routeId: command.routeId };
      const lastEventId = await deps.eventRepo.append(command.gameName, event.type, event, command.actor);
      return { ok: true, events: [event], lastEventId, tradeRoutes: result.state.tradeRoutes };
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
      // Terrain biases the food-spot roll of the new ring of cells (upgrade).
      const { spots } = generateCitySpots(cityViewSizeFor(targetLevel), deps.ctx.rng, {
        foodBias: foodBiasForTerrain(map.get(settlement.q, settlement.r) ?? ""),
      });
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
    case "RecruitUnits": {
      // Ladder mirrors UpgradeTownHall's: settlement existence, then
      // ownership, then the engine reducer's own building/level/construction/
      // catalog/cost/garrison-capacity checks.
      const settlement = row.settlements[command.settlementId];
      if (!settlement) {
        return { ok: false, reason: "no_settlement", events: [] };
      }
      if (settlement.ownerId !== command.actor) {
        return { ok: false, reason: "forbidden_not_your_settlement", events: [] };
      }
      const result = recruitUnits(state, {
        settlementId: command.settlementId,
        buildingKind: command.buildingKind,
        gx: command.gx,
        gy: command.gy,
        unitTypeId: command.unitTypeId,
        count: command.count,
      });
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
        type: "UnitsRecruited",
        actor: command.actor,
        settlementId: command.settlementId,
        unitTypeId: command.unitTypeId,
        count: command.count,
      };
      const lastEventId = await deps.eventRepo.append(command.gameName, event.type, event, command.actor);
      return { ok: true, events: [event], lastEventId, settlement: result.state.settlements[command.settlementId] };
    }
    case "TransferUnits": {
      // Same ladder ReorderStack uses for the hero half (existence +
      // ownership -- transferUnits() has no actor notion) plus
      // UpgradeTownHall's settlement half.
      const hero = row.heroes[command.heroId];
      if (!hero) {
        return { ok: false, reason: "no_hero", events: [] };
      }
      if (hero.ownerId !== command.actor) {
        return { ok: false, reason: "forbidden_not_your_hero", events: [] };
      }
      const settlement = row.settlements[command.settlementId];
      if (!settlement) {
        return { ok: false, reason: "no_settlement", events: [] };
      }
      if (settlement.ownerId !== command.actor) {
        return { ok: false, reason: "forbidden_not_your_settlement", events: [] };
      }
      const result = transferUnits(state, {
        heroId: command.heroId,
        settlementId: command.settlementId,
        direction: command.direction,
        unitTypeId: command.unitTypeId,
        count: command.count,
        ...(command.toSlot !== undefined ? { toSlot: command.toSlot } : {}),
      });
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
        type: "UnitsTransferred",
        actor: command.actor,
        heroId: command.heroId,
        settlementId: command.settlementId,
        direction: command.direction,
        unitTypeId: command.unitTypeId,
        count: command.count,
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
    case "SubmitSettlementBattleResult": {
      // Manual-arena result submission for a settlement-garrison battle,
      // mirroring the SubmitBattleResult case command-for-command (same v1
      // trust model); the shape half is wire-validated in parseCommand.
      const attackerHero = row.heroes[command.attackerId];
      if (!attackerHero) {
        return { ok: false, reason: "hero_not_found", events: [] };
      }
      if (attackerHero.ownerId !== command.actor) {
        return { ok: false, reason: "forbidden_not_your_hero", events: [] };
      }
      const settlement = row.settlements[command.settlementId];
      if (!settlement) {
        return { ok: false, reason: "no_settlement", events: [] };
      }
      if (settlement.ownerId === attackerHero.ownerId) {
        return { ok: false, reason: "not_enemy_settlement", events: [] };
      }
      // "Phase is SETTLEMENT_BATTLE for this pair" (plan §8's client phase),
      // re-derived server-side: the attacker owned by the active seat and
      // standing ON the settlement tile with a live garrison is exactly the
      // precondition startSettlementBattle encodes. A NEUTRAL (ownerId null)
      // garrisoned settlement qualifies like an enemy-owned one -- the gate
      // is only "not the attacker's own settlement".
      if (attackerHero.q !== settlement.q || attackerHero.r !== settlement.r) {
        return { ok: false, reason: "hero_not_at_settlement", events: [] };
      }
      if (!platoonsHaveTroops(settlementStacks(settlement))) {
        return { ok: false, reason: "garrison_empty", events: [] };
      }
      // Semantic half of the survivor-stack check, identical to
      // SubmitBattleResult's: every named unit must exist in the server's
      // own DB-backed catalog.
      const catalogIds = new Set(deps.ctx.catalog.unitTypes.map((u) => u.id));
      const unknownUnit = [...command.attackerStacks, ...command.defenderStacks].some((p) =>
        p.entries.some((e) => !catalogIds.has(e.unitTypeId)),
      );
      if (unknownUnit) {
        return { ok: false, reason: "unknown_unit_type", events: [] };
      }
      // Surrender's priced gold, capped by the attacker's actual purse --
      // same rule (and same rejection reason) as SubmitBattleResult.
      let surrenderedGold = command.surrenderedGold ?? 0;
      if (command.outcome === "surrender" && surrenderedGold > (Number(attackerHero.gold) || 0)) {
        return { ok: false, reason: "surrender_gold_exceeds_purse", events: [] };
      }
      if (command.outcome !== "surrender") {
        surrenderedGold = 0;
      }
      const result = applySettlementBattleResult(state, {
        attackerId: command.attackerId,
        settlementId: command.settlementId,
        outcome: command.outcome,
        attackerStacks: command.attackerStacks,
        defenderStacks: command.defenderStacks,
        ...(surrenderedGold > 0 ? { surrenderedGold } : {}),
      });
      // attackerWon runs captureSettlement() inside the reducer (owner
      // flip + CAPTURE_GOLD_REWARD), so players move too -- persist them
      // alongside, same as CaptureSettlement's own case. The reducer also
      // applies the attacker's hero outcome (hero-outcomes parity): defeat
      // deletes the hero and prunes owner heroIds (players ride the same
      // persist), retreat/surrender relocate; removedHeroIds drive the
      // charter fold whose granular-gated persist mirrors
      // persistBattleOutcome's.
      const legacyGold = sumPlayerGold(result.state.players, result.state.heroes, result.state.settlements);
      await deps.gameRepo.saveHeroesAndSettlements(
        command.gameName,
        result.state.heroes,
        result.state.settlements,
        { players: result.state.players, gold: legacyGold },
      );
      await dualWriteEntities(deps, command.gameName, state, result.state);
      if (result.state.activeCharters !== state.activeCharters && source === "granular") {
        await deps.charterRepo.upsertMany(command.gameName, result.state.activeCharters);
      }
      const event: EngineEvent = {
        type: "SettlementBattleResolved",
        actor: command.actor,
        attackerId: command.attackerId,
        settlementId: command.settlementId,
        // Legacy collapsed winner for existing consumers: draws and the
        // retreat/surrender concessions keep reporting defender-won. The
        // truthful outcome + verdict ride the additive fields (B6/D6,
        // server-side AI actor plan Phase 2) so event-derived result
        // cards/toasts can word a draw or a concession accurately.
        winner: command.outcome === "attackerWon" ? "attacker" : "defender",
        captured: result.captured,
        outcome:
          command.outcome === "attackerWon"
            ? "attackerWon"
            : command.outcome === "draw"
              ? "draw"
              : "defenderWon",
        attackerVerdict: result.attackerVerdict,
      };
      const lastEventId = await deps.eventRepo.append(command.gameName, event.type, event, command.actor);
      return {
        ok: true,
        events: [event],
        lastEventId,
        attackerHero: result.state.heroes[command.attackerId],
        settlement: result.state.settlements[command.settlementId],
        attackerVerdict: result.attackerVerdict,
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
export async function createLiveCommandDeps(): Promise<LiveCommandDeps> {
  const unitTypesResult = await pool.query<UnitTypeRow>(
    `SELECT id, name, attack, defence, health, speed, description, advantage_type, specialty, specialty_priority,
            tier, upkeep_gold, upkeep_food, range
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
    tier: r.tier as UnitType["tier"],
    upkeepGold: r.upkeep_gold,
    upkeepFood: r.upkeep_food,
    range: r.range,
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
    // MoveHero/whatever commands issued in the same
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

// Server-internal EndTurn for the drop policy (docs/multiplayer.md,
// "Drop policy", shipped 2026-09-27): when a disconnected seat's grace
// expires while it holds the active turn, server/app/dropPolicy.ts ends
// that seat's turn for it. This is the small service-level entry point
// for that -- deliberately NOT reached through the HTTP command router,
// because the router's own guard (actor_mismatch, commands.ts) exists to
// authenticate an HTTP caller against the seat it claims, and there is no
// HTTP caller here: the server is acting on the seat's behalf.
//
// handleCommand()'s internal turn-ownership guard
// (command.actor !== row.active_player_id -> forbidden_not_your_turn)
// still runs and passes by construction: dropPolicy.ts only ever invokes
// this after re-reading the row and confirming the seat IS the active
// player, so the guard doubles as a last-voice stale-timer check (if the
// turn moved on between scheduling and firing, the command is rejected
// here exactly as it would be from HTTP).
//
// The full EndTurn pipeline is reused unchanged (runEndTurn ->
// saveHeroesAndSettlements + charter dual-write + settlement snapshots +
// resource transactions + TurnEnded/turn_ended/round_ended events), so a
// server-side skip is byte-for-byte the same mutation the seat's own
// client would have produced.
//
// On success this also appends one extra legacy-style audit event row,
// kind "turn_skipped" (snake_case like the other non-EngineEvent audit
// kinds turn_ended/round_ended/round_started/ai_turn_started), recording
// that this EndTurn was server-initiated rather than player-initiated.
// actor_seat is null -- like round_started/ai_turn_started, the action is
// not attributable to the seat's own hand (see 010_event_seq.sql's header).
// Best-effort and outside the command transaction: a failed audit append
// must not roll back an already-committed turn, it only degrades the trail.
export const TURN_SKIPPED_AUDIT_KIND = "turn_skipped";

export async function runServerEndTurnForSeat(
  gameName: string,
  seat: number,
  deps: LiveCommandDeps,
): Promise<CommandResult> {
  const command: Command = { kind: "EndTurn", gameName, actor: seat };
  const result = await handleCommandTransactional(command, deps);
  if (!result.ok) return result;
  try {
    await createEventRepo(deps.pool).append(gameName, TURN_SKIPPED_AUDIT_KIND, {
      playerId: seat,
      reason: "disconnected_grace_expired",
      round: result.round,
      day: result.day,
      activePlayerId: result.activePlayerId,
    }, null);
  } catch (err) {
    console.error("[api] turn_skipped audit append failed:", err);
  }
  return result;
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
  tier: number;
  upkeep_gold: number;
  upkeep_food: number;
  range: number;
};
