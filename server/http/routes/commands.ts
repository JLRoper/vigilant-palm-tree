import { Router, type Request } from "express";
import type { BuildingDef, BuildingKind, BuildingUpgradeRequest, Command, Platoon } from "@heroes/contracts";
import { ARMY_STACK_SLOTS, VALID_HORSE_VARIANTS } from "@heroes/engine";
import { handleCommandTransactional, createLiveCommandDeps, type LiveCommandDeps } from "../../app/commandHandler";
import { touchSeat } from "../../app/dropPolicy";
import { pool } from "../../persistence/db";
import { attachAuth } from "../../auth";
import { attachPlayerSeat } from "../../middleware/attachPlayerSeat";

// createLiveCommandDeps() is async as of Week 3 (it now queries the
// unit_types table for ResolveBattle's catalog -- see that function's own
// comment), so it can no longer just be called once at module load time
// the way Week 1/2 had it. Memoized lazily on first request instead:
// route registration doesn't block on a DB round-trip, and every request
// after the first reuses the same resolved LiveCommandDeps (still built
// once per process, not once per request -- same intent as before).
//
// LiveCommandDeps is the superset of CommandDeps that
// handleCommandTransactional needs (it carries the pool the transactional
// wrapper acquires per-request PoolClients from). The transactional
// wrapper internally threads a request-scoped gameRepo/eventRepo from a
// PoolClient, so the memoized repos themselves are only used for the
// unit_types pre-read inside createLiveCommandDeps.
let liveDepsPromise: Promise<LiveCommandDeps> | null = null;
function getLiveDeps(): Promise<LiveCommandDeps> {
  if (!liveDepsPromise) {
    liveDepsPromise = createLiveCommandDeps().catch((err) => {
      // Clear the memoized promise on rejection so a transient DB failure
      // (e.g. unit_types query timing out while the DB is recovering)
      // doesn't permanently cache a rejected promise and 500 every command
      // until the process restarts. Without this, the first failure to
      // build liveDepsPromise locks every subsequent request out.
      liveDepsPromise = null;
      throw err;
    });
  }
  return liveDepsPromise;
}

// POST /api/games/:name/commands -- mounted with the :name param already
// bound by routes.ts's router.use("/games/:name/commands", commandsRouter).
// Existing convention everywhere else in server/routes.ts is :name, not
// :id (2026-08-16-parallel-dev-phases-3-5.md's :id is not what's actually
// used anywhere in this codebase).
//
// { mergeParams: true } is required, not optional, for that :name to
// actually reach this router: without it, an Express child router mounted
// via router.use(path, childRouter) does NOT inherit the parent's matched
// route params -- req.params is {} inside commandsRouter regardless of
// what the parent's mount pattern captured. This was a real, latent bug
// (pre-existing since Week 1's PR #83, not introduced by this Week 2
// change): req.params.name was undefined on every real HTTP call to this
// route, so command.gameName ended up undefined, gameRepo.load(undefined)
// matched zero rows, and every request 404'd. Only ever exercised
// end-to-end for the first time by this Week 2 PR's multiplayer.smoke.ts
// update (Week 1's own tests called handleCommand() directly against
// mockRepos, never through Express).
export const commandsRouter = Router({ mergeParams: true });
// Sign-in is optional (issue #179 follow-up) -- attachAuth/attachPlayerSeat
// never reject the request. They just make req.playerSeat available below
// when the caller happens to be signed in and has claimed a seat, so the
// actor-vs-seat check can offer that caller extra protection.
commandsRouter.use(attachAuth, attachPlayerSeat);

function isAxial(v: unknown): v is { q: number; r: number } {
  return (
    !!v &&
    typeof v === "object" &&
    typeof (v as { q: unknown }).q === "number" &&
    typeof (v as { r: unknown }).r === "number"
  );
}

// UpgradeBuilding's per-entry shape check. `kind` is only checked for
// being a non-empty string, not against a list of BuildingKind values:
// BuildingKind is a type-only union in @heroes/contracts (no runtime
// array exists to check against, unlike VALID_HORSE_VARIANTS above), and
// @heroes/engine's startBuildingUpgrade() already resolves each request
// against the settlement's own buildings -- an unknown kind falls out
// there as a "building_not_found" 409, not a crash.
function isBuildingUpgradeRequest(v: unknown): boolean {
  if (!v || typeof v !== "object") return false;
  const r = v as { gx: unknown; gy: unknown; kind: unknown };
  return (
    Number.isInteger(r.gx) &&
    Number.isInteger(r.gy) &&
    typeof r.kind === "string" &&
    r.kind.length > 0
  );
}

