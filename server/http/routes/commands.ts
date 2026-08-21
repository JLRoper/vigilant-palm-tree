import { Router, type Request } from "express";
import type { Command } from "@heroes/contracts";
import { VALID_HORSE_VARIANTS } from "@heroes/engine";
import { handleCommandTransactional, createLiveCommandDeps, type LiveCommandDeps } from "../../app/commandHandler";

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

function isAxial(v: unknown): v is { q: number; r: number } {
  return (
    !!v &&
    typeof v === "object" &&
    typeof (v as { q: unknown }).q === "number" &&
    typeof (v as { r: unknown }).r === "number"
  );
}

// Matches the old /trade route's own VALID_RESOURCES list (server/routes.ts)
// -- "food" is deliberately excluded, see
// packages/contracts/src/commands/tradeResources.ts's header comment.
const VALID_TRADE_RESOURCES = ["wood", "stone", "iron", "arcane"] as const;

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

  return null;
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
      fromSettlement: result.fromSettlement,
      toSettlement: result.toSettlement,
      attackerHero: result.attackerHero,
      defenderHero: result.defenderHero,
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
