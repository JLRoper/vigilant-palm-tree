import { Router, type Request } from "express";
import type { Command } from "@heroes/contracts";
import { handleCommand, createLiveCommandDeps } from "../../app/commandHandler";

// Built once per process, not per request -- createLiveCommandDeps() just
// wraps the shared pg pool (see server/persistence/db.ts), it doesn't open
// a new connection. Only commandHandler.ts may import
// server/persistence/repositories/* directly (dependency-cruiser.cjs's
// Track 3.A/3.B boundary rule); this router gets the real repos through
// that export instead, replacing the old server/app/liveRepos.ts shim now
// that Track 3.B's repos exist.
const liveDeps = createLiveCommandDeps();

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
    const result = await handleCommand(command, liveDeps);
    if (!result.ok) {
      const status = result.reason === "forbidden_not_your_turn" ? 403 : 409;
      res.status(status).json({ error: result.reason });
      return;
    }
    // Not returning a `version` field yet (ROADMAP's exit criteria mentions
    // one) -- no version/optimistic-concurrency column exists on `games`
    // today, and inventing one is its own decision, not a Week-1 given.
    res.json({
      events: result.events,
      hero: result.hero,
      settlement: result.settlement,
      heroes: result.heroes,
      settlements: result.settlements,
      round: result.round,
      day: result.day,
      activePlayerId: result.activePlayerId,
      players: result.players,
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