// Matches the old /trade route's own VALID_RESOURCES list (server/routes.ts)
// -- "food" is deliberately excluded, see
// packages/contracts/src/commands/tradeResources.ts's header comment.
const VALID_TRADE_RESOURCES = ["wood", "stone", "iron", "arcane"] as const;

// SubmitBattleResult's outcome enum — mirrors
// packages/contracts/src/commands/submitBattleResult.ts's
// SubmittedBattleOutcome (type-only there, so a runtime list lives here;
// same pattern as VALID_TRADE_RESOURCES above).
const VALID_SUBMITTED_OUTCOMES = [
  "attackerWon",
  "defenderWon",
  "retreat",
  "surrender",
  "draw",
] as const;

// Survivor-platoon shape check for SubmitBattleResult: an array of at most
// ARMY_STACK_SLOTS platoons, each entry a known-string unitTypeId with a
// positive integer count (survivors never carry zero/negative counts —
// normalizePlatoons strips those client-side). Whether each unitTypeId
// actually exists in the game's catalog is the handler's job (it owns the
// DB-backed unit_types read); this is purely the wire-shape gate that keeps
// a malformed body out of handleCommand as a clean 400 rather than a
// deep-in-the-handler failure.
function isSurvivorStacks(v: unknown): v is Platoon[] {
  if (!Array.isArray(v) || v.length > 8) return false;
  return v.every((platoon) => {
    if (!platoon || typeof platoon !== "object") return false;
    const entries = (platoon as { entries?: unknown }).entries;
    if (!Array.isArray(entries) || entries.length > 3) return false;
    return entries.every((e) => {
      if (!e || typeof e !== "object") return false;
      const entry = e as { unitTypeId?: unknown; count?: unknown };
      return (
        typeof entry.unitTypeId === "string" &&
        entry.unitTypeId.length > 0 &&
        typeof entry.count === "number" &&
        Number.isInteger(entry.count) &&
        entry.count > 0
      );
    });
  });
}

function isNonNegativeInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

// BankGold's per-move gold ceiling (see its parseCommand branch). Generous
// relative to the biggest legal move (a level-3 bank's 15,000g pot cap), tight
// enough that a nonsense value is a clean 400 instead of a number the reducer
// has to reject.
const MAX_BANK_GOLD_MOVE = 1_000_000;

// PendingOut entry ceiling, mirroring `construction`'s daysRemaining <= 30
// bound: a maturesOnDay further out than this is not something a 7-day
// countdown can produce, so the entry is malformed. Kept finite so a body
// can't smuggle an unbounded array through this gate.
const MAX_BANK_PENDING_ENTRIES = 64;
const MAX_BANK_MATURES_ON_DAY = 100_000;

// BuildingDef.bank shape gate. `undefined` is valid (a bank with no pot yet --
// absent means no pot, mirroring `construction`). Present means a real pot:
// non-negative integer gold plus an optional pendingOut array of matured-countdown
// entries, each a non-negative integer gold and a maturesOnDay integer. Bound
// like `construction`'s daysRemaining so a spoofed pot can't smuggle an
// unbounded array or a negative/absurd balance into persisted state.
function isBankPot(v: unknown): boolean {
  if (v === undefined) return true;
  if (!v || typeof v !== "object") return false;
  const pot = v as { gold?: unknown; pendingOut?: unknown };
  if (!isNonNegativeInt(pot.gold)) return false;
  if (pot.pendingOut === undefined) return true;
  if (!Array.isArray(pot.pendingOut) || pot.pendingOut.length > MAX_BANK_PENDING_ENTRIES) return false;
  return pot.pendingOut.every((e) => {
    if (!e || typeof e !== "object") return false;
    const entry = e as { gold?: unknown; maturesOnDay?: unknown };
    return isNonNegativeInt(entry.gold) && isNonNegativeInt(entry.maturesOnDay) &&
      (entry.maturesOnDay as number) <= MAX_BANK_MATURES_ON_DAY;
  });
}

/**
 * PlaceBuildings' per-entry passthrough. The gate above validates every known
 * field; this copies the entry and re-attaches the pot explicitly so `bank` can
 * never be lost by a future projection of the BuildingDef (a bank pot is
 * state, not construction metadata). Entries without a pot are returned
 * untouched, so a pre-bank building never gains the key.
 */
function passthroughBuilding(v: unknown): BuildingDef {
  const raw = v as BuildingDef;
  if (raw.bank === undefined) return raw;
  return {
    ...raw,
    bank: {
      gold: raw.bank.gold,
      pendingOut: raw.bank.pendingOut.map((e) => ({ gold: e.gold, maturesOnDay: e.maturesOnDay })),
    },
  };
}

// Real per-field validation, not just a `kind` check -- a malformed
// MoveHero/TransferGold body (missing/mistyped field) is rejected as a
// clean 400 here instead of reaching handleCommand and failing with an
// unrelated runtime TypeError.
function parseCommand(body: unknown, gameName: string): Command | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.actor !== "number") return null;

  if (b.kind === "MoveHero") {
    if (
      typeof b.heroId !== "string" ||
      !isAxial(b.fromTile) ||
      !isAxial(b.toTile) ||
      typeof b.cost !== "number" ||
      (b.trail !== undefined && (!Array.isArray(b.trail) || !b.trail.every(isAxial)))
    ) {
      return null;
    }
    return {
      kind: "MoveHero",
      gameName,
      actor: b.actor,
      heroId: b.heroId,
      fromTile: b.fromTile,
      toTile: b.toTile,
      cost: b.cost,
      trail: b.trail as { q: number; r: number }[] | undefined,
    };
  }

  if (b.kind === "TransferGold") {
    if (
      typeof b.heroId !== "string" ||
      typeof b.settlementId !== "string" ||
      (b.direction !== "deposit" && b.direction !== "withdraw")
    ) {
      return null;
    }
    return {
      kind: "TransferGold",
      gameName,
      actor: b.actor,
      heroId: b.heroId,
      settlementId: b.settlementId,
      direction: b.direction,
    };
  }

  if (b.kind === "BankGold") {
    // amount is bounded at 1_000_000 gold: a level-3 bank's pot cap is 15,000
    // and no legal deposit/withdrawal can exceed that, so anything above it is
    // a malformed body rather than a request the reducer would have to
    // round-reject. The treasury cap is far lower, which is a 409
    // (not_enough_gold), not a 400.
    if (
      typeof b.settlementId !== "string" ||
      b.settlementId.length === 0 ||
      !isNonNegativeInt(b.gx) ||
      !isNonNegativeInt(b.gy) ||
      !isNonNegativeInt(b.amount) ||
      b.amount <= 0 ||
      b.amount > MAX_BANK_GOLD_MOVE ||
      (b.direction !== "deposit" && b.direction !== "withdraw")
    ) {
      return null;
    }
    return {
      kind: "BankGold",
      gameName,
      actor: b.actor,
      settlementId: b.settlementId,
      gx: b.gx,
      gy: b.gy,
      amount: b.amount,
      direction: b.direction,
    };
  }

  if (b.kind === "EndTurn") {
    if (b.growthRate !== undefined && typeof b.growthRate !== "number") {
      return null;
    }
    return {
      kind: "EndTurn",
      gameName,
      actor: b.actor,
      growthRate: b.growthRate as number | undefined,
    };
  }

  if (b.kind === "TradeResources") {
    if (
      typeof b.fromSettlementId !== "string" ||
      typeof b.toSettlementId !== "string" ||
      typeof b.resource !== "string" ||
      !VALID_TRADE_RESOURCES.includes(b.resource as (typeof VALID_TRADE_RESOURCES)[number]) ||
      typeof b.amount !== "number" ||
      !Number.isInteger(b.amount) ||
      b.amount <= 0
    ) {
      return null;
    }
    return {
      kind: "TradeResources",
      gameName,
      actor: b.actor,
      fromSettlementId: b.fromSettlementId,
      toSettlementId: b.toSettlementId,
      resource: b.resource as (typeof VALID_TRADE_RESOURCES)[number],
      amount: b.amount,
    };
  }

  if (b.kind === "ResolveBattle") {
    if (typeof b.attackerId !== "string" || typeof b.defenderId !== "string") {
      return null;
    }
    return {
      kind: "ResolveBattle",
      gameName,
      actor: b.actor,
      attackerId: b.attackerId,
      defenderId: b.defenderId,
    };
  }

  if (b.kind === "RecruitHero") {
    if (
      typeof b.heroName !== "string" ||
      b.heroName.length === 0 ||
      typeof b.settlementId !== "string" ||
      typeof b.horseVariant !== "string" ||
      !VALID_HORSE_VARIANTS.includes(b.horseVariant as (typeof VALID_HORSE_VARIANTS)[number])
    ) {
      return null;
    }
    return {
      kind: "RecruitHero",
      gameName,
      actor: b.actor,
      heroName: b.heroName,
      settlementId: b.settlementId,
      horseVariant: b.horseVariant as (typeof VALID_HORSE_VARIANTS)[number],
    };
  }

  if (b.kind === "UpgradeTownHall") {
    if (typeof b.settlementId !== "string" || (b.targetLevel !== 2 && b.targetLevel !== 3)) {
      return null;
    }
    return {
      kind: "UpgradeTownHall",
      gameName,
      actor: b.actor,
      settlementId: b.settlementId,
      targetLevel: b.targetLevel,
    };
  }

  if (b.kind === "SetAutoTrade") {
    if (typeof b.settlementId !== "string" || typeof b.autoTrade !== "boolean") {
      return null;
    }
    return {
      kind: "SetAutoTrade",
      gameName,
      actor: b.actor,
      settlementId: b.settlementId,
      autoTrade: b.autoTrade,
    };
  }

  if (b.kind === "ReorderStack") {
    if (
      typeof b.heroId !== "string" ||
      typeof b.fromIdx !== "number" ||
      typeof b.toIdx !== "number"
    ) {
      return null;
    }
    return {
      kind: "ReorderStack",
      gameName,
      actor: b.actor,
      heroId: b.heroId,
      fromIdx: b.fromIdx,
      toIdx: b.toIdx,
    };
  }

  if (b.kind === "CaptureSettlement") {
    if (typeof b.heroId !== "string" || typeof b.settlementId !== "string") {
      return null;
    }
    return {
      kind: "CaptureSettlement",
      gameName,
      actor: b.actor,
      heroId: b.heroId,
      settlementId: b.settlementId,
    };
  }

  if (b.kind === "UpgradeBuilding") {
    // An empty requests array is deliberately NOT rejected here: it's a
    // well-formed command that @heroes/engine's startBuildingUpgrade()
    // already turns down with "no_buildings", which this route surfaces
    // as a 409. Only malformed entries are a 400.
    if (
      typeof b.settlementId !== "string" ||
      !Array.isArray(b.requests) ||
      !b.requests.every(isBuildingUpgradeRequest)
    ) {
      return null;
    }
    return {
      kind: "UpgradeBuilding",
      gameName,
      actor: b.actor,
      settlementId: b.settlementId,
      requests: b.requests as BuildingUpgradeRequest[],
    };
  }

  if (b.kind === "PlaceBuildings") {
    // Per-building shape gate, mirroring isBuildingUpgradeRequest's
    // permissiveness: `kind`/`style` are non-empty strings (the handler
    // resolves semantics), coordinates are ints, levels are 1..3, and an
    // optional construction object must carry a non-negative integer
    // daysRemaining -- though applyPlaceBuildings() recomputes that for
    // brand-new placements server-side anyway, so a spoofed 0-day value
    // only affects edits to buildings the server already knows about.
    if (
      typeof b.settlementId !== "string" ||
      !Array.isArray(b.buildings) ||
      !b.buildings.every((v: unknown) => {
        if (!v || typeof v !== "object") return false;
        const d = v as {
          gx: unknown; gy: unknown; kind: unknown; level: unknown;
          style: unknown; w?: unknown; h?: unknown; construction?: unknown; bank?: unknown;
        };
        if (
          !Number.isInteger(d.gx) ||
          !Number.isInteger(d.gy) ||
          typeof d.kind !== "string" || d.kind.length === 0 ||
          typeof d.level !== "number" || !Number.isInteger(d.level) ||
          d.level < 1 || d.level > 3 ||
          typeof d.style !== "string" || d.style.length === 0
        ) {
          return false;
        }
        if (d.w !== undefined && (!Number.isInteger(d.w) || (d.w as number) < 1)) return false;
        if (d.h !== undefined && (!Number.isInteger(d.h) || (d.h as number) < 1)) return false;
        if (d.construction !== undefined) {
          if (typeof d.construction !== "object" || d.construction === null) return false;
          const days = (d.construction as { daysRemaining?: unknown }).daysRemaining;
          if (!isNonNegativeInt(days) || (days as number) > 30) return false;
        }
        return isBankPot(d.bank);
      })
    ) {
      return null;
    }
    return {
      kind: "PlaceBuildings",
      gameName,
      actor: b.actor,
      settlementId: b.settlementId,
      buildings: b.buildings.map(passthroughBuilding),
      ...(b.initialLayout === true ? { initialLayout: true } : {}),
    };
  }

  if (b.kind === "TransferResources") {
    // Amounts: integers >= 0 per known warehouse resource; at least one
    // positive amount (the reducer rejects all-zero as a 409 anyway, but a
    // mistyped "-5" or "wood": "lots" is a malformed body, not a move).
    if (
      typeof b.heroId !== "string" ||
      typeof b.settlementId !== "string" ||
      (b.direction !== "load" && b.direction !== "unload") ||
      !b.amounts ||
      typeof b.amounts !== "object"
    ) {
      return null;
    }
    const amounts = b.amounts as Record<string, unknown>;
    const clean: Partial<Record<string, number>> = {};
    let any = false;
    for (const r of ["wood", "stone", "iron", "arcane", "food"]) {
      const v = amounts[r];
      if (v === undefined) continue;
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0) return null;
      if (v > 0) any = true;
      clean[r] = v;
    }
    if (!any) return null;
    return {
      kind: "TransferResources",
      gameName,
      actor: b.actor,
      heroId: b.heroId,
      settlementId: b.settlementId,
      direction: b.direction,
      amounts: clean,
    };
  }

  if (b.kind === "AssignWagons") {
    if (
      typeof b.heroId !== "string" ||
      typeof b.delta !== "number" ||
      !Number.isInteger(b.delta) ||
      b.delta === 0
    ) {
      return null;
    }
    return {
      kind: "AssignWagons",
      gameName,
      actor: b.actor,
      heroId: b.heroId,
      delta: b.delta,
    };
  }

  if (b.kind === "BuyWagons") {
    if (
      typeof b.settlementId !== "string" ||
      typeof b.count !== "number" ||
      !Number.isInteger(b.count) ||
      b.count <= 0 ||
      b.count > 100
    ) {
      return null;
    }
    return {
      kind: "BuyWagons",
      gameName,
      actor: b.actor,
      settlementId: b.settlementId,
      count: b.count,
    };
  }

  const VALID_WAGON_RESOURCES = ["wood", "stone", "iron", "arcane", "food"] as const;

  if (b.kind === "CreateTradeRoute") {
    if (
      typeof b.fromSettlementId !== "string" ||
      typeof b.toSettlementId !== "string" ||
      typeof b.resource !== "string" ||
      !VALID_WAGON_RESOURCES.includes(b.resource as (typeof VALID_WAGON_RESOURCES)[number]) ||
      typeof b.wagons !== "number" ||
      !Number.isInteger(b.wagons) ||
      b.wagons <= 0 ||
      b.wagons > 100
    ) {
      return null;
    }
    return {
      kind: "CreateTradeRoute",
      gameName,
      actor: b.actor,
      fromSettlementId: b.fromSettlementId,
      toSettlementId: b.toSettlementId,
      resource: b.resource as (typeof VALID_WAGON_RESOURCES)[number],
      wagons: b.wagons,
    };
  }

  if (b.kind === "UpdateTradeRoute") {
    if (typeof b.routeId !== "string") return null;
    if (b.resource !== undefined) {
      if (
        typeof b.resource !== "string" ||
        !VALID_WAGON_RESOURCES.includes(b.resource as (typeof VALID_WAGON_RESOURCES)[number])
      ) {
        return null;
      }
    }
    if (b.wagonsDelta !== undefined) {
      if (typeof b.wagonsDelta !== "number" || !Number.isInteger(b.wagonsDelta) || b.wagonsDelta === 0) {
        return null;
      }
      if (Math.abs(b.wagonsDelta) > 100) return null;
    }
    if (b.remove !== undefined && typeof b.remove !== "boolean") return null;
    if (b.resource === undefined && b.wagonsDelta === undefined && b.remove !== true) return null;
    return {
      kind: "UpdateTradeRoute",
      gameName,
      actor: b.actor,
      routeId: b.routeId,
      ...(b.resource !== undefined ? { resource: b.resource as (typeof VALID_WAGON_RESOURCES)[number] } : {}),
      ...(b.wagonsDelta !== undefined ? { wagonsDelta: b.wagonsDelta } : {}),
      ...(b.remove !== undefined ? { remove: b.remove } : {}),
    };
  }

  if (b.kind === "UpgradeSettlement") {
    // targetLevel is deliberately not read off the body -- the handler
    // derives it as settlement.level + 1 (server/app/commandHandler.ts's
    // UpgradeSettlement case). A client that sends one is ignored, not
    // rejected, same as any other extra field on a command body.
    //
    // upgradePopulationGate IS trusted from the client (see
    // packages/contracts/src/commands/upgradeSettlement.ts's header for
    // why that's a deliberate, temporary exception), but only within its
    // actual domain: it's a fraction of the level's population cap
    // (packages/engine/src/settlement/upgradeSettlement.ts multiplies it
    // by POP_BY_LEVEL), so anything outside 0..1 is malformed, not just
    // unfavorable. 0 is allowed -- it means "no population requirement".
    if (
      typeof b.settlementId !== "string" ||
      typeof b.upgradePopulationGate !== "number" ||
      !Number.isFinite(b.upgradePopulationGate) ||
      b.upgradePopulationGate < 0 ||
      b.upgradePopulationGate > 1
    ) {
      return null;
    }
    return {
      kind: "UpgradeSettlement",
      gameName,
      actor: b.actor,
      settlementId: b.settlementId,
      upgradePopulationGate: b.upgradePopulationGate,
    };
  }

  if (b.kind === "StartCharter") {
    if (
      typeof b.heroId !== "string" ||
      typeof b.targetQ !== "number" ||
      typeof b.targetR !== "number" ||
      typeof b.settlementName !== "string" ||
      b.settlementName.length === 0
    ) {
      return null;
    }
    return {
      kind: "StartCharter",
      gameName,
      actor: b.actor,
      heroId: b.heroId,
      targetQ: b.targetQ,
      targetR: b.targetR,
      settlementName: b.settlementName,
    };
  }

  if (b.kind === "AdvanceCharterTravel") {
    if (
      typeof b.heroId !== "string" ||
      !isAxial(b.fromTile) ||
      !isAxial(b.toTile) ||
      typeof b.cost !== "number"
    ) {
      return null;
    }
    return {
      kind: "AdvanceCharterTravel",
      gameName,
      actor: b.actor,
      heroId: b.heroId,
      fromTile: b.fromTile,
      toTile: b.toTile,
      cost: b.cost,
    };
  }

  if (b.kind === "SubmitBattleResult") {
    if (
      typeof b.attackerId !== "string" ||
      typeof b.defenderId !== "string" ||
      typeof b.outcome !== "string" ||
      !VALID_SUBMITTED_OUTCOMES.includes(b.outcome as (typeof VALID_SUBMITTED_OUTCOMES)[number]) ||
      !isSurvivorStacks(b.attackerStacks) ||
      !isSurvivorStacks(b.defenderStacks) ||
      // rounds/obstacleSeed are this port's payload addition beyond the
      // plan's field list (see submitBattleResult.ts's header) — the
      // BattleResolved event requires both, and the seed must be the arena's
      // real one for the future re-simulation consumer.
      !isNonNegativeInt(b.rounds) ||
      !isNonNegativeInt(b.obstacleSeed) ||
      (b.surrenderedGold !== undefined && !isNonNegativeInt(b.surrenderedGold))
    ) {
      return null;
    }
    return {
      kind: "SubmitBattleResult",
      gameName,
      actor: b.actor,
      attackerId: b.attackerId,
      defenderId: b.defenderId,
      outcome: b.outcome as (typeof VALID_SUBMITTED_OUTCOMES)[number],
      attackerStacks: b.attackerStacks,
      defenderStacks: b.defenderStacks,
      ...(b.surrenderedGold !== undefined ? { surrenderedGold: b.surrenderedGold } : {}),
      rounds: b.rounds,
      obstacleSeed: b.obstacleSeed,
    };
  }

  if (b.kind === "RecruitUnits") {
    // buildingKind is a non-empty string rather than a BuildingKind check:
    // the union is type-only (no runtime list), and the handler resolves it
    // against the settlement's own buildings + the recruit registry -- an
    // unknown kind falls out there as "no_building"/"not_recruitable" 409s.
    if (
      typeof b.settlementId !== "string" ||
      typeof b.buildingKind !== "string" ||
      b.buildingKind.length === 0 ||
      !Number.isInteger(b.gx) ||
      !Number.isInteger(b.gy) ||
      typeof b.unitTypeId !== "string" ||
      b.unitTypeId.length === 0 ||
      typeof b.count !== "number" ||
      !Number.isInteger(b.count) ||
      b.count <= 0
    ) {
      return null;
    }
    return {
      kind: "RecruitUnits",
      gameName,
      actor: b.actor,
      settlementId: b.settlementId,
      buildingKind: b.buildingKind as BuildingKind,
      gx: b.gx as number,
      gy: b.gy as number,
      unitTypeId: b.unitTypeId,
      count: b.count,
    };
  }

  if (b.kind === "TransferUnits") {
    const toSlot = b.toSlot;
    const hasSlot = typeof toSlot === "number";
    if (
      typeof b.heroId !== "string" ||
      typeof b.settlementId !== "string" ||
      (b.direction !== "toHero" && b.direction !== "toGarrison") ||
      typeof b.unitTypeId !== "string" ||
      b.unitTypeId.length === 0 ||
      typeof b.count !== "number" ||
      !Number.isInteger(b.count) ||
      b.count <= 0 ||
      (hasSlot && (!Number.isInteger(toSlot) || toSlot < 0 || toSlot >= ARMY_STACK_SLOTS))
    ) {
      return null;
    }
    return {
      kind: "TransferUnits",
      gameName,
      actor: b.actor,
      heroId: b.heroId,
      settlementId: b.settlementId,
      direction: b.direction,
      unitTypeId: b.unitTypeId,
      count: b.count,
      ...(hasSlot ? { toSlot } : {}),
    };
  }

  if (b.kind === "SubmitSettlementBattleResult") {
    // Field-for-field mirror of SubmitBattleResult above, with the target
    // hero pair replaced by the settlement under attack (the defender side
    // is its garrison); survivor stacks reuse isSurvivorStacks.
    if (
      typeof b.attackerId !== "string" ||
      typeof b.settlementId !== "string" ||
      typeof b.outcome !== "string" ||
      !VALID_SUBMITTED_OUTCOMES.includes(b.outcome as (typeof VALID_SUBMITTED_OUTCOMES)[number]) ||
      !isSurvivorStacks(b.attackerStacks) ||
      !isSurvivorStacks(b.defenderStacks) ||
      !isNonNegativeInt(b.rounds) ||
      !isNonNegativeInt(b.obstacleSeed) ||
      (b.surrenderedGold !== undefined && !isNonNegativeInt(b.surrenderedGold))
    ) {
      return null;
    }
    return {
      kind: "SubmitSettlementBattleResult",
      gameName,
      actor: b.actor,
      attackerId: b.attackerId,
      settlementId: b.settlementId,
      outcome: b.outcome as (typeof VALID_SUBMITTED_OUTCOMES)[number],
      attackerStacks: b.attackerStacks,
      defenderStacks: b.defenderStacks,
      ...(b.surrenderedGold !== undefined ? { surrenderedGold: b.surrenderedGold } : {}),
      rounds: b.rounds,
      obstacleSeed: b.obstacleSeed,
    };
  }

  return null;
}

// D10 (plan/2026-09-30-server-side-ai-actor.md): client-origin commands
// naming an AI seat of a server-driven game are rejected before any state
// is touched -- the driver is the only legitimate actor for those seats,
// and old-browser AI-seat commands (anonymous callers fully trust
// command.actor) must not race it. Checked AFTER actor_mismatch (a
// signed-in caller asserting a seat that isn't theirs is rejected first)
// and BEFORE touchSeat, so AI seats never enter the presence map
// (neutralizing the dropPolicy turn-skip hazard class by construction).
// One cheap cached read per game (attachPlayerSeat's membership-cache
// pattern: 5s TTL, in-memory map keyed by game name); the driver and
// dropPolicy dispatch internally and never pass through this route.
const AI_SEAT_CACHE_TTL_MS = 5_000;

interface AiSeatInfo {
  serverDriven: boolean;
  aiSeats: ReadonlySet<number>;
  loadedAt: number;
}

const aiSeatCache = new Map<string, AiSeatInfo>();

async function loadAiSeatInfo(gameName: string): Promise<AiSeatInfo | null> {
  const cached = aiSeatCache.get(gameName);
  if (cached && Date.now() - cached.loadedAt < AI_SEAT_CACHE_TTL_MS) {
    return cached;
  }
  const r = await pool.query<{ ai_driver: string | null; players: { id: number; faction: string }[] | null }>(
    `SELECT (lobby->>'aiDriver') AS ai_driver, players FROM games WHERE name = $1`,
    [gameName],
  );
  if (r.rowCount === 0) return null;
  const players = r.rows[0].players ?? [];
  const info: AiSeatInfo = {
    serverDriven: r.rows[0].ai_driver === "server",
    aiSeats: new Set(players.filter((p) => p.faction === "ai").map((p) => p.id)),
    loadedAt: Date.now(),
  };
  aiSeatCache.set(gameName, info);
  return info;
}

/** Test/cache hook: drop the cached ai-seat info for one game (POST /games recreations). */
export function invalidateAiSeatCache(gameName: string): void {
  aiSeatCache.delete(gameName);
}

// req.params is typed explicitly here because this router is mounted by
// routes.ts on a path that carries :name ("/games/:name/commands") --
// Express's own typings only see this router's own "/" pattern, not its
// parent's, so :name has to be annotated by hand or it types as {}.
commandsRouter.post("/", async (req: Request<{ name: string }>, res) => {
  const gameName = req.params.name;
  const command = parseCommand(req.body, gameName);
  if (!command) {
    res.status(400).json({ error: "invalid command" });
    return;
  }
  // Defense-in-depth alongside commandHandler.ts's own seat-based checks
  // (forbidden_not_your_turn, forbidden_not_your_hero, etc.): those verify
  // the asserted seat has authority, not that the caller IS that seat.
  // req.playerSeat (from attachPlayerSeat) can't be spoofed the way
  // command.actor can -- but sign-in is optional, so this only applies when
  // we actually know who the caller is; an anonymous/unclaimed caller falls
  // back to trusting command.actor, same as the app worked before #179.
  if (req.playerSeat !== undefined && command.actor !== req.playerSeat) {
    res.status(403).json({ error: "actor_mismatch" });
    return;
  }
  const aiSeatInfo = await loadAiSeatInfo(gameName);
  if (aiSeatInfo?.serverDriven && aiSeatInfo.aiSeats.has(command.actor)) {
    res.status(403).json({ error: "ai_seat_command_forbidden" });
    return;
  }
  // Drop-policy heartbeat (docs/multiplayer.md, shipped 2026-09-27): a
  // valid command from a seat proves it is alive, so it counts alongside
  // the per-poll telemetry report and cancels any pending turn-skip for
  // that seat. Placed after the actor-vs-seat guard so a signed-in caller
  // asserting someone else's seat is rejected before it can keep THAT
  // seat's presence alive; anonymous callers fall back to trusting
  // command.actor the same way the rest of this route does.
  touchSeat(gameName, command.actor);
  try {
    const deps = await getLiveDeps();
    const result = await handleCommandTransactional(command, deps);
    if (!result.ok) {
      const status = result.reason === "forbidden_not_your_turn" ? 403 : 409;
      res.status(status).json({ error: result.reason });
      return;
    }
    // Not returning a `version` field yet (ROADMAP's exit criteria mentions
    // one) -- no version/optimistic-concurrency column exists on `games`
    // today, and inventing one is its own decision, not a Week-1 given.
    //
    // lastEventId is the game_events.id of the last event this command's
    // own writes caused (server/app/commandHandler.ts's CommandResult) --
    // the client advances its GET .../events?after= poll cursor to this
    // value so it doesn't re-fetch and re-apply the events its own command
    // just produced on the next poll.
    res.json({
      events: result.events,
      lastEventId: result.lastEventId,
      hero: result.hero,
      settlement: result.settlement,
      heroes: result.heroes,
      settlements: result.settlements,
      round: result.round,
      day: result.day,
      activePlayerId: result.activePlayerId,
      players: result.players,
      tradeRoutes: result.tradeRoutes,
      fromSettlement: result.fromSettlement,
      toSettlement: result.toSettlement,
      attackerHero: result.attackerHero,
      defenderHero: result.defenderHero,
      attackerVerdict: result.attackerVerdict,
      defenderVerdict: result.defenderVerdict,
      battle: result.battle,
    });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("game not found:")) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    console.error("[api] POST /games/:name/commands threw:", err);
    res.status(500).json({
      error: "internal",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});
